import { planBalances, planRoster } from './reconcile';

const services = [
  { id: 'svc4', sessionCount: 4 },
  { id: 'svc8', sessionCount: 8 },
  { id: 'svc12', sessionCount: 12 },
];

describe('planBalances', () => {
  it('creates a pass for a student who has none', () => {
    const { actions } = planBalances({
      students: [
        { userId: 'u1', name: 'Ana', progress: { taken: 3, size: 8 } },
      ],
      passes: [],
      services,
    });
    expect(actions).toEqual([
      {
        kind: 'create',
        userId: 'u1',
        name: 'Ana',
        serviceId: 'svc8',
        sessionCount: 8,
        sessionsPaid: 8,
        sessionsUsed: 3,
        status: 'ACTIVE',
      },
    ]);
  });

  it('marks the pass COMPLETED when the pack is used up', () => {
    const { actions } = planBalances({
      students: [
        { userId: 'u1', name: 'Ana', progress: { taken: 8, size: 8 } },
      ],
      passes: [],
      services,
    });
    expect(actions[0]).toMatchObject({ sessionsUsed: 8, status: 'COMPLETED' });
  });

  it('updates the newest pass in place and records the previous used count', () => {
    const { actions } = planBalances({
      students: [
        { userId: 'u1', name: 'Ana', progress: { taken: 5, size: 8 } },
      ],
      passes: [
        {
          id: 'p1',
          userId: 'u1',
          serviceId: 'svc8',
          sessionCount: 8,
          sessionsPaid: 8,
          sessionsUsed: 3,
          status: 'ACTIVE',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      services,
    });
    expect(actions).toEqual([
      {
        kind: 'update',
        passId: 'p1',
        userId: 'u1',
        name: 'Ana',
        serviceId: 'svc8',
        sessionCount: 8,
        sessionsPaid: 8,
        sessionsUsed: 5,
        status: 'ACTIVE',
        prevUsed: 3,
      },
    ]);
  });

  it('does nothing when the pass already reflects SigueFit', () => {
    const { actions } = planBalances({
      students: [
        { userId: 'u1', name: 'Ana', progress: { taken: 3, size: 8 } },
      ],
      passes: [
        {
          id: 'p1',
          userId: 'u1',
          serviceId: 'svc8',
          sessionCount: 8,
          sessionsPaid: 8,
          sessionsUsed: 3,
          status: 'ACTIVE',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      services,
    });
    expect(actions).toEqual([]);
  });

  it('retires older extra passes so they stop adding to the balance', () => {
    const { actions } = planBalances({
      students: [
        { userId: 'u1', name: 'Ana', progress: { taken: 2, size: 8 } },
      ],
      passes: [
        {
          id: 'old',
          userId: 'u1',
          serviceId: 'svc4',
          sessionCount: 4,
          sessionsPaid: 4,
          sessionsUsed: 1,
          status: 'ACTIVE',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'new',
          userId: 'u1',
          serviceId: 'svc8',
          sessionCount: 8,
          sessionsPaid: 8,
          sessionsUsed: 2,
          status: 'ACTIVE',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      services,
    });
    expect(actions).toContainEqual({
      kind: 'retire',
      passId: 'old',
      userId: 'u1',
      name: 'Ana',
    });
    expect(actions.some((a) => a.kind === 'update' && a.passId === 'new')).toBe(
      false,
    );
  });

  it('flags a missing pack service instead of guessing', () => {
    const { actions, issues } = planBalances({
      students: [
        { userId: 'u1', name: 'Ana', progress: { taken: 1, size: 6 } },
      ],
      passes: [],
      services,
    });
    expect(actions).toEqual([]);
    expect(issues[0]).toMatch(/Pack 6/);
  });
});

describe('planRoster', () => {
  const timezone = 'America/Argentina/Buenos_Aires';
  const now = '2026-09-01T12:00:00.000Z';
  // Wed 2026-09-02 09:00 in Buenos Aires (UTC-3) => 12:00Z
  const wed0900Z = '2026-09-02T12:00:00.000Z';
  const templates = [
    {
      dayOfWeek: 2,
      startTime: '09:00',
      serviceId: 'svc8',
      durationMinutes: 60,
      capacity: 2,
    },
  ];

  it('creates the appointment when SigueFit has a student the agenda does not', () => {
    const { toCreate, toCancel, issues } = planRoster({
      desired: [{ userId: 'u1', name: 'Ana', startsAtUTC: wed0900Z }],
      current: [],
      templates,
      timezone,
      now,
    });
    expect(toCancel).toEqual([]);
    expect(issues).toEqual([]);
    expect(toCreate).toEqual([
      {
        userId: 'u1',
        name: 'Ana',
        startsAtUTC: wed0900Z,
        endsAtUTC: '2026-09-02T13:00:00.000Z',
        serviceId: 'svc8',
      },
    ]);
  });

  it('cancels a future confirmed appointment that is no longer in SigueFit', () => {
    const { toCreate, toCancel } = planRoster({
      desired: [],
      current: [
        { id: 'a1', userId: 'u1', startsAtUTC: wed0900Z, status: 'confirmed' },
      ],
      templates,
      timezone,
      now,
    });
    expect(toCreate).toEqual([]);
    expect(toCancel).toEqual([
      { appointmentId: 'a1', userId: 'u1', name: null, startsAtUTC: wed0900Z },
    ]);
  });

  it('leaves matching appointments untouched', () => {
    const { toCreate, toCancel } = planRoster({
      desired: [{ userId: 'u1', name: 'Ana', startsAtUTC: wed0900Z }],
      current: [
        { id: 'a1', userId: 'u1', startsAtUTC: wed0900Z, status: 'confirmed' },
      ],
      templates,
      timezone,
      now,
    });
    expect(toCreate).toEqual([]);
    expect(toCancel).toEqual([]);
  });

  it('never touches past classes', () => {
    const past = '2026-08-26T12:00:00.000Z';
    const { toCreate, toCancel } = planRoster({
      desired: [{ userId: 'u2', name: 'Bea', startsAtUTC: past }],
      current: [
        { id: 'a1', userId: 'u1', startsAtUTC: past, status: 'confirmed' },
      ],
      templates,
      timezone,
      now,
    });
    expect(toCreate).toEqual([]);
    expect(toCancel).toEqual([]);
  });

  it('flags a slot with no template in the class grid', () => {
    const { toCreate, issues } = planRoster({
      desired: [
        { userId: 'u1', name: 'Ana', startsAtUTC: '2026-09-02T20:00:00.000Z' },
      ],
      current: [],
      templates,
      timezone,
      now,
    });
    expect(toCreate).toEqual([]);
    expect(issues[0]).toMatch(/grilla/i);
  });

  it('does not exceed the class capacity', () => {
    const { toCreate, issues } = planRoster({
      desired: [
        { userId: 'u1', name: 'Ana', startsAtUTC: wed0900Z },
        { userId: 'u2', name: 'Bea', startsAtUTC: wed0900Z },
        { userId: 'u3', name: 'Cami', startsAtUTC: wed0900Z },
      ],
      current: [],
      templates,
      timezone,
      now,
    });
    expect(toCreate).toHaveLength(2);
    expect(issues[0]).toMatch(/llena|cupo/i);
  });
});
