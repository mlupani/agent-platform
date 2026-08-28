import { BadRequestException } from '@nestjs/common';
import { AdminNotifyService } from './admin-notify.service';

describe('AdminNotifyService', () => {
  const prisma = {
    adminNotifyConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const email = {
    resolveTransport: jest.fn(),
    send: jest.fn(),
  };
  const env = {
    get: jest.fn((key: string) =>
      key === 'ADMIN_URL' ? 'http://localhost:3000' : undefined,
    ),
  };
  const service = new AdminNotifyService(
    prisma as never,
    email as never,
    env as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    email.resolveTransport.mockResolvedValue({ provider: 'smtp' });
    email.send.mockResolvedValue({ messageId: 'm-1', provider: 'smtp' });
    env.get.mockImplementation((key: string) =>
      key === 'ADMIN_URL' ? 'http://localhost:3000' : undefined,
    );
  });

  it('returns defaults when there is no config row', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue(null);

    await expect(service.getPublic('biz-1')).resolves.toEqual({
      enabled: false,
      email: null,
      events: ['appointment.created', 'lead.created', 'client.auto_created'],
      emailConfigured: true,
    });
  });

  it('rejects enabling without an email', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue(null);

    await expect(
      service.upsert('biz-1', { enabled: true, email: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.adminNotifyConfig.upsert).not.toHaveBeenCalled();
  });

  it('does not send when disabled', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue({
      enabled: false,
      email: 'dueña@studio.com',
      events: ['appointment.created'],
    });

    await service.notifyAppointmentCreated({
      businessId: 'biz-1',
      id: 'apt-1',
      contactName: 'Ana',
      startsAt: new Date('2026-08-28T13:00:00.000Z'),
      timezone: 'UTC',
    });

    expect(email.send).not.toHaveBeenCalled();
  });

  it('skips events that are not enabled', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue({
      enabled: true,
      email: 'dueña@studio.com',
      events: ['lead.created'],
    });

    await service.notifyAppointmentCreated({
      businessId: 'biz-1',
      id: 'apt-1',
      contactName: 'Ana',
      startsAt: new Date('2026-08-28T13:00:00.000Z'),
      timezone: 'UTC',
    });

    expect(email.send).not.toHaveBeenCalled();
  });

  it('sends an appointment email to the configured address', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue({
      enabled: true,
      email: 'dueña@studio.com',
      events: ['appointment.created'],
    });

    await service.notifyAppointmentCreated({
      businessId: 'biz-1',
      id: 'apt-1',
      contactName: 'Ana',
      contactPhone: '54911',
      startsAt: new Date('2026-08-28T13:00:00.000Z'),
      timezone: 'UTC',
      isTrial: true,
      service: { name: 'Pilates' },
    });

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dueña@studio.com',
        subject: 'Nueva clase agendada — Ana',
        text: expect.stringContaining('Pilates'),
      }),
      'biz-1',
    );
    expect(email.send.mock.calls[0][0].text).toContain('clase de prueba');
  });

  it('sends lead and auto-client emails', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue({
      enabled: true,
      email: 'dueña@studio.com',
      events: ['lead.created', 'client.auto_created'],
    });

    await service.notifyLeadCreated({
      businessId: 'biz-1',
      id: 'lead-1',
      name: 'Luis',
      phone: '54911',
      source: 'WHATSAPP',
    });
    await service.notifyClientAutoCreated({
      businessId: 'biz-1',
      leadId: 'lead-1',
      name: 'Luis',
      source: 'appointment.confirmed',
    });

    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send.mock.calls[0][0].subject).toBe('Nuevo lead — Luis');
    expect(email.send.mock.calls[1][0].subject).toBe(
      'Nuevo cliente automático — Luis',
    );
  });

  it('does not throw if sending fails', async () => {
    prisma.adminNotifyConfig.findUnique.mockResolvedValue({
      enabled: true,
      email: 'dueña@studio.com',
      events: ['lead.created'],
    });
    email.send.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.notifyLeadCreated({
        businessId: 'biz-1',
        id: 'lead-1',
        name: 'Ana',
      }),
    ).resolves.toBeUndefined();
  });
});
