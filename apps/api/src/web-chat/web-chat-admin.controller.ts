import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
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
  get() {
    return this.config.getPublic();
  }

  @Put()
  upsert(
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    return this.config.upsertSettings({
      enabled: body.enabled,
      allowedOrigins: body.allowedOrigins,
    });
  }

  @Post('api-key')
  async generateApiKey() {
    const { apiKey, config } = await this.config.generateApiKey();
    return { ...config, apiKey };
  }
}
