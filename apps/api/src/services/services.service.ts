import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  async list(enabledOnly = false) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.service.findMany({
      where: {
        businessId,
        ...(enabledOnly ? { enabled: true } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const service = await this.prisma.service.findFirst({
      where: { id, businessId },
    });
    if (!service) throw new NotFoundException('Servicio no encontrado');
    return service;
  }

  async create(input: {
    name: string;
    description?: string;
    durationMinutes?: number;
    price?: number | null;
    priceDescription?: string | null;
    enabled?: boolean;
    requiresAppointment?: boolean;
    sortOrder?: number;
    sessionCount?: number;
    capacity?: number;
    metadata?: object;
  }) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.service.create({
      data: {
        businessId,
        name: input.name,
        description: input.description,
        durationMinutes: input.durationMinutes ?? 30,
        price:
          input.price === undefined || input.price === null
            ? null
            : new Prisma.Decimal(input.price),
        priceDescription: input.priceDescription,
        enabled: input.enabled ?? true,
        requiresAppointment: input.requiresAppointment ?? true,
        sortOrder: input.sortOrder ?? 0,
        sessionCount: input.sessionCount ?? 1,
        capacity: input.capacity ?? 1,
        metadata: input.metadata,
      },
    });
  }

  async update(
    id: string,
    input: Partial<{
      name: string;
      description: string;
      durationMinutes: number;
      price: number | null;
      priceDescription: string | null;
      enabled: boolean;
      requiresAppointment: boolean;
      sortOrder: number;
      sessionCount: number;
      capacity: number;
      metadata: object;
    }>,
  ) {
    await this.get(id);
    return this.prisma.service.update({
      where: { id },
      data: {
        ...input,
        price:
          input.price === undefined
            ? undefined
            : input.price === null
              ? null
              : new Prisma.Decimal(input.price),
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.service.delete({ where: { id } });
    return { ok: true };
  }

  formatForPrompt(
    services: Array<{
      name: string;
      description: string | null;
      durationMinutes: number;
      price: Prisma.Decimal | null;
      priceDescription: string | null;
      requiresAppointment: boolean;
      sessionCount?: number;
      capacity?: number;
    }>,
  ): string {
    if (!services.length) return 'No hay servicios cargados todavía.';
    return services
      .map((service) => {
        const price =
          service.priceDescription ||
          (service.price != null
            ? `$${service.price.toString()}`
            : 'Consultar');
        const pack =
          (service.sessionCount ?? 1) > 1
            ? ` pack de ${service.sessionCount} clases`
            : '';
        const cupo =
          (service.capacity ?? 1) > 1 ? ` cupo ${service.capacity}` : '';
        return `- ${service.name} (${service.durationMinutes} min${pack}${cupo}) — ${price}${
          service.description ? `: ${service.description}` : ''
        }${service.requiresAppointment ? ' [requiere cita]' : ''}`;
      })
      .join('\n');
  }
}
