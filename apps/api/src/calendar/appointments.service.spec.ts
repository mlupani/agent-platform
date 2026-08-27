import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  const prisma = {
    business: { findUniqueOrThrow: jest.fn() },
    service: { findFirst: jest.fn() },
    conversation: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    appointment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    appointmentReminderLog: { deleteMany: jest.fn() },
    classTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
    classTemplateFindMany: jest.fn(),
    servicePass: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  } as any;
  const availability = { getAvailableSlots: jest.fn() };
  const google = {
    isConnected: jest.fn().mockResolvedValue(false),
    createEvent: jest.fn().mockResolvedValue('evt-1'),
    updateEvent: jest.fn().mockResolvedValue(true),
    deleteEvent: jest.fn().mockResolvedValue(true),
  };
  const conversions = { maybeConvertFromSignal: jest.fn().mockResolvedValue(undefined) };
  const packs = {
    getBalance: jest.fn().mockResolvedValue({ hasAvailableClasses: true, availableClasses: 5 }),
    consumeCredit: jest.fn(),
  };

  const service = new AppointmentsService(
    prisma as never,
    availability as never,
    google as never,
    conversions as never,
    packs as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Argentina/Buenos_Aires',
    });
    prisma.classTemplate.findFirst.mockResolvedValue(null);
    prisma.appointment.findMany.mockResolvedValue([]);
    packs.getBalance.mockResolvedValue({ hasAvailableClasses: true, availableClasses: 5, activePacks: [], allPacks: [] });
    conversions.maybeConvertFromSignal.mockResolvedValue(undefined);
  });

  it('checkAvailability uses service duration', async () => {
    prisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      name: 'Consulta',
      durationMinutes: 45,
    });
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '10:00',
        end: '10:45',
        startIso: '2026-08-12T10:00:00.000-03:00',
        endIso: '2026-08-12T10:45:00.000-03:00',
      },
    ]);

    const result = await service.checkAvailability({
      businessId: 'biz-1',
      date: '2026-08-12',
      serviceId: 'svc-1',
    });

    expect(availability.getAvailableSlots).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 45, serviceId: 'svc-1' }),
    );
    expect(result.slots).toHaveLength(1);
    expect(result.serviceName).toBe('Consulta');
  });

  it('create rejects unavailable slot', async () => {
    prisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      name: 'Consulta',
      durationMinutes: 30,
    });
    availability.getAvailableSlots.mockResolvedValue([]);

    await expect(
      service.create({
        businessId: 'biz-1',
        serviceId: 'svc-1',
        startsAt: new Date('2026-08-12T13:00:00.000Z'),
        timezone: 'America/Argentina/Buenos_Aires',
        contactName: 'Ana',
      }),
    ).rejects.toThrow(/no está disponible/i);

    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('create stores googleEventId when calendar returns id', async () => {
    prisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      name: 'Consulta',
      durationMinutes: 30,
    });
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '10:00',
        end: '10:30',
        startIso: '2099-08-12T10:00:00.000-03:00',
        endIso: '2099-08-12T10:30:00.000-03:00',
      },
    ]);
    prisma.appointment.create.mockImplementation(
      async ({ data }: { data: unknown }) => ({
        id: 'apt-1',
        ...(data as object),
        startsAt: new Date('2099-08-12T13:00:00.000Z'),
        endsAt: new Date('2099-08-12T13:30:00.000Z'),
        service: { id: 'svc-1', name: 'Consulta', durationMinutes: 30 },
      }),
    );

    const appointment = await service.create({
      businessId: 'biz-1',
      serviceId: 'svc-1',
      startsAt: new Date('2099-08-12T13:00:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      contactName: 'Ana',
      contactPhone: '54911',
    });

    expect(google.createEvent).toHaveBeenCalled();
    expect(prisma.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ googleEventId: 'evt-1' }),
      }),
    );
    expect(appointment.id).toBe('apt-1');
  });
});
