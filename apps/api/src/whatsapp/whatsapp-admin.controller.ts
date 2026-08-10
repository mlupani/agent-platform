import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { WhatsAppConfigService } from './whatsapp-config.service';
import { WhatsAppProviderFactory } from './providers/whatsapp-provider.factory';

const upsertSchema = z.object({
  provider: z.enum(['waha', 'meta_cloud']).optional(),
  wahaBaseUrl: z.string().url().optional().nullable(),
  wahaApiKey: z.string().min(4).optional(),
  sessionName: z.string().min(1).optional(),
  phoneNumberId: z.string().optional().nullable(),
  businessAccountId: z.string().optional().nullable(),
  displayPhoneNumber: z.string().optional().nullable(),
  verifyToken: z.string().optional().nullable(),
  accessToken: z.string().min(10).optional(),
  enabled: z.boolean().optional(),
});

@Controller('admin/whatsapp')
@UseGuards(ApiKeyGuard)
export class WhatsAppAdminController {
  constructor(
    private readonly config: WhatsAppConfigService,
    private readonly providers: WhatsAppProviderFactory,
    private readonly businesses: BusinessesService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  @Get()
  async get() {
    const publicConfig = await this.config.getPublic();
    if (!publicConfig) return null;
    const businessId = await this.businesses.getCurrentId();
    const live = await this.providers.getWaha().getStatus(businessId);
    return {
      ...publicConfig,
      status: live.status || publicConfig.status,
      sessionStatus: live.sessionStatus ?? publicConfig.sessionStatus,
      meId: live.meId ?? publicConfig.meId,
      displayPhoneNumber:
        live.displayPhoneNumber ?? publicConfig.displayPhoneNumber,
      qrDataUrl: live.qrDataUrl ?? null,
    };
  }

  @Put()
  upsert(
    @Body(new ZodValidationPipe(upsertSchema))
    body: z.infer<typeof upsertSchema>,
  ) {
    return this.config.upsert(body);
  }

  @Post('session/start')
  async startSession() {
    const businessId = await this.businesses.getCurrentId();
    await this.config.ensureFromEnv();
    try {
      const status = await this.providers.getWaha().startSession(businessId);
      this.realtime.whatsappStatusChanged(businessId, status);
      if (status.qrDataUrl) {
        this.realtime.whatsappQrUpdated(businessId, {
          qrDataUrl: status.qrDataUrl,
          status: status.status,
        });
      }
      return status;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error iniciando sesión WAHA';
      throw new BadGatewayException(message);
    }
  }

  @Post('session/stop')
  async stopSession(@Body() body?: { logout?: boolean }) {
    const businessId = await this.businesses.getCurrentId();
    await this.providers.getWaha().disconnect(businessId, {
      logout: body?.logout === true,
    });
    const status = await this.providers.getWaha().getStatus(businessId);
    this.realtime.whatsappStatusChanged(businessId, status);
    return status;
  }

  @Get('session/status')
  async sessionStatus() {
    const businessId = await this.businesses.getCurrentId();
    return this.providers.getWaha().getStatus(businessId);
  }

  @Get('session/qr')
  async sessionQr() {
    const businessId = await this.businesses.getCurrentId();
    const qrDataUrl = await this.providers.getWaha().fetchQrDataUrl(businessId);
    if (qrDataUrl) {
      this.realtime.whatsappQrUpdated(businessId, {
        qrDataUrl,
        status: 'scan_qr',
      });
    }
    return { qrDataUrl };
  }
}
