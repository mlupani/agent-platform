import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  ADMIN_NOTIFY_EVENTS,
  DEFAULT_ADMIN_NOTIFY_EVENTS,
  type AdminNotifyEvent,
} from './admin-notify.constants';
import type {
  AdminNotifyPublicConfig,
  AppointmentNotifyInput,
  ClientAutoCreatedNotifyInput,
  LeadNotifyInput,
} from './admin-notify.types';

@Injectable()
export class AdminNotifyService {
  private readonly logger = new Logger(AdminNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly env: ConfigService,
  ) {}

  async getPublic(businessId: string): Promise<AdminNotifyPublicConfig> {
    const [row, transport] = await Promise.all([
      this.prisma.adminNotifyConfig.findUnique({ where: { businessId } }),
      this.email.resolveTransport(businessId),
    ]);
    return {
      enabled: row?.enabled ?? false,
      email: row?.email ?? null,
      events: this.normalizeEvents(row?.events ?? DEFAULT_ADMIN_NOTIFY_EVENTS),
      emailConfigured: Boolean(transport),
    };
  }

  async upsert(
    businessId: string,
    input: {
      enabled?: boolean;
      email?: string | null;
      events?: string[];
    },
  ): Promise<AdminNotifyPublicConfig> {
    const current = await this.getPublic(businessId);
    const email =
      input.email !== undefined
        ? this.normalizeEmail(input.email)
        : current.email;
    const enabled = input.enabled ?? current.enabled;
    const events = this.normalizeEvents(input.events ?? current.events);

    if (enabled && !email) {
      throw new BadRequestException(
        'Definí un email para recibir avisos de operaciones sensibles.',
      );
    }

    await this.prisma.adminNotifyConfig.upsert({
      where: { businessId },
      create: { businessId, enabled, email, events },
      update: { enabled, email, events },
    });

    return this.getPublic(businessId);
  }

  async notifyAppointmentCreated(input: AppointmentNotifyInput): Promise<void> {
    await this.dispatch(input.businessId, 'appointment.created', () => {
      const when = this.formatWhen(input.startsAt, input.timezone);
      const name = input.contactName?.trim() || 'Sin nombre';
      const service = input.service?.name?.trim() || 'Clase';
      const trial = input.isTrial ? ' (clase de prueba)' : '';
      return {
        subject: `Nueva clase agendada — ${name}`,
        text: this.lines([
          `Se agendó una clase${trial}.`,
          `Alumno: ${name}`,
          `Servicio: ${service}`,
          `Fecha: ${when}`,
          input.contactPhone ? `Teléfono: ${input.contactPhone}` : null,
          input.contactEmail ? `Email: ${input.contactEmail}` : null,
          input.notes ? `Notas: ${input.notes}` : null,
          this.panelLink('/calendar'),
        ]),
        html: this.htmlBlock('Nueva clase agendada', [
          ['Alumno', name + trial],
          ['Servicio', service],
          ['Fecha', when],
          ['Teléfono', input.contactPhone],
          ['Email', input.contactEmail],
          ['Notas', input.notes],
        ], '/calendar'),
      };
    });
  }

  async notifyAppointmentCancelled(
    input: AppointmentNotifyInput,
  ): Promise<void> {
    await this.dispatch(input.businessId, 'appointment.cancelled', () => {
      const when = this.formatWhen(input.startsAt, input.timezone);
      const name = input.contactName?.trim() || 'Sin nombre';
      const service = input.service?.name?.trim() || 'Clase';
      return {
        subject: `Clase cancelada — ${name}`,
        text: this.lines([
          'Se canceló una clase.',
          `Alumno: ${name}`,
          `Servicio: ${service}`,
          `Fecha: ${when}`,
          input.contactPhone ? `Teléfono: ${input.contactPhone}` : null,
          this.panelLink('/calendar'),
        ]),
        html: this.htmlBlock('Clase cancelada', [
          ['Alumno', name],
          ['Servicio', service],
          ['Fecha', when],
          ['Teléfono', input.contactPhone],
        ], '/calendar'),
      };
    });
  }

  async notifyAppointmentRescheduled(
    input: AppointmentNotifyInput,
  ): Promise<void> {
    await this.dispatch(input.businessId, 'appointment.rescheduled', () => {
      const when = this.formatWhen(input.startsAt, input.timezone);
      const previous = input.previousStartsAt
        ? this.formatWhen(input.previousStartsAt, input.timezone)
        : null;
      const name = input.contactName?.trim() || 'Sin nombre';
      const service = input.service?.name?.trim() || 'Clase';
      return {
        subject: `Clase reprogramada — ${name}`,
        text: this.lines([
          'Se reprogramó una clase.',
          `Alumno: ${name}`,
          `Servicio: ${service}`,
          previous ? `Antes: ${previous}` : null,
          `Ahora: ${when}`,
          input.contactPhone ? `Teléfono: ${input.contactPhone}` : null,
          this.panelLink('/calendar'),
        ]),
        html: this.htmlBlock('Clase reprogramada', [
          ['Alumno', name],
          ['Servicio', service],
          ['Antes', previous],
          ['Ahora', when],
          ['Teléfono', input.contactPhone],
        ], '/calendar'),
      };
    });
  }

