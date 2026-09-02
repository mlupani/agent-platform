import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../common/prisma/prisma.service';
import { BusinessesService } from '../businesses/businesses.service';
import { CallConfigService } from './call-config.service';

const upsertSchema = z.object({
  vapiApiKey: z.string().min(8).optional(),
  phoneNumberId: z.string().min(1).nullable().optional(),
  voiceProvider: z.string().min(1).optional(),
  voiceId: z.string().min(1).optional(),
  transcriberLanguage: z.string().max(10).nullable().optional(),
  firstMessage: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  agentEnabled: z.boolean().optional(),
});

@Controller('admin/calls')
@UseGuards(ApiKeyGuard)
export class CallsAdminController {
  constructor(
    private readonly config: CallConfigService,
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get()
  get() {
    return this.config.getPublic();
  }

  @Put()
  upsert(
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    return this.config.upsert(body);
  }

  @Get('phone-numbers')
  phoneNumbers() {
    return this.config.listPhoneNumbers();
  }

  @Post('sync')
  sync() {
    return this.config.syncPhoneNumber();
  }

  @Get('logs')
  async logs(@Query('limit') limit?: string) {
    const businessId = await this.businesses.getCurrentId();
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    return this.prisma.callLog.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
