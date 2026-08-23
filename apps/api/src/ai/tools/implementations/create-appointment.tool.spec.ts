import { CreateAppointmentTool } from './create-appointment.tool';

describe('CreateAppointmentTool', () => {
  const appointments = { create: jest.fn() };
  const prisma = {
    business: { findUniqueOrThrow: jest.fn() },
    service: { findFirst: jest.fn() },
  };
  const leads = { capture: jest.fn() };
  const tool = new CreateAppointmentTool(
    appointments as never,
    prisma as never,
    leads as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Argentina/Buenos_Aires',
      defaultMessages: {},
      googleReviewsUrl: null,
    });
    leads.capture.mockResolvedValue({ id: 'lead-1' });
  });

  it('captures a lead after a successful booking', async () => {
    appointments.create.mockResolvedValue({
      id: 'apt-1',
      startsAt: new Date('2026-08-23T13:00:00.000Z'),
      endsAt: new Date('2026-08-23T13:30:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'confirmed',
      service: { id: 'svc-1', name: 'Consulta inicial', durationMinutes: 30 },
      contactName: 'Ana',
      contactPhone: '54911',
      contactEmail: 'ana@test.com',
    });

    const result = await tool.execute(
      {
        startsAt: '2026-08-23T10:00:00-03:00',
        contactName: 'Ana',
        contactPhone: '54911',
        contactEmail: 'ana@test.com',
      },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'PLAYGROUND',
        enabledTools: ['createAppointment'],
      },
    );

    expect(result.success).toBe(true);
    expect(leads.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        name: 'Ana',
        phone: '54911',
        email: 'ana@test.com',
        source: 'PLAYGROUND',
        metadata: expect.objectContaining({ appointmentId: 'apt-1' }),
      }),
    );
  });

  it('still confirms the appointment if lead capture fails', async () => {
    appointments.create.mockResolvedValue({
      id: 'apt-1',
      startsAt: new Date('2026-08-23T13:00:00.000Z'),
      endsAt: new Date('2026-08-23T13:30:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'confirmed',
      service: null,
      contactName: 'Ana',
      contactPhone: null,
      contactEmail: null,
    });
    leads.capture.mockRejectedValue(new Error('db down'));

    const result = await tool.execute(
      {
        startsAt: '2026-08-23T10:00:00-03:00',
        contactName: 'Ana',
      },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'PLAYGROUND',
        enabledTools: ['createAppointment'],
      },
    );

    expect(result.success).toBe(true);
  });
});
