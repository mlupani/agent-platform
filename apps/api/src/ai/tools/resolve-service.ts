import { PrismaService } from '../../../common/prisma/prisma.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Acepta UUID o nombre de servicio (case-insensitive). */
export async function resolveServiceId(
  prisma: PrismaService,
  businessId: string,
  serviceRef?: string | null,
): Promise<{ id: string; name: string } | null> {
  const raw = serviceRef?.trim();
  if (!raw) return null;

  if (UUID_RE.test(raw)) {
    const byId = await prisma.service.findFirst({
      where: { id: raw, businessId, enabled: true },
      select: { id: true, name: true },
    });
    return byId;
  }

  const byExact = await prisma.service.findFirst({
    where: {
      businessId,
      enabled: true,
      name: { equals: raw, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
  if (byExact) return byExact;

  const candidates = await prisma.service.findMany({
    where: {
      businessId,
      enabled: true,
      name: { contains: raw, mode: 'insensitive' },
    },
    select: { id: true, name: true },
    take: 5,
  });
  if (candidates.length === 1) return candidates[0];
  return null;
}
