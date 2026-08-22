import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { WhatsAppConfigService } from '../whatsapp/whatsapp-config.service';
import { WahaWhatsAppProvider } from '../whatsapp/providers/waha.whatsapp-provider';

export interface AutoContentNotifyInput {
  businessId: string;
  contentId?: string;
  mediaType?: string;
  headline?: string | null;
  topic?: string | null;
  status?: string;
  error?: string | null;
}

@Injectable()
export class ContentNotifyService {
  private readonly logger = new Logger(ContentNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: ConfigService,
    private readonly email: EmailService,
    private readonly whatsappConfig: WhatsAppConfigService,
    private readonly waha: WahaWhatsAppProvider,
  ) {}

  async notifyAutoGeneration(input: AutoContentNotifyInput): Promise<void> {
    const config = await this.prisma.socialContentConfig.findUnique({
      where: { businessId: input.businessId },
    });
    if (!config) return;

    const phone = this.normalizePhone(config.notifyWhatsAppPhone);
    const email = config.notifyEmail?.trim() || null;
    if (!phone && !email) return;

    const waReady = phone
      ? await this.isWhatsAppReady(input.businessId)
      : false;
    const message = this.buildMessage(input);

    if (waReady && phone) {
      try {
        await this.waha.sendText({
          businessId: input.businessId,
          to: phone,
          body: message.text,
        });
        this.logger.log(
          `Aviso WA enviado business=${input.businessId} to=${phone} content=${input.contentId ?? 'n/a'}`,
        );
        return;
      } catch (error) {
        this.logger.warn(
          `Aviso WA falló, intento email: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    if (!email) {
      this.logger.warn(
        `Sin canal de aviso: WhatsApp no listo y no hay email business=${input.businessId}`,
      );
      return;
    }

    try {
      await this.email.send(
        {
          to: email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        input.businessId,
      );
      this.logger.log(
        `Aviso email enviado business=${input.businessId} to=${email} content=${input.contentId ?? 'n/a'}`,
      );
    } catch (error) {
      this.logger.warn(
        `Aviso email falló: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async isWhatsAppReady(businessId: string): Promise<boolean> {
    const config = await this.whatsappConfig.getForRuntime(businessId);
    if (!config?.enabled) return false;
    if (config.status === 'connected') return true;
    try {
      const live = await this.waha.getStatus(businessId);
      return live.status === 'connected';
    } catch {
      return false;
    }
  }

  private normalizePhone(value?: string | null): string | null {
    const digits = (value ?? '').replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
  }

  private buildMessage(input: AutoContentNotifyInput): {
    subject: string;
    text: string;
    html: string;
  } {
    const failed = Boolean(input.error) || input.status === 'FAILED';
    const kind =
      (input.mediaType ?? 'IMAGE').toUpperCase() === 'VIDEO'
        ? 'video'
        : 'imagen';
    const title = input.headline?.trim() || input.topic?.trim() || 'Sin título';
    const panelUrl = this.panelUrl();
    const subject = failed
      ? 'Falló la generación automática de contenido'
      : `Nuevo borrador automático (${kind})`;

    const text = failed
      ? [
          'Falló la generación automática de contenido.',
          input.error ? `Error: ${input.error}` : null,
          panelUrl ? `Panel: ${panelUrl}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `Se generó un borrador automático (${kind}).`,
          `Título: ${title}`,
          'Revisalo y publicalo cuando quieras.',
          panelUrl ? `Panel: ${panelUrl}` : null,
        ]
          .filter(Boolean)
          .join('\n');

    const html = failed
      ? `<p>Falló la generación automática de contenido.</p>${
          input.error
            ? `<p><strong>Error:</strong> ${escapeHtml(input.error)}</p>`
            : ''
        }${
          panelUrl
            ? `<p><a href="${escapeHtml(panelUrl)}">Abrir el panel</a></p>`
            : ''
        }`
      : `<p>Se generó un borrador automático (<strong>${kind}</strong>).</p>
<p><strong>Título:</strong> ${escapeHtml(title)}</p>
<p>Revisalo y publicalo cuando quieras.</p>
${
  panelUrl ? `<p><a href="${escapeHtml(panelUrl)}">Abrir el panel</a></p>` : ''
}`;

    return { subject, text, html };
  }

  private panelUrl(): string | null {
    const base = (
      this.env.get<string>('ADMIN_URL') ||
      this.env.get<string>('NEXT_PUBLIC_ADMIN_URL') ||
      ''
    ).replace(/\/$/, '');
    return base ? `${base}/content` : null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
