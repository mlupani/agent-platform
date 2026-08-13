import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { appendGoogleReviewsCta } from '../../../common/utils/google-reviews-cta';
import { WhatsAppProviderFactory } from '../../../whatsapp/providers/whatsapp-provider.factory';
import { WhatsAppConfigService } from '../../../whatsapp/whatsapp-config.service';
import type { AgentTool, ToolContext, ToolResult } from '../agent-tool.interface';

const schema = z.object({
  to: z
    .string()
    .min(6)
    .max(40)
    .optional()
    .describe(
      'Teléfono del destinatario (con código de país si es posible). Si se omite, se usa el teléfono de la conversación.',
    ),
  body: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      'Mensaje de WhatsApp. Para confirmación de turno incluí fecha, hora, servicio, datos del negocio y el link de reseñas de Google si está configurado.',
    ),
});

@Injectable()
export class SendWhatsAppMessageTool implements AgentTool {
  readonly name = 'sendWhatsAppMessage';
  readonly description =
    'Envía un mensaje de WhatsApp (p.ej. confirmación de turno). Usalo si el usuario pidió o aceptó confirmación por WhatsApp y hay un teléfono. No inventes números.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: WhatsAppProviderFactory,
    private readonly whatsappConfig: WhatsAppConfigService,
  ) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    const waConfig = await this.whatsappConfig.getForRuntime(context.businessId);
    if (!waConfig?.enabled) {
      return {
        success: false,
        error:
          'WhatsApp no está habilitado para este negocio. Confirmá el turno por este chat o por email.',
      };
    }

    const conversation = context.conversationId
      ? await this.prisma.conversation.findFirst({
          where: {
            id: context.conversationId,
            businessId: context.businessId,
          },
          select: {
            contactPhone: true,
            externalId: true,
            channel: true,
          },
        })
      : null;

    const to = this.resolveDestination({
      explicitTo: data.to,
      metadataPhone: context.metadata?.contactPhone
        ? String(context.metadata.contactPhone)
        : undefined,
      conversationPhone: conversation?.contactPhone ?? undefined,
      conversationExternalId: conversation?.externalId ?? undefined,
    });

    if (!to) {
      return {
        success: false,
        error:
          'No hay un teléfono de WhatsApp para enviar. Pedile el número al usuario (con código de país) e intentá de nuevo.',
      };
    }

    const business = await this.prisma.business.findUnique({
      where: { id: context.businessId },
      select: { googleReviewsUrl: true },
    });
    const body = appendGoogleReviewsCta(data.body, business?.googleReviewsUrl);

    try {
      const provider = await this.providers.getForBusiness(context.businessId);
      const session =
        typeof context.metadata?.session === 'string'
          ? context.metadata.session
          : undefined;
      const sent = await provider.sendText({
        businessId: context.businessId,
        to,
        body,
        session,
      });

      if (context.conversationId) {
        try {
          await this.prisma.message.create({
            data: {
              conversationId: context.conversationId,
              businessId: context.businessId,
              role: 'assistant',
              sender: 'AI',
              content: body,
              status: 'sent',
              externalId: sent.externalId ?? undefined,
              metadata: {
                source: 'sendWhatsAppMessage',
                to,
              },
            },
          });
          await this.prisma.conversation.update({
            where: { id: context.conversationId },
            data: {
              lastMessageAt: new Date(),
              lastMessagePreview: body.slice(0, 280),
              lastMessageSender: 'AI',
            },
          });
        } catch {
          // El envío ya salió; no fallar la tool por persistencia/idempotencia.
        }
      }

      return {
        success: true,
        data: {
          sent: true,
          to,
          messageId: sent.externalId ?? null,
          hint: 'Mensaje enviado por WhatsApp. En tu respuesta final confirmá al usuario que ya se mandó, sin repetir el texto completo si no hace falta.',
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo enviar el mensaje de WhatsApp',
      };
    }
  }

  private resolveDestination(params: {
    explicitTo?: string;
    metadataPhone?: string;
    conversationPhone?: string;
    conversationExternalId?: string;
  }): string | null {
    const candidates = [
      params.explicitTo,
      params.metadataPhone,
      params.conversationPhone,
      params.conversationExternalId,
    ];

    for (const candidate of candidates) {
      const value = candidate?.trim();
      if (!value) continue;
      if (value.includes('@')) return value;
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 8) return digits;
    }
    return null;
  }
}
