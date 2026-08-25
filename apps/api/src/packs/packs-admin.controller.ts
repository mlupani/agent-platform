import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { PackBalanceService } from './pack-balance.service';
import { PrismaService } from '../common/prisma/prisma.service';

const purchaseSchema = z.object({
  serviceId: z.string().uuid(),
  amount: z.number().optional(),
  reason: z.string().optional(),
});

const adjustSchema = z.object({
  amount: z.number().int().min(-10).max(10).refine((v) => v !== 0, 'amount no puede ser 0'),
  reason: z.string().optional(),
});

@Controller('admin/users/:userId')
@UseGuards(ApiKeyGuard)
export class PacksAdminController {
  constructor(
    private readonly packs: PackBalanceService,
    private readonly businesses: BusinessesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('balance')
  async balance(@Param('userId') userId: string) {
    const businessId = await this.businesses.getCurrentId();
    return this.packs.getBalance(businessId, userId);
  }

  @Get('packs')
  async packsList(@Param('userId') userId: string) {
    const businessId = await this.businesses.getCurrentId();
    const balance = await this.packs.getBalance(businessId, userId);
    const movements = await this.prisma.classCreditMovement.findMany({
      where: { businessId, userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { ...balance, movements };
  }

  @Post('packs')
  async purchase(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(purchaseSchema)) body: z.infer<typeof purchaseSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.packs.purchasePack({ businessId, userId, serviceId: body.serviceId, amount: body.amount, reason: body.reason });
  }

  @Post('packs/:packId/adjust')
  async adjust(
    @Param('userId') userId: string,
    @Param('packId') packId: string,
    @Body(new ZodValidationPipe(adjustSchema)) body: z.infer<typeof adjustSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.packs.adjustBalance({ businessId, userId, servicePassId: packId, amount: body.amount, reason: body.reason });
  }

  @Get('movements')
  async movements(@Param('userId') userId: string) {
    const businessId = await this.businesses.getCurrentId();
    return this.prisma.classCreditMovement.findMany({
      where: { businessId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
