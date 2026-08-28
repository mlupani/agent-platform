import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

export interface LeadListItem {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  channel: string | null;
  conversationId: string | null;
  createdAt: Date;
}

export interface LeadCaptureInput {
  businessId: string;
  conversationId?: string;
  userId?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LeadManualInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  channel?: 'MANUAL' | 'WEB' | 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  /**
   * Guarda o actualiza un lead si hay al menos un dato de contacto.
   * Un mismo conversationId no duplica filas.
   */
  async capture(input: LeadCaptureInput): Promise<{ id: string } | null> {
    const name = input.name?.trim() || null;
    const email = input.email?.trim() || null;
    const phone = input.phone?.trim() || null;
    const message = input.message?.trim() || null;
    if (!name && !email && !phone) return null;

    const conversationId = input.conversationId || undefined;
    const existing = conversationId
      ? await this.prisma.lead.findFirst({
          where: { businessId: input.businessId, conversationId },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    const metadata = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...(input.metadata ?? {}),
      conversationId: conversationId ?? undefined,
    };

    if (existing) {
      const updated = await this.prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          email: email || existing.email,
          phone: phone || existing.phone,
          message: message || existing.message,
          source: input.source || existing.source,
          userId: input.userId || existing.userId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return { id: updated.id };
    }

    const created = await this.prisma.lead.create({
      data: {
        businessId: input.businessId,
        userId: input.userId,
        conversationId,
        name,
        email,
        phone,
        message,
        source: input.source,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
    return { id: created.id };
  }

  async createManual(input: LeadManualInput): Promise<{ id: string }> {
    const businessId = await this.businesses.getCurrentId();
    const channel = input.channel ?? 'MANUAL';
    const created = await this.capture({
      businessId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: input.message,
      source: channel,
      metadata: {
        origin: 'manual',
        channel,
      },
    });
    if (!created) {
      throw new BadRequestException(
        'Hace falta al menos nombre, teléfono o email.',
      );
    }
    return created;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const businessId = await this.businesses.getCurrentId();
    const lead = await this.prisma.lead.findFirst({
      where: { id, businessId },
      select: { id: true },
    });
    if (!lead) throw new BadRequestException('Lead no encontrado');
    await this.prisma.lead.delete({ where: { id: lead.id } });
    return { ok: true };
  }

  async list(): Promise<LeadListItem[]> {
    const businessId = await this.businesses.getCurrentId();
    const rows = await this.prisma.lead.findMany({
      where: { businessId },
      include: {
        conversation: {
          select: { id: true, channel: true, contactName: true, hiddenAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name || row.conversation?.contactName || null,
      email: row.email,
      phone: row.phone,
      message: row.message,
      source: row.source,
      channel: row.conversation?.channel ?? row.source ?? null,
      conversationId: row.conversationId ?? row.conversation?.id ?? null,
      createdAt: row.createdAt,
    }));
  }
}
