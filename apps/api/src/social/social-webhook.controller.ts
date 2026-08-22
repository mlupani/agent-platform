import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { SocialWebhookService } from './social-webhook.service';
import { SocialOAuthError } from './social.errors';

@Controller('webhooks/zernio')
@SkipThrottle()
export class SocialWebhookController {
  constructor(private readonly webhooks: SocialWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-zernio-signature') signature?: string,
    @Headers('x-zernio-event-id') eventId?: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      throw new SocialOAuthError('Webhook sin cuerpo');
    }
    return this.webhooks.handle({
      rawBody,
      signature,
      eventId,
      payload: req.body,
    });
  }
}
