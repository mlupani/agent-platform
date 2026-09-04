import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { alternateWhatsAppExternalIds } from '../whatsapp/whatsapp-chat-id.util';

export interface ClientInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  statusSlug?: string;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  listStatuses() {
    return this.prisma.clientStatus.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async list(statusSlug?: string, name?: string, options?: { lite?: boolean }) {
    const businessId = await this.businesses.getCurrentId();
    const status = statusSlug
      ? await this.resolveStatus(statusSlug)
      : undefined;
    const nameQuery = name?.trim().slice(0, 120) || '';
    const isPhoneLike = nameQuery.replace(/\D/g, '').length >= 6;
    const lite = Boolean(options?.lite);

    const rows = await this.prisma.user.findMany({
      where: {
        businessId,
        ...(status ? { statusId: status.id } : {}),
        ...(nameQuery
          ? isPhoneLike
            ? {
                OR: [
                  { name: { contains: nameQuery, mode: 'insensitive' } },
                  { phone: { contains: nameQuery } },
                  { email: { contains: nameQuery, mode: 'insensitive' } },
                ],
              }
            : {
                OR: [
                  { name: { contains: nameQuery, mode: 'insensitive' } },
                  { phone: { contains: nameQuery } },
                  { email: { contains: nameQuery, mode: 'insensitive' } },
                ],
              }
          : {}),
      },
      include: {
        status: true,
        _count: {
          select: { appointments: true, conversations: true },
        },
      },
      orderBy: lite ? { name: 'asc' } : { createdAt: 'desc' },
      take: lite ? 1000 : 300,
    });

    const ids = rows.map((r) => r.id);
    const [appointments, passes] = await Promise.all([
      ids.length && !lite
        ? this.prisma.appointment.findMany({
            where: { businessId, userId: { in: ids } },
            select: { userId: true, status: true },
          })
        : Promise.resolve([] as Array<{ userId: string | null; status: string }>),
      ids.length
        ? this.prisma.servicePass.findMany({
            where: { businessId, userId: { in: ids } },
            include: { service: { select: { name: true } } },
          })
        : Promise.resolve([] as Array<{ userId: string; sessionsPaid: number; sessionsUsed: number; status: string; service: { name: string } }>),
    ]);

    const attByUser = new Map<string, { completed: number; noShow: number; pending: number }>();
    for (const a of appointments) {
      if (!a.userId) continue;
      const cur = attByUser.get(a.userId) ?? { completed: 0, noShow: 0, pending: 0 };
      if (a.status === 'completed') cur.completed += 1;
      else if (a.status === 'no_show') cur.noShow += 1;
      else if (a.status === 'pending' || a.status === 'confirmed') cur.pending += 1;
      attByUser.set(a.userId, cur);
    }

    const packByUser = new Map<string, { name: string | null; total: number; remaining: number; used: number }>();
    const passesByUser = new Map<string, typeof passes>();
    for (const p of passes) {
      const list = passesByUser.get(p.userId) ?? [];
      list.push(p);
      passesByUser.set(p.userId, list);
    }
    for (const [userId, list] of passesByUser.entries()) {
      const active = list.filter((p) => p.status === 'ACTIVE');
      // usar el pack más reciente activo o el último creado
      const src = active.length ? active : list;
      const sorted = [...src].sort((a, b) => b.sessionsPaid - a.sessionsPaid);
      const primary = sorted[0];
      // packs vigentes solamente: uno ya agotado (COMPLETED) no debe sumarse a un pack nuevo
      const total = active.reduce((acc, p) => acc + p.sessionsPaid, 0);
      const remaining = active.reduce((acc, p) => acc + Math.max(0, p.sessionsPaid - p.sessionsUsed), 0);
      const used = active.reduce((acc, p) => acc + p.sessionsUsed, 0);
      packByUser.set(userId, { name: primary?.service?.name ?? null, total, remaining, used });
    }

    return rows.map((row) =>
      this.toClient(row, {
        attendance: attByUser.get(row.id) ?? { completed: 0, noShow: 0, pending: 0 },
        pack: packByUser.get(row.id) ?? null,
      }),
    );
  }

  async create(input: ClientInput) {
    const businessId = await this.businesses.getCurrentId();
    const name = input.name?.trim() || null;
    const email = input.email?.trim() || null;
    const phone = input.phone?.trim() || null;
    const notes = input.notes?.trim() || null;
    if (!name && !email && !phone) {
      throw new BadRequestException(
        'Hace falta al menos nombre, teléfono o email.',
      );
    }
    const status = await this.resolveStatus(input.statusSlug ?? 'visita');
    const created = await this.prisma.user.create({
      data: {
        businessId,
        name,
        email,
        phone,
        notes,
        statusId: status.id,
        metadata: { origin: 'manual' },
      },
      include: {
        status: true,
        _count: { select: { appointments: true, conversations: true } },
      },
    });
    return this.toClient(created);
  }

  async update(id: string, input: ClientInput) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.user.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Cliente no encontrado');

