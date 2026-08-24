import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard, type AuthedRequest } from '../common/guards/api-key.guard';
import { AdminRoleGuard } from '../common/guards/admin-role.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WebChatConfigService } from './web-chat-config.service';

const originSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    try {
      return new URL(value).origin;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Usá el origen completo, p.ej. https://midominio.com',
      });
      return z.NEVER;
    }
  });

const upsertSchema = z.object({
  enabled: z.boolean().optional(),
  allowedOrigins: z.array(originSchema).optional(),
});

@Controller('admin/web-chat')
@UseGuards(ApiKeyGuard)
export class WebChatAdminController {
  constructor(private readonly config: WebChatConfigService) {}

  @Get()
  async get(@Req() req: AuthedRequest) {
    const publicConfig = await this.config.getPublic();
    if (req.adminUser?.role === 'ADMIN') return publicConfig;
    // El negocio solo ve estado de conexión; no orígenes ni URLs técnicas.
    return {
      id: publicConfig.id,
      businessId: publicConfig.businessId,
      enabled: publicConfig.enabled,
      status: publicConfig.status,
      hasApiKey: publicConfig.hasApiKey,
      apiKeyPrefix: null,
      allowedOrigins: [] as string[],
      lastError: publicConfig.lastError,
      lastUsedAt: publicConfig.lastUsedAt,
      widgetUrl: '',
      conversationsUrl: '',
    };
  }

  @Put()
  upsert(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    if (
      body.allowedOrigins !== undefined &&
      req.adminUser?.role !== 'ADMIN'
    ) {
      throw new ForbiddenException(
        'Solo el administrador puede editar los orígenes permitidos',
      );
    }
    return this.config.upsertSettings({
      enabled: body.enabled,
      allowedOrigins: body.allowedOrigins,
    });
  }

  @Post('api-key')
  @UseGuards(AdminRoleGuard)
  async generateApiKey() {
    const { apiKey, config } = await this.config.generateApiKey();
    return { ...config, apiKey };
  }
}
