import { MakeupService, makeupKey } from './makeup.service';

const ZONE = 'America/Argentina/Buenos_Aires';

type Row = {
  businessId: string;
  userId: string | null;
  isMakeup: boolean;
  status: string;
  startsAt: Date;
};

/**
 * Prisma falso que interpreta el `where` de verdad, para que los tests midan
 * el comportamiento (qué se cuenta y qué no) y no la llamada al mock.
 */
function fakePrisma(rows: Row[], timezone = ZONE) {
  const matches = (row: Row, where: any): boolean => {
    if (where.businessId !== undefined && row.businessId !== where.businessId) return false;
    if (where.isMakeup !== undefined && row.isMakeup !== where.isMakeup) return false;
    if (where.userId?.in !== undefined && !where.userId.in.includes(row.userId)) return false;
    if (where.status?.notIn !== undefined && where.status.notIn.includes(row.status)) return false;
    if (where.startsAt?.gte !== undefined && row.startsAt < where.startsAt.gte) return false;
    if (where.startsAt?.lt !== undefined && row.startsAt >= where.startsAt.lt) return false;
    return true;
  };
  return {
    business: {
      findUniqueOrThrow: jest.fn(async () => ({ timezone })),
    },
    appointment: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((row) => matches(row, where)).map((row) => ({ userId: row.userId, startsAt: row.startsAt })),
      ),
    },
  };
}

// 2026-09-05 10:00 en Buenos Aires (UTC-3) => 13:00 UTC
const at = (iso: string) => new Date(iso);

describe('MakeupService', () => {
  describe('countForMonth', () => {
    it('cuenta sólo los recuperos de esa alumna dentro del mes de referencia', async () => {
      const prisma = fakePrisma([
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-05T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'completed', startsAt: at('2026-09-20T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: false, status: 'completed', startsAt: at('2026-09-10T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'completed', startsAt: at('2026-08-28T13:00:00Z') },
        { businessId: 'b1', userId: 'u2', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-07T13:00:00Z') },
      ]);
      const service = new MakeupService(prisma as any);

      await expect(service.countForMonth('b1', 'u1', at('2026-09-15T13:00:00Z'))).resolves.toBe(2);
    });

    it('no cuenta un recupero cancelado', async () => {
      const prisma = fakePrisma([
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-05T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'cancelled', startsAt: at('2026-09-12T13:00:00Z') },
      ]);
      const service = new MakeupService(prisma as any);

      await expect(service.countForMonth('b1', 'u1', at('2026-09-15T13:00:00Z'))).resolves.toBe(1);
    });

    it('no cuenta recuperos de otro negocio', async () => {
      const prisma = fakePrisma([
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-05T13:00:00Z') },
        { businessId: 'b2', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-12T13:00:00Z') },
      ]);
      const service = new MakeupService(prisma as any);

      await expect(service.countForMonth('b1', 'u1', at('2026-09-15T13:00:00Z'))).resolves.toBe(1);
    });

    it('corta el mes en la timezone del negocio, no en UTC ni en la del servidor', async () => {
      // Negocio en Madrid (UTC+2 en septiembre). 2026-09-30T23:30Z es allá
      // 2026-10-01 01:30 => octubre. En UTC y en Buenos Aires todavía es septiembre,
      // así que este caso sólo da bien si se usa la zona del negocio.
      const prisma = fakePrisma(
        [{ businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-30T23:30:00Z') }],
        'Europe/Madrid',
      );
      const service = new MakeupService(prisma as any);

      await expect(service.countForMonth('b1', 'u1', at('2026-10-15T13:00:00Z'))).resolves.toBe(1);
      await expect(service.countForMonth('b1', 'u1', at('2026-09-15T13:00:00Z'))).resolves.toBe(0);
    });
  });

  describe('countByUserAndMonth', () => {
    it('agrupa por alumna y mes, cubriendo el mes entero aunque el rango sea una semana a caballo', async () => {
      const prisma = fakePrisma([
        // fuera de la semana visible, pero dentro de septiembre: igual cuenta
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-03T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'completed', startsAt: at('2026-09-30T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-10-02T13:00:00Z') },
        { businessId: 'b1', userId: 'u1', isMakeup: false, status: 'confirmed', startsAt: at('2026-10-04T13:00:00Z') },
        { businessId: 'b1', userId: 'u2', isMakeup: true, status: 'confirmed', startsAt: at('2026-10-03T13:00:00Z') },
        { businessId: 'b1', userId: 'u3', isMakeup: true, status: 'confirmed', startsAt: at('2026-10-01T13:00:00Z') },
      ]);
      const service = new MakeupService(prisma as any);

      const counts = await service.countByUserAndMonth(
        'b1',
        ['u1', 'u2'],
        at('2026-09-29T03:00:00Z'),
        at('2026-10-06T03:00:00Z'),
      );

      expect(counts.get(makeupKey('u1', at('2026-09-30T13:00:00Z'), ZONE))).toBe(2);
      expect(counts.get(makeupKey('u1', at('2026-10-02T13:00:00Z'), ZONE))).toBe(1);
      expect(counts.get(makeupKey('u2', at('2026-10-03T13:00:00Z'), ZONE))).toBe(1);
      expect(counts.get(makeupKey('u2', at('2026-09-30T13:00:00Z'), ZONE))).toBeUndefined();
      expect(counts.get(makeupKey('u3', at('2026-10-01T13:00:00Z'), ZONE))).toBeUndefined();
    });

    it('devuelve un mapa vacío sin alumnas, sin consultar', async () => {
      const prisma = fakePrisma([
        { businessId: 'b1', userId: 'u1', isMakeup: true, status: 'confirmed', startsAt: at('2026-09-03T13:00:00Z') },
      ]);
      const service = new MakeupService(prisma as any);

      const counts = await service.countByUserAndMonth('b1', [], at('2026-09-01T03:00:00Z'), at('2026-09-08T03:00:00Z'));

      expect(counts.size).toBe(0);
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    });
  });
});
