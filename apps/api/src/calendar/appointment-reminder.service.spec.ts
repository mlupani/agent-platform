import { Prisma } from '@prisma/client';
import { AppointmentReminderService } from './appointment-reminder.service';

describe('AppointmentReminderService', () => {
  const prisma = {
    appointmentReminderConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    appointment: { findMany: jest.fn() },
    appointmentReminderLog: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    socialConnection: { findUnique: jest.fn() },
  };
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const email = {
    resolveTransport: jest.fn(),
    send: jest.fn(),
  };
  const whatsappConfig = { getForRuntime: jest.fn() };
  const provider = { sendText: jest.fn(), getStatus: jest.fn() };
  const whatsapp = { getForBusiness: jest.fn().mockResolvedValue(provider) };
  const socialInbox = { sendForConversation: jest.fn() };

  const service = new AppointmentReminderService(
    prisma as never,
    redis as never,
    email as never,
    whatsappConfig as never,
    whatsapp as never,
    socialInbox as never,
  );

  function dueAppointment(overrides: Record<string, unknown> = {}) {
    return {
      id: 'apt-1',
      businessId: 'biz-1',
      contactName: 'Ana',
      contactPhone: '5491100000000',
      contactEmail: 'ana@test.com',
      startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      timezone: 'UTC',
      conversationId: null,
      service: { name: 'Corte' },
      conversation: null,
      user: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    whatsapp.getForBusiness.mockResolvedValue(provider);
    prisma.appointmentReminderConfig.findUnique.mockResolvedValue({
      enabled: true,
      hoursBefore: 2,
      channels: ['whatsapp', 'email'],
      message: 'Hola {{nombre}} a las {{hora}}',
      business: {
        id: 'biz-1',
        name: 'Studio',
        timezone: 'UTC',
        defaultMessages: {},
      },
    });
    whatsappConfig.getForRuntime.mockResolvedValue({
      enabled: true,
      status: 'connected',
    });
  });

  it('sends WhatsApp when phone and session are ready', async () => {
    prisma.appointment.findMany.mockResolvedValue([dueAppointment()]);
    prisma.appointmentReminderLog.create.mockResolvedValue({ id: 'log-1' });
    provider.sendText.mockResolvedValue({ externalId: 'wa-1' });

    const sent = await service.processBusiness('biz-1');

    expect(sent).toBe(1);
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        to: '5491100000000',
      }),
    );
    expect(prisma.appointmentReminderLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'sent', channel: 'whatsapp' }),
      }),
    );
  });

  it('falls back to email when WhatsApp is down', async () => {
    prisma.appointment.findMany.mockResolvedValue([dueAppointment()]);
    whatsappConfig.getForRuntime.mockResolvedValue({
      enabled: true,
      status: 'disconnected',
    });
    provider.getStatus.mockResolvedValue({ status: 'disconnected' });
    email.resolveTransport.mockResolvedValue({ provider: 'resend' });
    prisma.appointmentReminderLog.create.mockResolvedValue({ id: 'log-2' });
    email.send.mockResolvedValue({ id: 'em-1' });

    const sent = await service.processBusiness('biz-1');

    expect(sent).toBe(1);
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ana@test.com' }),
      'biz-1',
    );
  });

  it('does not send if another tick already claimed the appointment', async () => {
    prisma.appointment.findMany.mockResolvedValue([dueAppointment()]);
    prisma.appointmentReminderLog.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    prisma.appointmentReminderLog.updateMany.mockResolvedValue({ count: 0 });

    const sent = await service.processBusiness('biz-1');

    expect(sent).toBe(0);
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not retry a failed send (at-most-once)', async () => {
    prisma.appointment.findMany.mockResolvedValue([]);

    const sent = await service.processBusiness('biz-1');

    expect(sent).toBe(0);
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reminderLogs: {
            none: { status: { in: ['sent', 'pending', 'failed'] } },
          },
        }),
      }),
    );
  });

  it('can retry a skipped reminder if a channel becomes available', async () => {
    prisma.appointment.findMany.mockResolvedValue([dueAppointment()]);
    prisma.appointmentReminderLog.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    prisma.appointmentReminderLog.updateMany.mockResolvedValue({ count: 1 });
    prisma.appointmentReminderLog.findUnique.mockResolvedValue({ id: 'log-skip' });
    provider.sendText.mockResolvedValue({ externalId: 'wa-2' });

    const sent = await service.processBusiness('biz-1');

    expect(sent).toBe(1);
    expect(prisma.appointmentReminderLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { appointmentId: 'apt-1', status: 'skipped' },
      }),
    );
    expect(provider.sendText).toHaveBeenCalled();
  });

  it('skips the tick if another worker holds the redis lock', async () => {
    redis.acquireLock.mockResolvedValueOnce(false);
    prisma.appointmentReminderConfig.findMany.mockResolvedValue([
      { businessId: 'biz-1' },
    ]);

    const sent = await service.processDue();

    expect(sent).toBe(0);
    expect(prisma.appointmentReminderConfig.findMany).not.toHaveBeenCalled();
  });
});
