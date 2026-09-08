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
    classTemplate: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    classTemplateFindMany: jest.fn(),
    servicePass: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  } as any;
  const availability = {
    getAvailableSlots: jest.fn(),
    getDayClassStarts: jest.fn(),
  };
  const google = {
    isConnected: jest.fn().mockResolvedValue(false),
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue('evt-1'),
    updateEvent: jest.fn().mockResolvedValue(true),
    deleteEvent: jest.fn().mockResolvedValue(true),
  };
  const conversions = { maybeConvertFromSignal: jest.fn().mockResolvedValue(undefined) };
  const packs = {
    getBalance: jest.fn().mockResolvedValue({ hasAvailableClasses: true, availableClasses: 5 }),
    consumeCredit: jest.fn(),
  };
  const makeup = {
    countByUserAndMonth: jest.fn().mockResolvedValue(new Map()),
    countForMonth: jest.fn().mockResolvedValue(0),
  };
  const adminNotify = {
    notifyAppointmentCreated: jest.fn().mockResolvedValue(undefined),
    notifyAppointmentCancelled: jest.fn().mockResolvedValue(undefined),
    notifyAppointmentRescheduled: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AppointmentsService(
    prisma as never,
    availability as never,
    google as never,
    conversions as never,
    packs as never,
    makeup as never,
    adminNotify as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Argentina/Buenos_Aires',
    });
    prisma.classTemplate.findFirst.mockResolvedValue(null);
    prisma.appointment.findMany.mockResolvedValue([]);
    availability.getDayClassStarts.mockResolvedValue([]);
    packs.getBalance.mockResolvedValue({ hasAvailableClasses: true, availableClasses: 5, activePacks: [], allPacks: [] });
    conversions.maybeConvertFromSignal.mockResolvedValue(undefined);
    makeup.countByUserAndMonth.mockResolvedValue(new Map());
    google.listEvents.mockResolvedValue([]);
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

  it('checkAvailability expone en fullSlots las clases sin cupo que aún no arrancaron', async () => {
    prisma.service.findFirst.mockResolvedValue(null);
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '19:00',
        end: '20:00',
        startIso: '2099-09-10T19:00:00.000-03:00',
        endIso: '2099-09-10T20:00:00.000-03:00',
        remaining: 2,
        capacity: 6,
      },
    ]);
    availability.getDayClassStarts.mockResolvedValue([
      {
        start: '18:00',
        startIso: '2099-09-10T18:00:00.000-03:00',
        remaining: 0,
        capacity: 6,
      },
      {
        start: '19:00',
        startIso: '2099-09-10T19:00:00.000-03:00',
        remaining: 2,
        capacity: 6,
      },
    ]);

    const result = await service.checkAvailability({
      businessId: 'biz-1',
      date: '2099-09-10',
    });

    expect(result.fullSlots).toEqual([
      expect.objectContaining({ start: '18:00', remaining: 0, capacity: 6 }),
    ]);
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

  it('reservar de nuevo la misma prueba (misma conversación/horario) devuelve el turno hecho, no "ya usaste tu prueba"', async () => {
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '17:00',
        end: '17:30',
        startIso: '2099-09-08T17:00:00.000-03:00',
        endIso: '2099-09-08T17:30:00.000-03:00',
      },
    ]);
    const yaReservado = {
      id: 'apt-existing',
      startsAt: new Date('2099-09-08T20:00:00.000Z'),
      endsAt: new Date('2099-09-08T20:30:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'confirmed',
      isTrial: true,
      contactName: 'Julieta',
      contactPhone: '+54 9 11 6436-9670',
      conversationId: 'conv-1',
      service: null,
    };
    // El turno de prueba ya existe: lo encontraría tanto la idempotencia como el guard.
    prisma.appointment.findFirst.mockResolvedValue(yaReservado);

    const result = await service.create({
      businessId: 'biz-1',
      startsAt: new Date('2099-09-08T20:00:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      contactName: 'Julieta',
      contactPhone: '1164369670',
      isTrial: true,
      conversationId: 'conv-1',
    });

    expect(result.id).toBe('apt-existing');
    expect(prisma.appointment.create).not.toHaveBeenCalled();
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('un turno de prueba cancelado no bloquea reservar otra prueba', async () => {
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '17:00',
        end: '17:30',
        startIso: '2099-09-08T17:00:00.000-03:00',
        endIso: '2099-09-08T17:30:00.000-03:00',
      },
    ]);
    // Sólo hay una prueba previa CANCELADA para este teléfono.
    prisma.appointment.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.status?.notIn?.includes('cancelled')) return null;
      return { id: 'apt-cancelada', status: 'cancelled', isTrial: true };
    });
    prisma.appointment.create.mockImplementation(
      async ({ data }: { data: unknown }) => ({
        id: 'apt-new',
        ...(data as object),
        startsAt: new Date('2099-09-08T20:00:00.000Z'),
        endsAt: new Date('2099-09-08T20:30:00.000Z'),
        service: null,
      }),
    );

    const result = await service.create({
      businessId: 'biz-1',
      startsAt: new Date('2099-09-08T20:00:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      contactName: 'Julieta',
      contactPhone: '1164369670',
      isTrial: true,
    });

    expect(result.id).toBe('apt-new');
  });

  it('create marca la cita como recupero cuando se lo piden', async () => {
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '17:00',
        end: '17:30',
        startIso: '2099-09-08T17:00:00.000-03:00',
        endIso: '2099-09-08T17:30:00.000-03:00',
      },
    ]);
    prisma.appointment.findFirst.mockResolvedValue(null);
    prisma.appointment.create.mockImplementation(
      async ({ data }: { data: unknown }) => ({
        id: 'apt-recupero',
        ...(data as object),
        startsAt: new Date('2099-09-08T20:00:00.000Z'),
        endsAt: new Date('2099-09-08T20:30:00.000Z'),
        service: null,
      }),
    );

    const result = await service.create({
      businessId: 'biz-1',
      startsAt: new Date('2099-09-08T20:00:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      contactName: 'Julieta',
      contactPhone: '1164369670',
      isMakeup: true,
    });

    expect(result.isMakeup).toBe(true);
    expect(result.isTrial).toBe(false);
  });

  it('create deja isMakeup en false si no lo piden', async () => {
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '17:00',
        end: '17:30',
        startIso: '2099-09-08T17:00:00.000-03:00',
        endIso: '2099-09-08T17:30:00.000-03:00',
      },
    ]);
    prisma.appointment.findFirst.mockResolvedValue(null);
    prisma.appointment.create.mockImplementation(
      async ({ data }: { data: unknown }) => ({
        id: 'apt-normal',
        ...(data as object),
        startsAt: new Date('2099-09-08T20:00:00.000Z'),
        endsAt: new Date('2099-09-08T20:30:00.000Z'),
        service: null,
      }),
    );

    const result = await service.create({
      businessId: 'biz-1',
      startsAt: new Date('2099-09-08T20:00:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      contactName: 'Julieta',
      contactPhone: '1164369670',
    });

    expect(result.isMakeup).toBe(false);
  });

  it('create rechaza una clase que sea prueba y recupero a la vez', async () => {
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '17:00',
        end: '17:30',
        startIso: '2099-09-08T17:00:00.000-03:00',
        endIso: '2099-09-08T17:30:00.000-03:00',
      },
    ]);
    prisma.appointment.findFirst.mockResolvedValue(null);

    await expect(
      service.create({
        businessId: 'biz-1',
        startsAt: new Date('2099-09-08T20:00:00.000Z'),
        timezone: 'America/Argentina/Buenos_Aires',
        contactName: 'Julieta',
        contactPhone: '1164369670',
        isTrial: true,
        isMakeup: true,
      }),
    ).rejects.toThrow(/prueba/i);
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

  it('listClasses no mezcla un pack agotado con el pack nuevo al calcular clase X/Y (status sigue en ACTIVE aunque esté sin clases)', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'apt-1',
        userId: 'user-1',
        contactName: 'Ana',
        contactPhone: '54911',
        contactEmail: null,
        status: 'confirmed',
        notes: null,
        isTrial: false,
        startsAt: new Date('2099-09-10T13:00:00.000Z'),
        endsAt: new Date('2099-09-10T14:00:00.000Z'),
        service: { id: 'svc-1', name: 'Pilates', durationMinutes: 60, capacity: 6 },
      },
    ]);
    prisma.servicePass.findMany.mockResolvedValue([
      {
        userId: 'user-1',
        sessionsPaid: 12,
        sessionsUsed: 12,
        // el flujo real de "Gestionar packs" (payments.service.ts) nunca pasa el status a
        // COMPLETED al agotarse: se queda en ACTIVE para siempre.
        status: 'ACTIVE',
        createdAt: new Date('2099-08-01T00:00:00.000Z'),
        service: { name: 'Pack 12 clases' },
      },
      {
        userId: 'user-1',
        sessionsPaid: 12,
        sessionsUsed: 0,
        status: 'ACTIVE',
        createdAt: new Date('2099-09-01T00:00:00.000Z'),
        service: { name: 'Pack 12 clases' },
      },
    ]);

    const result = await service.listClasses('biz-1', '2099-09-10', '2099-09-11');

    const attendee = result.sessions[0].attendees[0];
    expect(attendee.packProgress).toEqual(
      expect.objectContaining({ total: 12, used: 0, remaining: 12 }),
    );
    expect(attendee.classLabel).toBe('clase 1/12');
  });

  it('listClasses expone el recupero y cuántos lleva la alumna ese mes', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'apt-1',
        businessId: 'biz-1',
        userId: 'u1',
        startsAt: new Date('2026-09-15T13:00:00.000Z'),
        endsAt: new Date('2026-09-15T14:00:00.000Z'),
        status: 'confirmed',
        isTrial: false,
        isMakeup: true,
        contactName: 'Ana',
        contactPhone: null,
        contactEmail: null,
        notes: null,
        service: { id: 'svc-1', name: 'Pilates', durationMinutes: 60, capacity: 6 },
      },
    ]);
    prisma.classTemplate.findMany.mockResolvedValue([]);
    makeup.countByUserAndMonth.mockResolvedValue(new Map([['u1:2026-09', 2]]));

    const result = await service.listClasses('biz-1', '2026-09-14', '2026-09-21');

    const attendee = result.sessions[0].attendees[0];
    expect(attendee.isMakeup).toBe(true);
    expect(attendee.makeupsThisMonth).toBe(2);
  });

  it('listClasses deja el contador en 0 para quien no tiene recuperos ese mes', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'apt-2',
        businessId: 'biz-1',
        userId: 'u2',
        startsAt: new Date('2026-09-15T13:00:00.000Z'),
        endsAt: new Date('2026-09-15T14:00:00.000Z'),
        status: 'confirmed',
        isTrial: false,
        isMakeup: false,
        contactName: 'Bea',
        contactPhone: null,
        contactEmail: null,
        notes: null,
        service: { id: 'svc-1', name: 'Pilates', durationMinutes: 60, capacity: 6 },
      },
    ]);
    prisma.classTemplate.findMany.mockResolvedValue([]);
    makeup.countByUserAndMonth.mockResolvedValue(new Map([['u1:2026-09', 2]]));

    const result = await service.listClasses('biz-1', '2026-09-14', '2026-09-21');

    const attendee = result.sessions[0].attendees[0];
    expect(attendee.isMakeup).toBe(false);
    expect(attendee.makeupsThisMonth).toBe(0);
  });

  it('setMakeup marca una cita existente como recupero', async () => {
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'apt-1',
      businessId: 'biz-1',
      isTrial: false,
      isMakeup: false,
      service: null,
    });
    prisma.appointment.update.mockImplementation(
      async ({ data }: { data: unknown }) => ({ id: 'apt-1', ...(data as object) }),
    );

    const result = await service.setMakeup('biz-1', 'apt-1', true);

    expect(result.isMakeup).toBe(true);
  });

  it('setMakeup no deja marcar como recupero una clase de prueba', async () => {
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'apt-1',
      businessId: 'biz-1',
      isTrial: true,
      isMakeup: false,
      service: null,
    });

    await expect(service.setMakeup('biz-1', 'apt-1', true)).rejects.toThrow(/prueba/i);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('listFeed indica en el título que la clase es un recupero', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'apt-1',
        businessId: 'biz-1',
        userId: 'u1',
        startsAt: new Date('2026-09-15T13:00:00.000Z'),
        endsAt: new Date('2026-09-15T14:00:00.000Z'),
        status: 'confirmed',
        isTrial: false,
        isMakeup: true,
        contactName: 'Ana',
        contactPhone: null,
        contactEmail: null,
        notes: null,
        googleEventId: null,
        service: { id: 'svc-1', name: 'Pilates', durationMinutes: 60 },
      },
    ]);

    const feed = await service.listFeed('biz-1', '2026-09-14', '2026-09-21');

    expect(feed.items[0].title).toBe('Ana — Pilates · recupero');
  });

  it('listFeed deja el título sin recupero en una clase normal', async () => {
    prisma.appointment.findMany.mockResolvedValue([
      {
        id: 'apt-1',
        businessId: 'biz-1',
        userId: 'u1',
        startsAt: new Date('2026-09-15T13:00:00.000Z'),
        endsAt: new Date('2026-09-15T14:00:00.000Z'),
        status: 'confirmed',
        isTrial: false,
        isMakeup: false,
        contactName: 'Ana',
        contactPhone: null,
        contactEmail: null,
        notes: null,
        googleEventId: null,
        service: { id: 'svc-1', name: 'Pilates', durationMinutes: 60 },
      },
    ]);

    const feed = await service.listFeed('biz-1', '2026-09-14', '2026-09-21');

    expect(feed.items[0].title).toBe('Ana — Pilates');
  });

  it('el evento de Google de un recupero lo dice en el título', async () => {
    prisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      name: 'Pilates',
      durationMinutes: 60,
      capacity: 6,
    });
    availability.getAvailableSlots.mockResolvedValue([
      {
        start: '17:00',
        end: '18:00',
        startIso: '2099-09-08T17:00:00.000-03:00',
        endIso: '2099-09-08T18:00:00.000-03:00',
      },
    ]);
    prisma.appointment.findFirst.mockResolvedValue(null);
    prisma.appointment.create.mockImplementation(
      async ({ data }: { data: unknown }) => ({
        id: 'apt-recupero',
        ...(data as object),
        startsAt: new Date('2099-09-08T20:00:00.000Z'),
        endsAt: new Date('2099-09-08T21:00:00.000Z'),
        service: null,
      }),
    );

    await service.create({
      businessId: 'biz-1',
      serviceId: 'svc-1',
      startsAt: new Date('2099-09-08T20:00:00.000Z'),
      timezone: 'America/Argentina/Buenos_Aires',
      contactName: 'Ana',
      isMakeup: true,
    });

    expect(google.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Ana — Pilates · recupero' }),
    );
  });
});
