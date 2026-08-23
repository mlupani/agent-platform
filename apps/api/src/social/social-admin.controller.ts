import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { SocialPublishingService } from './social-publishing.service';
import { isSocialPlatform } from './social.types';
import { SocialOAuthError } from './social.errors';

const connectSchema = z.object({
  platform: z.enum(['instagram', 'tiktok', 'facebook']),
});

const agentEnabledSchema = z.object({
  agentEnabled: z.boolean(),
});

@Controller('admin/social')
@UseGuards(ApiKeyGuard)
export class SocialAdminController {
  constructor(
    private readonly social: SocialPublishingService,
    private readonly businesses: BusinessesService,
  ) {}

  @Get()
  async list() {
    const businessId = await this.businesses.getCurrentId();
    return this.social.listConnections(businessId);
  }

  @Post('connect')
  async connect(
    @Body(new ZodValidationPipe(connectSchema))
    body: z.infer<typeof connectSchema>,
  ) {
    const businessId = await this.businesses.getCurrentId();
    return this.social.getConnectUrl(businessId, body.platform);
  }

  @Patch(':platform/agent')
  async setAgent(
    @Param('platform') platform: string,
    @Body(new ZodValidationPipe(agentEnabledSchema))
    body: z.infer<typeof agentEnabledSchema>,
  ) {
    if (!isSocialPlatform(platform)) {
      throw new SocialOAuthError('Plataforma inválida');
    }
    const businessId = await this.businesses.getCurrentId();
    return this.social.setAgentEnabled(businessId, platform, body.agentEnabled);
  }

  @Get(':platform/health')
  async health(@Param('platform') platform: string) {
    if (!isSocialPlatform(platform)) {
      throw new SocialOAuthError('Plataforma inválida');
    }
    const businessId = await this.businesses.getCurrentId();
    return this.social.getHealth(businessId, platform);
  }

  @Delete(':platform')
  async disconnect(@Param('platform') platform: string) {
    if (!isSocialPlatform(platform)) {
      throw new SocialOAuthError('Plataforma inválida');
    }
    const businessId = await this.businesses.getCurrentId();
    return this.social.disconnect(businessId, platform);
  }
}
