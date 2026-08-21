import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecretsService } from '../common/crypto/secrets.service';
import type {
  EmailTransportConfig,
  SendEmailInput,
  SendEmailResult,
} from './email.types';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  onModuleInit(): void {
    const transport = this.fromEnv();
    if (transport) {
      this.logger.log(
        `Email listo via ${transport.provider} (from=${transport.from})`,
      );
    } else {
      this.logger.warn(
        'Email NO configurado: definí EMAIL_FROM + RESEND_API_KEY (o EMAIL_PROVIDER=smtp + SMTP_*)',
      );
    }
  }

  async resolveTransport(
    businessId?: string,
  ): Promise<EmailTransportConfig | null> {
    // Single-tenant: el .env del deploy manda. La Integration es override opcional.
    const fromEnv = this.fromEnv();
    if (fromEnv) return fromEnv;

    if (businessId) {
      return this.fromIntegration(businessId);
    }
    return null;
  }

  isConfiguredSync(): boolean {
    return this.fromEnv() != null;
  }

  async send(
    input: SendEmailInput,
    businessId?: string,
  ): Promise<SendEmailResult> {
    const transport = await this.resolveTransport(businessId);
    if (!transport) {
      throw new Error(
        'Email no configurado. Definí RESEND_API_KEY + EMAIL_FROM, o SMTP_*, o una integración type=email.',
      );
    }

    const from = input.from?.trim() || transport.from;
    const replyTo = input.replyTo?.trim() || transport.replyTo;
    const html =
      input.html?.trim() ||
      `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(
        input.text,
      )}</pre>`;

    if (transport.provider === 'resend') {
      return this.sendViaResend({
        apiKey: transport.resendApiKey!,
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html,
        replyTo,
      });
    }

    return this.sendViaSmtp({
      smtp: transport.smtp!,
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html,
      replyTo,
    });
  }

  private fromEnv(): EmailTransportConfig | null {
    const from = this.config.get<string>('EMAIL_FROM')?.trim();
    if (!from) return null;

    const replyTo = this.config.get<string>('EMAIL_REPLY_TO')?.trim();
    const provider = (
      this.config.get<string>('EMAIL_PROVIDER') || ''
    )
      .trim()
      .toLowerCase();

    const smtp = this.smtpFromEnv();
    const resendApiKey = this.config.get<string>('RESEND_API_KEY')?.trim();

    if (provider === 'smtp' || (!resendApiKey && smtp)) {
      if (!smtp) return null;
      return {
        provider: 'smtp',
        from,
        replyTo,
        smtp,
      };
    }

    if (!resendApiKey) return null;
    return { provider: 'resend', from, replyTo, resendApiKey };
  }

  private smtpFromEnv(): EmailTransportConfig['smtp'] | null {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.replace(/\s/g, '');
    const port = Number(this.config.get<string>('SMTP_PORT') || '587');
    const secure =
      (this.config.get<string>('SMTP_SECURE') || '').toLowerCase() === 'true' ||
      port === 465;
    if (!host || !user || !pass) return null;
    return { host, port, secure, user, pass };
  }

  private async fromIntegration(
    businessId: string,
  ): Promise<EmailTransportConfig | null> {
    const integration = await this.prisma.integration.findFirst({
      where: { businessId, type: 'email', enabled: true },
    });
    if (!integration) return null;

    const config = (integration.config ?? {}) as Record<string, unknown>;
    const from =
      typeof config.from === 'string' ? config.from.trim() : undefined;
    if (!from) return null;

    const replyTo =
      typeof config.replyTo === 'string' ? config.replyTo.trim() : undefined;
    const providerRaw =
      typeof config.provider === 'string'
        ? config.provider.trim().toLowerCase()
        : 'platform';

    let secrets: Record<string, unknown> = {};
    if (integration.secretsEnc) {
      try {
        secrets = JSON.parse(this.secrets.decrypt(integration.secretsEnc)) as Record<
          string,
          unknown
        >;
      } catch (error) {
        this.logger.warn(
          `No se pudieron desencriptar secrets de integración email ${integration.id}`,
        );
        return null;
      }
    }

    if (providerRaw === 'platform') {
      const env = this.fromEnv();
      if (!env) return null;
      return { ...env, from, replyTo: replyTo ?? env.replyTo };
    }

    if (providerRaw === 'smtp') {
      const host =
        String(secrets.host ?? config.host ?? '').trim() ||
        this.config.get<string>('SMTP_HOST')?.trim();
      const user =
        String(secrets.user ?? config.user ?? '').trim() ||
        this.config.get<string>('SMTP_USER')?.trim();
      const pass =
        String(secrets.pass ?? secrets.password ?? '').trim() ||
        this.config.get<string>('SMTP_PASS')?.trim();
      const port = Number(
        secrets.port ?? config.port ?? this.config.get('SMTP_PORT') ?? 587,
      );
      const secure =
        Boolean(secrets.secure ?? config.secure) ||
        port === 465;
      if (!host || !user || !pass) return null;
      return {
        provider: 'smtp',
        from,
        replyTo,
        smtp: { host, port, secure, user, pass },
      };
    }

    const resendApiKey =
      String(secrets.apiKey ?? secrets.resendApiKey ?? '').trim() ||
      this.config.get<string>('RESEND_API_KEY')?.trim();
    if (!resendApiKey) return null;
    return { provider: 'resend', from, replyTo, resendApiKey };
  }

  private async sendViaResend(params: {
    apiKey: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  }): Promise<SendEmailResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      const message =
        payload.error?.message ||
        payload.message ||
        `Resend HTTP ${response.status}`;
      throw new Error(message);
    }

    return {
      messageId: payload.id || `resend-${Date.now()}`,
      provider: 'resend',
    };
  }

  private async sendViaSmtp(params: {
    smtp: NonNullable<EmailTransportConfig['smtp']>;
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  }): Promise<SendEmailResult> {
    const transporter = nodemailer.createTransport({
      host: params.smtp.host,
      port: params.smtp.port,
      secure: params.smtp.secure,
      auth: {
        user: params.smtp.user,
        pass: params.smtp.pass,
      },
    });

    try {
      const info = await transporter.sendMail({
        from: params.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      });
      return {
        messageId: String(info.messageId || `smtp-${Date.now()}`),
        provider: 'smtp',
      };
    } finally {
      transporter.close();
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
