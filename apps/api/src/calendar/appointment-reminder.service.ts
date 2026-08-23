import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { EmailService } from '../email/email.service';
import { SocialInboxService } from '../social/social-inbox.service';
import { WhatsAppConfigService } from '../whatsapp/whatsapp-config.service';
import { WhatsAppProviderFactory } from '../whatsapp/providers/whatsapp-provider.factory';
import { APPOINTMENT_REMINDER_TICK_LOCK } from './appointment-reminder.queue';
import {
  clampReminderHours,
  DEFAULT_REMINDER_HOURS,
  DEFAULT_REMINDER_MESSAGE,
  normalizeReminderChannels,
  normalizeReminderEmail,
  normalizeReminderPhone,
  pickReminderChannel,
  reminderDueWindow,
  reminderServiceClause,
  renderReminderMessage,
  type ReminderChannel,
} from './reminder.util';

export interface AppointmentReminderPublicConfig {
  enabled: boolean;
  hoursBefore: number;
  channels: ReminderChannel[];
  message: string;
  channelsStatus: {
    whatsapp: { connected: boolean };
    email: { configured: boolean };
    instagram: { connected: boolean };
    facebook: { connected: boolean };
  };
}

const DEFAULT_CHANNELS: ReminderChannel[] = [
  'whatsapp',
  'email',
  'instagram',
  'facebook',
];

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly whatsappConfig: WhatsAppConfigService,
    private readonly whatsapp: WhatsAppProviderFactory,
    private readonly socialInbox: SocialInboxService,
  ) {}

  async getPublic(businessId: string): Promise<AppointmentReminderPublicConfig> {
    const [row, channelsStatus] = await Promise.all([
      this.prisma.appointmentReminderConfig.findUnique({
        where: { businessId },
      }),
      this.channelsStatus(businessId),
    ]);

    return {
      enabled: row?.enabled ?? false,
      hoursBefore: clampReminderHours(row?.hoursBefore ?? DEFAULT_REMINDER_HOURS),
      channels: normalizeReminderChannels(row?.channels ?? DEFAULT_CHANNELS),
      message: row?.message?.trim() || DEFAULT_REMINDER_MESSAGE,
      channelsStatus,
    };
  }

  async upsert(
    businessId: string,
    input: {
      enabled?: boolean;
      hoursBefore?: number;
      channels?: string[];
      message?: string | null;
    },
  ): Promise<AppointmentReminderPublicConfig> {
    const existing = await this.prisma.appointmentReminderConfig.findUnique({
      where: { businessId },
    });
    const enabled = input.enabled ?? existing?.enabled ?? false;
    const hoursBefore = clampReminderHours(
      input.hoursBefore ?? existing?.hoursBefore ?? DEFAULT_REMINDER_HOURS,
    );
    const channels = normalizeReminderChannels(
      input.channels ?? existing?.channels ?? DEFAULT_CHANNELS,
    );
    const message =
      input.message !== undefined
        ? input.message?.trim() || null
        : existing?.message ?? null;

    await this.prisma.appointmentReminderConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        enabled,
        hoursBefore,
        channels,
        message,
      },
      update: {
        enabled,
        hoursBefore,
        channels,
        message,
      },
    });

    return this.getPublic(businessId);
  }

  async processDue(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let holdLock = false;
    try {
      let proceed = false;
      try {
        holdLock = await this.redis.acquireLock(
          APPOINTMENT_REMINDER_TICK_LOCK,
          120,
        );
        proceed = holdLock;
      } catch (error) {
        this.logger.warn(
          `Lock Redis no disponible, sigo con claim en DB: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        proceed = true;
      }
      if (!proceed) return 0;

      const configs = await this.prisma.appointmentReminderConfig.findMany({
        where: { enabled: true },
        select: { businessId: true },
      });

      let sent = 0;
      for (const config of configs) {
        sent += await this.processBusiness(config.businessId, now);
      }
      return sent;
    } finally {
      if (holdLock) {
        try {
          await this.redis.releaseLock(APPOINTMENT_REMINDER_TICK_LOCK);
        } catch {
          // TTL del lock cubre el caso
        }
      }
      this.running = false;
    }
  }

  async processBusiness(businessId: string, now = new Date()): Promise<number> {
    const config = await this.prisma.appointmentReminderConfig.findUnique({
      where: { businessId },
      include: {
        business: {
          select: { id: true, name: true, timezone: true, defaultMessages: true },
        },
      },
    });
    if (!config?.enabled) return 0;

    const hoursBefore = clampReminderHours(config.hoursBefore);
    const { from, to } = reminderDueWindow(now, hoursBefore);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: { in: ['pending', 'confirmed'] },
        startsAt: { gt: from, lte: to },
        reminderLogs: {
          none: { status: { in: ['sent', 'pending', 'failed'] } },
        },
      },
      include: {
        service: { select: { name: true } },
        conversation: {
          select: {
            id: true,
            channel: true,
            externalId: true,
            contactPhone: true,
            contactName: true,
          },
        },
        user: { select: { email: true, phone: true, name: true } },
      },
    });

    let sent = 0;
    for (const appointment of appointments) {
      if (appointment.startsAt.getTime() <= now.getTime()) continue;

      const didSend = await this.sendForAppointment({
        appointment,
        businessName: config.business.name,
        timezone: config.business.timezone,
        hoursBefore,
        channels: normalizeReminderChannels(config.channels),
        template:
          config.message?.trim() ||
          this.configuredReminderMessage(config.business.defaultMessages) ||
          DEFAULT_REMINDER_MESSAGE,
      });
      if (didSend) sent += 1;
    }
    return sent;
  }

  private configuredReminderMessage(raw: unknown): string | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = (raw as Record<string, unknown>).appointmentReminder;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private async sendForAppointment(input: {
    appointment: {
      id: string;
      businessId: string;
      contactName: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
      startsAt: Date;
      timezone: string;
      conversationId: string | null;
      service: { name: string } | null;
      conversation: {
        id: string;
        channel: string;
        externalId: string | null;
        contactPhone: string | null;
        contactName: string | null;
      } | null;
      user: { email: string | null; phone: string | null; name: string | null } | null;
    };
    businessName: string;
    timezone: string;
    hoursBefore: number;
    channels: ReminderChannel[];
    template: string;
  }): Promise<boolean> {
    const { appointment } = input;
    const logId = await this.claimLog({
      businessId: appointment.businessId,
      appointmentId: appointment.id,
      hoursBefore: input.hoursBefore,
    });
    if (!logId) return false;

    const phone = normalizeReminderPhone(
      appointment.contactPhone ||
        appointment.conversation?.contactPhone ||
        appointment.user?.phone,
    );
    const email = normalizeReminderEmail(
      appointment.contactEmail || appointment.user?.email,
    );
    const instagramThread = Boolean(
      appointment.conversation?.channel === 'INSTAGRAM' &&
        appointment.conversation.externalId,
    );
    const facebookThread = Boolean(
      appointment.conversation?.channel === 'FACEBOOK' &&
        appointment.conversation.externalId,
    );

    const availability = {
      whatsappReady: phone
        ? await this.isWhatsAppReady(appointment.businessId)
        : false,
      emailReady: email
        ? Boolean(await this.email.resolveTransport(appointment.businessId))
        : false,
      instagramReady: instagramThread
        ? await this.isInstagramReady(appointment.businessId)
        : false,
      facebookReady: facebookThread
        ? await this.isFacebookReady(appointment.businessId)
        : false,
      phone,
      email,
      instagramThread,
      facebookThread,
    };
    const channel = pickReminderChannel(input.channels, availability);

    if (!channel) {
      await this.prisma.appointmentReminderLog.update({
        where: { id: logId },
        data: {
          status: 'skipped',
          channel: 'none',
          error:
            'No hay canal disponible: falta WhatsApp/email/Instagram/Messenger conectado o datos del cliente.',
        },
      });
      this.logger.warn(
        `Reminder skipped appointment=${appointment.id}: sin canal`,
      );
      return false;
    }

    const zone = appointment.timezone || input.timezone;
    const when = DateTime.fromJSDate(appointment.startsAt).setZone(zone);
    const nombre =
      appointment.contactName?.trim() ||
      appointment.conversation?.contactName?.trim() ||
      appointment.user?.name?.trim() ||
      'hola';
    const body = renderReminderMessage(input.template, {
      nombre,
      servicio: reminderServiceClause(appointment.service?.name),
      fecha: when.setLocale('es').toFormat("cccc d 'de' LLLL"),
      hora: when.toFormat('HH:mm'),
      negocio: input.businessName,
    });

    try {
      if (channel === 'whatsapp' && phone) {
        const provider = await this.whatsapp.getForBusiness(appointment.businessId);
        await provider.sendText({
          businessId: appointment.businessId,
          to: phone,
          body,
        });
      } else if (channel === 'email' && email) {
        await this.email.send(
          {
            to: email,
            subject: `Recordatorio de tu cita en ${input.businessName}`,
            text: body,
          },
          appointment.businessId,
        );
      } else if (
        (channel === 'instagram' || channel === 'facebook') &&
        appointment.conversationId
      ) {
        await this.socialInbox.sendForConversation({
          businessId: appointment.businessId,
          conversationId: appointment.conversationId,
          body,
        });
      } else {
        throw new Error(`Canal ${channel} sin datos suficientes`);
      }

      await this.prisma.appointmentReminderLog.update({
        where: { id: logId },
        data: {
          status: 'sent',
          channel,
          sentAt: new Date(),
          error: null,
        },
      });
      this.logger.log(
        `Reminder sent appointment=${appointment.id} channel=${channel}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      await this.prisma.appointmentReminderLog.update({
        where: { id: logId },
        data: {
          status: 'failed',
          channel,
          error: message.slice(0, 500),
        },
      });
      this.logger.warn(
        `Reminder failed appointment=${appointment.id} channel=${channel}: ${message}`,
      );
      return false;
    }
  }

  private async claimLog(input: {
    businessId: string;
    appointmentId: string;
    hoursBefore: number;
  }): Promise<string | null> {
    try {
      const created = await this.prisma.appointmentReminderLog.create({
        data: {
          businessId: input.businessId,
          appointmentId: input.appointmentId,
          hoursBefore: input.hoursBefore,
          channel: 'none',
          status: 'pending',
        },
      });
      return created.id;
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
      ) {
        throw error;
      }
    }

    const reclaimed = await this.prisma.appointmentReminderLog.updateMany({
      where: { appointmentId: input.appointmentId, status: 'skipped' },
      data: {
        status: 'pending',
        hoursBefore: input.hoursBefore,
        channel: 'none',
        error: null,
      },
    });
    if (!reclaimed.count) return null;

    const row = await this.prisma.appointmentReminderLog.findUnique({
      where: { appointmentId: input.appointmentId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async channelsStatus(businessId: string) {
    const [whatsapp, email, instagram, facebook] = await Promise.all([
      this.isWhatsAppReady(businessId),
      this.email.resolveTransport(businessId).then((t) => Boolean(t)),
      this.isInstagramReady(businessId),
      this.isFacebookReady(businessId),
    ]);
    return {
      whatsapp: { connected: whatsapp },
      email: { configured: email },
      instagram: { connected: instagram },
      facebook: { connected: facebook },
    };
  }

  private async isWhatsAppReady(businessId: string): Promise<boolean> {
    const config = await this.whatsappConfig.getForRuntime(businessId);
    if (!config?.enabled) return false;
    if (config.status === 'connected') return true;
    try {
      const provider = await this.whatsapp.getForBusiness(businessId);
      const live = await provider.getStatus(businessId);
      return live.status === 'connected';
    } catch {
      return false;
    }
  }

  private async isInstagramReady(businessId: string): Promise<boolean> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: {
        businessId_provider_platform: {
          businessId,
          provider: 'zernio',
          platform: 'instagram',
        },
      },
    });
    return connection?.status === 'connected';
  }

  private async isFacebookReady(businessId: string): Promise<boolean> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: {
        businessId_provider_platform: {
          businessId,
          provider: 'zernio',
          platform: 'facebook',
        },
      },
    });
    return connection?.status === 'connected';
  }
}
