import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../common/prisma/prisma.service';

/** Estados que no cuentan como recupero usado. */
const NOT_COUNTED_STATUSES = ['cancelled'];

/**
 * Clave del contador: alumna + mes calendario en la timezone del negocio.
 * Los consumidores la arman con esta función para no repetir el formato.
 */
export function makeupKey(userId: string, startsAt: Date, zone: string): string {
  return `${userId}:${DateTime.fromJSDate(startsAt).setZone(zone).toFormat('yyyy-MM')}`;
}

/**
 * Cuenta recuperos (clases marcadas como reposición). No hay tope: sólo se
 * informa cuántos lleva la alumna en el mes.
 */
@Injectable()
export class MakeupService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recuperos de la alumna en el mes calendario de `reference`. */
  async countForMonth(
    businessId: string,
    userId: string,
    reference: Date,
  ): Promise<number> {
    const zone = await this.timezoneOf(businessId);
    const counts = await this.countIn(businessId, [userId], reference, reference, zone);
    return counts.get(makeupKey(userId, reference, zone)) ?? 0;
  }

  /**
   * Recuperos por alumna y mes para todos los meses que toca [from, to].
   * Cuenta el mes completo aunque el rango sea sólo una semana, así el roster
   * muestra el total del mes y no el del pedazo visible.
   */
  async countByUserAndMonth(
    businessId: string,
    userIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    if (!userIds.length) return new Map();
    const zone = await this.timezoneOf(businessId);
    return this.countIn(businessId, userIds, from, to, zone);
  }

  private async countIn(
    businessId: string,
    userIds: string[],
    from: Date,
    to: Date,
    zone: string,
  ): Promise<Map<string, number>> {
    const rangeStart = DateTime.fromJSDate(from).setZone(zone).startOf('month');
    const rangeEnd = DateTime.fromJSDate(to)
      .setZone(zone)
      .startOf('month')
      .plus({ months: 1 });

    const rows = await this.prisma.appointment.findMany({
      where: {
        businessId,
        userId: { in: userIds },
        isMakeup: true,
        status: { notIn: NOT_COUNTED_STATUSES },
        startsAt: {
          gte: rangeStart.toUTC().toJSDate(),
          lt: rangeEnd.toUTC().toJSDate(),
        },
      },
      select: { userId: true, startsAt: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.userId) continue;
      const key = makeupKey(row.userId, row.startsAt, zone);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private async timezoneOf(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    return business.timezone;
  }
}
