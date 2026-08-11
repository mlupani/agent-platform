import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { RealtimeEventsService } from '../realtime/realtime.events.service';
import { InstagramConfigService } from './instagram-config.service';
import { InstagramInboxSyncService } from './instagram-inbox.sync';
import { InstagramService } from './instagram.service';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  verificationCode: z.string().min(1).optional(),
});

const sessionSchema = z.object({
  sessionId: z.string().min(10),
});

@Controller('admin/instagram')
@UseGuards(ApiKeyGuard)
export class InstagramAdminController {
  constructor(
    private readonly config: InstagramConfigService,
    private readonly instagram: InstagramService,
    private readonly sync: InstagramInboxSyncService,
    private readonly businesses: BusinessesService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  @Get()
  get() {
    return this.config.getPublic();
  }

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: z.infer<typeof loginSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    const result = await this.instagram.login({
      businessId,
      username: body.username,
      password: body.password,
      verificationCode: body.verificationCode,
    });
    this.realtime.instagramStatusChanged(businessId, result);
    return result;
  }

  @Post('login/session')
  async loginSession(
    @Body(new ZodValidationPipe(sessionSchema))
    body: z.infer<typeof sessionSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    const result = await this.instagram.loginBySessionId({
      businessId,
      sessionId: body.sessionId,
    });
    this.realtime.instagramStatusChanged(businessId, result);
    return result;
  }

  @Post('disconnect')
  async disconnect() {
    const businessId = await this.businesses.getCurrentId();
    const result = await this.instagram.disconnect(businessId);
    this.realtime.instagramStatusChanged(businessId, result);
    return result;
  }

  @Post('reconnect')
  async reconnect() {
    const businessId = await this.businesses.getCurrentId();
    const sessionId = await this.config.getSessionId(businessId);
    if (!sessionId) {
      return this.instagram.verifyStatus(businessId);
    }
    const result = await this.instagram.loginBySessionId({
      businessId,
      sessionId,
    });
    this.realtime.instagramStatusChanged(businessId, result);
    return result;
  }

  @Get('status')
  async status() {
    const businessId = await this.businesses.getCurrentId();
    const result = await this.instagram.verifyStatus(businessId);
    this.realtime.instagramStatusChanged(businessId, result);
    return result;
  }

  @Post('sync')
  async syncNow() {
    const businessId = await this.businesses.getCurrentId();
    const processed = await this.sync.syncBusiness(businessId);
    return { processed };
  }
}
