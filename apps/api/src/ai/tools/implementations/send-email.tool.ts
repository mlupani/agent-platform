import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { EmailService } from '../../../email/email.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { appendGoogleReviewsCta } from '../../../common/utils/google-reviews-cta';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../agent-tool.interface';

const schema = z.object({
  to: z
    .string()
    .email()
    .describe('Email del destinatario. Solo si el usuario lo proporcionó.'),
  subject: z.string().min(1).max(180).describe('Asunto claro y concreto'),
  body: z
    .string()
    .min(1)
    .max(5000)
    .describe(
      'Cuerpo en texto plano. Para confirmación de turno incluí fecha, hora, servicio, datos del negocio y el link de reseñas de Google si está configurado.',
    ),
});

@Injectable()
export class SendEmailTool implements AgentTool {
  readonly name = 'sendEmail';
  readonly description =
    'Envía un email real (p.ej. confirmación de turno). Ejecutalo directamente cuando el usuario pidió el mail y ya dio su email; no pidas otra autorización verbal. No inventes destinatarios.';
  readonly schema = schema;
  readonly risk = 'WRITE' as const;

  constructor(
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const data = schema.parse(input);

    const transport = await this.email.resolveTransport(context.businessId);
    if (!transport) {
      return {
        success: false,
        error:
          'Email no configurado en el servidor (faltan EMAIL_FROM/RESEND_API_KEY o SMTP). Confirmá el turno por este chat.',
      };
    }

    const business = await this.prisma.business.findUnique({
      where: { id: context.businessId },
      select: { name: true, email: true, googleReviewsUrl: true },
    });

    try {
      const text = appendGoogleReviewsCta(
        data.body,
        business?.googleReviewsUrl,
      );
      const result = await this.email.send(
        {
          to: data.to,
          subject: data.subject,
          text,
          from: formatFrom(business?.name, transport.from),
          replyTo: business?.email ?? undefined,
        },
        context.businessId,
      );

      return {
        success: true,
        data: {
          sent: true,
          to: data.to,
          subject: data.subject,
          messageId: result.messageId,
          provider: result.provider,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'No se pudo enviar el email',
      };
    }
  }
}

function formatFrom(businessName: string | undefined, from: string): string {
  if (!businessName?.trim() || from.includes('<')) return from;
  return `${businessName.trim()} <${from}>`;
}