  async notifyLeadCreated(input: LeadNotifyInput): Promise<void> {
    await this.dispatch(input.businessId, 'lead.created', () => {
      const name = input.name?.trim() || 'Sin nombre';
      return {
        subject: `Nuevo lead — ${name}`,
        text: this.lines([
          'Se generó un lead nuevo.',
          `Nombre: ${name}`,
          input.phone ? `Teléfono: ${input.phone}` : null,
          input.email ? `Email: ${input.email}` : null,
          input.source ? `Origen: ${input.source}` : null,
          input.interest ? `Interés: ${input.interest}` : null,
          input.status ? `Estado: ${input.status}` : null,
          input.message ? `Mensaje: ${input.message}` : null,
          this.panelLink(`/leads/${input.id}`),
        ]),
        html: this.htmlBlock('Nuevo lead', [
          ['Nombre', name],
          ['Teléfono', input.phone],
          ['Email', input.email],
          ['Origen', input.source],
          ['Interés', input.interest],
          ['Estado', input.status],
          ['Mensaje', input.message],
        ], `/leads/${input.id}`),
      };
    });
  }

  async notifyClientAutoCreated(
    input: ClientAutoCreatedNotifyInput,
  ): Promise<void> {
    await this.dispatch(input.businessId, 'client.auto_created', () => {
      const name = input.name?.trim() || 'Sin nombre';
      return {
        subject: `Nuevo cliente automático — ${name}`,
        text: this.lines([
          'Se convirtió un lead a cliente de forma automática.',
          `Nombre: ${name}`,
          input.phone ? `Teléfono: ${input.phone}` : null,
          input.email ? `Email: ${input.email}` : null,
          input.source ? `Disparador: ${input.source}` : null,
          this.panelLink('/clientes'),
        ]),
        html: this.htmlBlock('Nuevo cliente automático', [
          ['Nombre', name],
          ['Teléfono', input.phone],
          ['Email', input.email],
          ['Disparador', input.source],
        ], '/clientes'),
      };
    });
  }

  private async dispatch(
    businessId: string,
    event: AdminNotifyEvent,
    build: () => { subject: string; text: string; html: string },
  ): Promise<void> {
    try {
      const config = await this.prisma.adminNotifyConfig.findUnique({
        where: { businessId },
      });
      if (!config?.enabled || !config.email) return;
      if (!this.normalizeEvents(config.events).includes(event)) return;

      const message = build();
      await this.email.send(
        {
          to: config.email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        businessId,
      );
      this.logger.log(
        `Aviso ${event} enviado business=${businessId} to=${config.email}`,
      );
    } catch (error) {
      this.logger.warn(
        `Aviso ${event} falló business=${businessId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private normalizeEvents(value: string[]): AdminNotifyEvent[] {
    const allowed = new Set<string>(ADMIN_NOTIFY_EVENTS);
    const unique: AdminNotifyEvent[] = [];
    for (const raw of value) {
      const event = raw.trim() as AdminNotifyEvent;
      if (!allowed.has(event) || unique.includes(event)) continue;
      unique.push(event);
    }
    return unique.length ? unique : [...DEFAULT_ADMIN_NOTIFY_EVENTS];
  }

  private normalizeEmail(value: string | null): string | null {
    if (value == null) return null;
    const email = value.trim().toLowerCase();
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Email de aviso inválido');
    }
    return email;
  }

  private formatWhen(date: Date, timezone?: string | null): string {
    const zone = timezone?.trim() || 'America/Argentina/Buenos_Aires';
    const dt = DateTime.fromJSDate(date).setZone(zone).setLocale('es');
    if (!dt.isValid) return date.toISOString();
    return dt.toFormat("cccc d 'de' LLLL, HH:mm");
  }

  private panelUrl(path: string): string | null {
    const base = (
      this.env.get<string>('ADMIN_URL') ||
      this.env.get<string>('NEXT_PUBLIC_ADMIN_URL') ||
      ''
    ).replace(/\/$/, '');
    return base ? `${base}${path}` : null;
  }

  private panelLink(path: string): string | null {
    const url = this.panelUrl(path);
    return url ? `Panel: ${url}` : null;
  }

  private lines(items: Array<string | null | undefined>): string {
    return items.filter((item): item is string => Boolean(item)).join('\n');
  }

  private htmlBlock(
    title: string,
    rows: Array<[string, string | null | undefined]>,
    path: string,
  ): string {
    const body = rows
      .filter(([, value]) => Boolean(value?.trim()))
      .map(
        ([label, value]) =>
          `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value!.trim())}</p>`,
      )
      .join('');
    const url = this.panelUrl(path);
    const link = url
      ? `<p><a href="${escapeHtml(url)}">Abrir el panel</a></p>`
      : '';
    return `<p>${escapeHtml(title)}.</p>${body}${link}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