    const name = input.name !== undefined ? input.name?.trim() || null : existing.name;
    const email =
      input.email !== undefined ? input.email?.trim() || null : existing.email;
    const phone =
      input.phone !== undefined ? input.phone?.trim() || null : existing.phone;
    if (!name && !email && !phone) {
      throw new BadRequestException(
        'Hace falta al menos nombre, teléfono o email.',
      );
    }

    const status = input.statusSlug
      ? await this.resolveStatus(input.statusSlug)
      : null;

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        phone,
        notes:
          input.notes !== undefined ? input.notes?.trim() || null : undefined,
        ...(status ? { statusId: status.id } : {}),
      },
      include: {
        status: true,
        _count: { select: { appointments: true, conversations: true } },
      },
    });
    return this.toClient(updated);
  }

  async get(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const row = await this.prisma.user.findFirst({
      where: { id, businessId },
      include: {
        status: true,
        _count: { select: { appointments: true, conversations: true } },
      },
    });
    if (!row) throw new NotFoundException('Cliente no encontrado');
    return this.toClient(row);
  }

  async getAppointments(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const user = await this.prisma.user.findFirst({
      where: { id, businessId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Cliente no encontrado');
    const rows = await this.prisma.appointment.findMany({
      where: { businessId, userId: id },
      include: {
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: 50,
    });
    // normalizar para ficha: status completed = asistencia, no_show = inasistencia, pending/confirmed = futura/pendiente
    return rows.map((r) => ({
      id: r.id,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      status: r.status,
      service: r.service,
      notes: r.notes,
      isTrial: r.isTrial,
    }));
  }

  async remove(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.user.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Cliente no encontrado');
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }

  async openWhatsApp(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const user = await this.prisma.user.findFirst({
      where: { id, businessId },
    });
    if (!user) throw new NotFoundException('Cliente no encontrado');
    const phone = this.whatsAppPhone(user.phone);
    if (!phone) {
      throw new BadRequestException(
        'Este cliente no tiene un teléfono de WhatsApp.',
      );
    }

    if (!(await this.isWhatsAppConnected(businessId))) {
      return { webUrl: `https://wa.me/${phone}` };
    }

    const existing = await this.prisma.conversation.findFirst({
      where: {
        businessId,
        channel: 'WHATSAPP',
        OR: [
          { userId: user.id },
          { contactPhone: phone },
          { contactPhone: user.phone },
          { externalId: { in: alternateWhatsAppExternalIds(phone) } },
        ],
      },
      orderBy: [
        { hiddenAt: { sort: 'asc', nulls: 'first' } },
        { updatedAt: 'desc' },
      ],
    });

    if (existing) {
      if (existing.hiddenAt || existing.status === 'CLOSED' || !existing.userId) {
        await this.prisma.conversation.update({
          where: { id: existing.id },
          data: {
            ...(existing.hiddenAt || existing.status === 'CLOSED'
              ? { hiddenAt: null, status: 'HUMAN' }
              : {}),
            userId: existing.userId || user.id,
            contactPhone: existing.contactPhone || phone,
            contactName: existing.contactName || user.name,
          },
        });
      }
      return { conversationId: existing.id };
    }

    const agent = await this.prisma.agentConfig.findFirst({
      where: { businessId, isDefault: true },
    });
    const created = await this.prisma.conversation.create({
      data: {
        businessId,
        userId: user.id,
        agentConfigId: agent?.id,
        channel: 'WHATSAPP',
        status: 'HUMAN',
        externalId: `${phone}@c.us`,
        contactPhone: phone,
        contactName: user.name,
        lastMessageAt: new Date(),
      },
    });
    return { conversationId: created.id };
  }

  private async isWhatsAppConnected(businessId: string) {
    const wa = await this.prisma.whatsAppConfig.findUnique({
      where: { businessId },
      select: { status: true, sessionStatus: true },
    });
    return wa?.status === 'connected' || wa?.sessionStatus === 'WORKING';
  }

  private whatsAppPhone(phone?: string | null) {
    const digits = phone?.replace(/\D/g, '') ?? '';
    return digits.length >= 8 ? digits : null;
  }

  private async resolveStatus(slug: string) {
    const status = await this.prisma.clientStatus.findUnique({
      where: { slug },
    });
    if (!status) {
      throw new BadRequestException(`Estado inválido: ${slug}`);
    }
    return status;
  }

  private toClient(
    row: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      notes: string | null;
      createdAt: Date;
      updatedAt: Date;
      status: { id: string; slug: string; name: string };
      _count: { appointments: number; conversations: number };
    },
    extra?: {
      attendance?: { completed: number; noShow: number; pending: number };
      pack?: { name: string | null; total: number; remaining: number; used: number } | null;
    },
  ) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status,
      appointments: row._count.appointments,
      conversations: row._count.conversations,
      attendance: extra?.attendance ?? { completed: 0, noShow: 0, pending: 0 },
      pack: extra?.pack ?? null,
    };
  }
}
