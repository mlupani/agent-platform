import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('admin/users')
@UseGuards(ApiKeyGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('businessId') businessId?: string) {
    return this.prisma.user.findMany({
      where: businessId ? { businessId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
