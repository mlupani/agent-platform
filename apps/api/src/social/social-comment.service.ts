import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { LeadsService } from '../leads/leads.service';
import { SocialProviderFactory } from './social-provider.factory';

interface CommentPayload {
  commentId: string;
  text: string;
  authorUsername?: string | null;
  authorId?: string | null;
  authorDisplayName?: string | null;
  postId?: string | null;
  postCaption?: string | null;
  accountId?: string | null;
  profileId?: string | null;
  platform?: string | null;
  raw: unknown;
}

@Injectable()
export class SocialCommentService {
  private readonly logger = new Logger(SocialCommentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(forwardRef(() => LeadsService))
    private readonly leads: LeadsService,
    private readonly factory: SocialProviderFactory,
  ) {}

  async handleRaw(payload: unknown): Promise<boolean> {
    const data = this.extract(payload);
    if (!data || !data.commentId || !data.text) {
      this.logger.warn(`IG comment webhook sin commentId/text: ${JSON.stringify(payload).slice(0, 500)}`);
      return false;
    }

    // dedupe por commentId 7 días
    const lockKey = `zernio:comment:${data.commentId}`;
    const isNew = await this.redis.acquireLock(lockKey, 7 * 86_400);
    if (!isNew) {
      this.logger.debug(`IG comment duplicado ${data.commentId}`);
      return true;
    }

    // resolver businessId desde accountId/profileId
    let businessId: string | null = null;
    let accountPlatform: string | null = null;
    if (data.accountId) {
      const conn = await this.prisma.socialConnection.findFirst({
        where: { provider: 'zernio', externalAccountId: data.accountId },
        select: { businessId: true, platform: true },
      });
      if (conn) {
        businessId = conn.businessId;
        accountPlatform = conn.platform;
      }
    }
    if (!businessId && data.profileId) {
      const business = await this.prisma.business.findFirst({
        where: { zernioProfileId: data.profileId },
        select: { id: true },
      });
      if (business) businessId = business.id;
      // fallback: buscar cualquier conexión con ese profileId
      if (!businessId) {
        const conn = await this.prisma.socialConnection.findFirst({
          where: { zernioProfileId: data.profileId },
          select: { businessId: true, platform: true },
        });
        if (conn) {
          businessId = conn.businessId;
          accountPlatform = conn.platform;
        }
      }
    }
    if (!businessId) {
      this.logger.warn(`IG comment ${data.commentId} sin business resuelto (accountId=${data.accountId} profileId=${data.profileId})`);
      return false;
    }

    const platform = (data.platform || accountPlatform || 'instagram').toLowerCase();
    if (!['instagram', 'facebook'].includes(platform)) {
      this.logger.debug(`IG comment plataforma no soportada ${platform}`);
      // igual intentar capturar como instagram
    }

    // verificar que la cuenta esté conectada y agentEnabled
    if (data.accountId) {
      const conn = await this.prisma.socialConnection.findFirst({
        where: { businessId, provider: 'zernio', externalAccountId: data.accountId },
      });
      // no bloquear si no encontramos, pero log
      if (conn && conn.status !== 'connected') {
        this.logger.warn(`IG comment para cuenta no conectada ${data.accountId} status=${conn.status}`);
      }
    }

    // evitar procesar comentarios de nuestra propia cuenta
    if (data.authorUsername) {
      const own = await this.prisma.socialConnection.findFirst({
        where: { businessId, provider: 'zernio', username: data.authorUsername },
        select: { id: true },
      });
      if (own) {
        this.logger.debug(`IG comment ${data.commentId} es de cuenta propia, ignorado`);
        return true;
      }
    }

    const classification = this.classify(data.text, data.postCaption);
    this.logger.log(
      `IG comment ${data.commentId} @${data.authorUsername || 'anon'}: "${data.text.slice(0, 80)}" -> ${classification.intent} (lead=${classification.isLead})`,
    );

    // Crear/actualizar lead: username como nombre, comment como mensaje, interest derivado
    const leadName = data.authorDisplayName || data.authorUsername || 'Seguidor IG';
    let capturedLeadId: string | null = null;
    try {
      const captured = await this.leads.capture({
        businessId,
        name: leadName,
        phone: null,
        email: null,
        message: data.text,
        interest: classification.interest,
        source: 'instagram',
        status: classification.isLead ? 'interested' : 'new',
        metadata: {
          origin: 'instagram_comment',
          commentId: data.commentId,
          postId: data.postId,
          authorUsername: data.authorUsername,
          authorId: data.authorId,
          platform: 'instagram',
          isGreeting: classification.isGreeting,
          isQuestion: classification.isQuestion,
          intent: classification.intent,
          raw: data.raw as Record<string, unknown>,
        },
      });
      capturedLeadId = captured?.id || null;
      this.logger.log(`Lead desde comentario IG ${data.commentId} -> ${capturedLeadId || 'sin lead (sin datos)'}`);
      // Instagram comment es contactable vía IG aunque no tenga teléfono: forzar canal
      if (capturedLeadId) {
        await this.prisma.lead.update({
          where: { id: capturedLeadId },
          data: {
            source: 'instagram',
            preferredChannel: 'INSTAGRAM',
            isContactable: true,
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error capturando lead desde comentario ${data.commentId}: ${error instanceof Error ? error.message : 'unknown'}`);
    }

    // Auto-respuesta: si es saludo o pregunta, enviar reply privado o público según config
    if (classification.isLead) {
      const shouldReply = await this.shouldAutoReply(businessId, platform);
      this.logger.log(`IG comment ${data.commentId} shouldAutoReply=${shouldReply} (platform=${platform} business=${businessId.slice(0,8)})`);
      if (shouldReply) {
        const replyText = this.buildReply(data.text, classification, data.authorUsername);
        this.logger.log(`Intentando reply a ${data.commentId} (post ${data.postId || 'sin postId'})`);
        if (!data.postId) {
          this.logger.warn(`No se puede responder comentario ${data.commentId}: falta postId (Zernio requiere postId para private-reply)`);
        } else {
          try {
            const provider = this.factory.get();
            let replied = false;
            if (provider.sendPrivateReplyToComment) {
              try {
                await provider.sendPrivateReplyToComment({ postId: data.postId, commentId: data.commentId, message: replyText });
                this.logger.log(`Private reply enviado a comentario ${data.commentId}: "${replyText.slice(0, 60)}"`);
                replied = true;
              } catch (e) {
                this.logger.warn(`Private reply falló ${data.commentId}: ${e instanceof Error ? e.message : String(e)} — probando reply público`);
              }
            }
            if (!replied && provider.replyToComment) {
              try {
                await provider.replyToComment({ postId: data.postId, commentId: data.commentId, message: replyText });
                this.logger.log(`Public reply enviado a comentario ${data.commentId}`);
                replied = true;
              } catch (e) {
                this.logger.warn(`Public reply falló ${data.commentId}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
            if (!replied) this.logger.warn(`No hay método de reply disponible en provider para ${data.commentId}`);
          } catch (error) {
            this.logger.warn(`No se pudo responder comentario ${data.commentId}: ${error instanceof Error ? error.message : 'error'} | ${JSON.stringify((error as { statusCode?: number })?.statusCode)}`);
          }
        }
      } else {
        this.logger.warn(`Auto-reply deshabilitado para IG: verifica /integrations → Instagram → "Agente habilitado" (business ${businessId.slice(0,8)})`);
      }
    } else {
      this.logger.debug(`IG comment ${data.commentId} no es lead (intent=${classification.intent}), no se responde`);
    }

    return true;
  }

  private classify(
    text: string,
    postCaption?: string | null,
  ): { isGreeting: boolean; isQuestion: boolean; isLead: boolean; intent: string; interest: string | null } {
    const lower = text.toLowerCase();
    const isGreeting = /(hola|buenas|hey|qué tal|que tal|buen día|buen dia|saludos)/i.test(text);
    const isQuestion =
      /\?/.test(text) ||
      /(cu[aá]nto|precio|valor|costo|cuesta|info|informaci[oó]n|horario|clase|turno|disponible|d[oó]nde|ubicaci[oó]n|direcci[oó]n|c[oó]mo llego|cupo|agenda|reservar)/i.test(
        lower,
      );
    const isLead = isQuestion || isGreeting;
    let intent = 'other';
    if (isGreeting && isQuestion) intent = 'greeting_and_question';
    else if (isQuestion) intent = 'question';
    else if (isGreeting) intent = 'greeting';
    let interest: string | null = null;
    if (intent !== 'other') {
      // usar hasta 80 chars del comentario como interés + contexto post
      interest = text.slice(0, 80);
      if (postCaption) interest = `${interest} | post: ${postCaption.slice(0, 40)}`;
    }
    return { isGreeting, isQuestion, isLead, intent, interest };
  }

  private async shouldAutoReply(businessId: string, platform: string): Promise<boolean> {
    // por ahora: si hay conexión IG con agentEnabled, auto-reply. Futuro: flag en social_content_configs
    const conn = await this.prisma.socialConnection.findFirst({
      where: { businessId, provider: 'zernio', platform: platform as never },
      select: { agentEnabled: true, status: true },
    });
    if (!conn) {
      const anyIg = await this.prisma.socialConnection.findFirst({
        where: { businessId, provider: 'zernio', platform: 'instagram' },
        select: { agentEnabled: true, status: true },
      });
      return Boolean(anyIg && anyIg.status === 'connected' && anyIg.agentEnabled !== false);
    }
    return conn.status === 'connected' && conn.agentEnabled !== false;
  }

  private buildReply(text: string, classification: { intent: string }, username?: string | null): string {
    const name = username ? ` @${username}` : '';
    if (classification.intent === 'greeting_and_question' || classification.intent === 'question') {
      return `¡Hola${name}! Gracias por tu comentario 🙌 Te escribimos por privado para pasarte info de horarios y precios. ¡Atenta a tus mensajes!`;
    }
    if (classification.intent === 'greeting') {
      return `¡Hola${name}! Gracias por saludar 💛 Te dejamos un mensajito por privado.`;
    }
    return `¡Gracias por tu comentario${name}! Te contactamos por privado.`;
  }

  private extract(payload: unknown): CommentPayload | null {
    const root = asRecord(payload);
    if (!root) return null;

    // Zernio suele enviar { event: "comment.received", data: { comment: {...}, account: {...} } } o { event, comment, account }
    const event = stringOf(root.event) ?? stringOf(root.type) ?? '';
    // no validar event aquí, el caller ya filtró, pero mantener genérico
    const data = asRecord(root.data) ?? root;

    // comment puede estar en data.comment, data, o root.comment
    const commentObj = asRecord(data.comment) ?? asRecord(root.comment) ?? data;
    const accountObj = asRecord(data.account) ?? asRecord(root.account) ?? asRecord(commentObj.account);

    const commentId =
      stringOf(commentObj.commentId) ??
      stringOf(commentObj.id) ??
      stringOf(commentObj._id) ??
      stringOf(data.commentId) ??
      stringOf(root.commentId) ??
      stringOf(data.id);

    const text =
      stringOf(commentObj.text) ??
      stringOf(commentObj.message) ??
      stringOf(commentObj.body) ??
      stringOf(data.text) ??
      stringOf(root.text) ??
      '';

    if (!commentId || !text) {
      // intentar fallback: si payload es directamente el comment
      // si no hay commentId pero hay id + text, usarlo
      if (commentId && text) return null; // ya retornado
      // si no pudimos extraer, log y salir
      return null;
    }

    const authorUsername =
      stringOf(commentObj.username) ??
      stringOf(commentObj.authorUsername) ??
      stringOf(asRecord(commentObj.author)?.username) ??
      stringOf(asRecord(commentObj.from)?.username) ??
      stringOf(data.username) ??
      null;

    const authorId =
      stringOf(commentObj.authorId) ??
      stringOf(commentObj.userId) ??
      stringOf(commentObj.fromId) ??
      stringOf(asRecord(commentObj.author)?.id) ??
      null;

    const authorDisplayName =
      stringOf(commentObj.displayName) ??
      stringOf(commentObj.authorDisplayName) ??
      stringOf(asRecord(commentObj.author)?.displayName) ??
      stringOf(authorUsername) ??
      null;

    const postId =
      stringOf(commentObj.postId) ??
      stringOf(data.postId) ??
      stringOf(asRecord(data.post)?.id) ??
      stringOf(root.postId) ??
      null;

    const postCaption =
      stringOf(asRecord(data.post)?.caption) ??
      stringOf(commentObj.postCaption) ??
      null;

    const accountId =
      stringOf(accountObj?.accountId) ??
      stringOf(accountObj?.id) ??
      stringOf(data.accountId) ??
      stringOf(root.accountId) ??
      stringOf(commentObj.accountId) ??
      null;

    const profileId =
      stringOf(accountObj?.profileId) ??
      stringOf(data.profileId) ??
      stringOf(root.profileId) ??
      stringOf(commentObj.profileId) ??
      null;

    const platform =
      stringOf(accountObj?.platform) ??
      stringOf(data.platform) ??
      stringOf(root.platform) ??
      stringOf(commentObj.platform) ??
      null;

    return {
      commentId,
      text,
      authorUsername,
      authorId,
      authorDisplayName,
      postId,
      postCaption,
      accountId,
      profileId,
      platform,
      raw: payload,
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
