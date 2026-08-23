import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class ClassTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  async list() {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.classTemplate.findMany({
      where: { businessId },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            capacity: true,
          },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async create(input: {
    serviceId: string;
    dayOfWeek: number;
    startTime: string;
    capacity?: number | null;
  }) {
    const businessId = await this.businesses.getCurrentId();
    this.assertTime(input.startTime);
    await this.assertService(businessId, input.serviceId);
    try {
      return await this.prisma.classTemplate.create({
        data: {
          businessId,
          serviceId: input.serviceId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          capacity: input.capacity ?? null,
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              capacity: true,
            },
          },
        },
      });
    } catch (error) {
      this.rethrowUnique(error);
      throw error;
    }
  }

  async update(
    id: string,
    input: Partial<{
      serviceId: string;
      dayOfWeek: number;
      startTime: string;
      capacity: number | null;
    }>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.classTemplate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Horario de clase no encontrado');
    if (input.startTime) this.assertTime(input.startTime);
    if (input.serviceId) await this.assertService(businessId, input.serviceId);
    try {
      return await this.prisma.classTemplate.update({
        where: { id },
        data: {
          serviceId: input.serviceId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          capacity: input.capacity,
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              capacity: true,
            },
          },
        },
      });
    } catch (error) {
      this.rethrowUnique(error);
      throw error;
    }
  }

  async remove(id: string) {
    const businessId = await this.businesses.getCurrentId();
    const existing = await this.prisma.classTemplate.findFirst({
      where: { id, businessId },
    });
    if (!existing) throw new NotFoundException('Horario de clase no encontrado');
    await this.prisma.classTemplate.delete({ where: { id } });
    return { ok: true };
  }

  private assertTime(startTime: string) {
    if (!TIME.test(startTime)) {
      throw new BadRequestException('startTime debe ser HH:mm');
    }
  }

  private async assertService(businessId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
    });
    if (!service) throw new NotFoundException('Servicio no encontrado');
  }

  private rethrowUnique(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(
        'Ya hay una clase en ese día y horario. Un salón no puede tener dos clases a la misma hora.',
      );
    }
  }
}
