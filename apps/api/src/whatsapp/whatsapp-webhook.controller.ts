import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Controller('webhooks')
@SkipThrottle()
export class WhatsAppWebhookController {
  constructor(private readonly webhooks: WhatsAppWebhookService) {}

  /** WAHA → Nest webhook */
  @Post('waha')
  @HttpCode(200)
  async receiveWaha(@Body() body: unknown) {
    const result = await this.webhooks.handleWahaEvent(body);
    return { ok: true, ...result };
  }

  /** Legacy Meta verify (optional) */
  @Get('whatsapp')
  async verify(
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const challenge = await this.webhooks.verifySubscription(query);
    if (!challenge) return res.status(403).send('Forbidden');
    return res.status(200).send(challenge);
  }

  /** Legacy Meta POST ignored / returns ok to avoid Meta retries during migration */
  @Post('whatsapp')
  @HttpCode(200)
  receiveMeta(@Body() body: unknown) {
    return {
      ok: true,
      deprecated: true,
      hint: 'Use WAHA webhook /api/webhooks/waha',
    };
  }
}
