import { CheckAvailabilityTool } from './check-availability.tool';

describe('CheckAvailabilityTool', () => {
  const appointments = { checkAvailability: jest.fn() };
  const prisma = {} as never;
  const tool = new CheckAvailabilityTool(appointments as never, prisma);

  const ctx = {
    businessId: 'biz-1',
    conversationId: 'conv-1',
    channel: 'PLAYGROUND',
    enabledTools: ['checkAvailability'],
  };

  beforeEach(() => jest.clearAllMocks());

  const baseResult = {
    date: '2099-09-10',
    dayLabel: 'jueves',
    today: '2099-09-04',
    isToday: false,
    isPast: false,
    timezone: 'America/Argentina/Buenos_Aires',
    durationMinutes: 60,
    serviceId: null,
    serviceName: null,
    googleConnected: false,
  };

  it('dice que la clase está completa (no "inicio habitual") cuando la hora pedida es una clase llena', async () => {
    appointments.checkAvailability.mockResolvedValue({
      ...baseResult,
      slots: [
        {
          start: '19:00',
          end: '20:00',
          startIso: '2099-09-10T19:00:00.000-03:00',
          endIso: '2099-09-10T20:00:00.000-03:00',
          remaining: 3,
          capacity: 6,
        },
      ],
      fullSlots: [
        {
          start: '18:00',
          startIso: '2099-09-10T18:00:00.000-03:00',
          remaining: 0,
          capacity: 6,
        },
      ],
    });

    const result = await tool.execute(
      { date: '2099-09-10', time: '18:00' },
      ctx,
    );

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.classFull).toBe(true);
    expect(String(data.hint)).toMatch(/complet|cupo/i);
    expect(String(data.hint)).not.toMatch(/inicio habitual/i);
  });

  it('dice que no hay clase a esa hora cuando la hora pedida no está en la grilla', async () => {
    appointments.checkAvailability.mockResolvedValue({
      ...baseResult,
      slots: [
        {
          start: '19:00',
          end: '20:00',
          startIso: '2099-09-10T19:00:00.000-03:00',
          endIso: '2099-09-10T20:00:00.000-03:00',
          remaining: 3,
          capacity: 6,
        },
      ],
      fullSlots: [],
    });

    const result = await tool.execute(
      { date: '2099-09-10', time: '15:30' },
      ctx,
    );

    const data = result.data as Record<string, unknown>;
    expect(String(data.hint)).toMatch(/no hay ninguna clase/i);
    expect(String(data.hint)).not.toMatch(/inicio habitual/i);
  });

  it('avisa que todas las clases del día están completas', async () => {
    appointments.checkAvailability.mockResolvedValue({
      ...baseResult,
      slots: [],
      fullSlots: [
        {
          start: '18:00',
          startIso: '2099-09-10T18:00:00.000-03:00',
          remaining: 0,
          capacity: 6,
        },
        {
          start: '19:00',
          startIso: '2099-09-10T19:00:00.000-03:00',
          remaining: 0,
          capacity: 6,
        },
      ],
    });

    const result = await tool.execute({ date: '2099-09-10' }, ctx);

    const data = result.data as Record<string, unknown>;
    expect(String(data.hint)).toMatch(/todas las clases.*complet/i);
  });
});
