import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { VapiWebhookService } from './vapi-webhook.service';
import { VapiBridgeService } from './vapi-bridge.service';
import type { VapiChatCompletionBody, VapiServerMessage } from './calls.types';

/**
 * Webhook público de Vapi. No usa `ApiKeyGuard`: la autenticación es el header
 * `x-vapi-secret` que valida `VapiWebhookService.verifySecret`. Ambas rutas
 * saltan el throttler porque el tráfico lo genera Vapi, no un cliente nuestro.
 */
@Controller('webhooks/vapi')
@SkipThrottle()
export class VapiWebhookController {
  constructor(
    private readonly webhook: VapiWebhookService,
    private readonly bridge: VapiBridgeService,
  ) {}

  /** Eventos de servidor de Vapi (`assistant-request`, `status-update`, etc.). */
  @Post()
  @HttpCode(200)
  async events(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: { message?: VapiServerMessage },
  ) {
    if (!(await this.webhook.verifySecret(headers['x-vapi-secret']))) {
      throw new UnauthorizedException('Secret inválido');
    }
    if (!body?.message?.type) return {};
    return this.webhook.handleEvent(body.message);
  }

  /** Bridge custom-llm: cada turno del usuario en la llamada llega acá. */
  @Post('chat/completions')
  async chatCompletions(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: VapiChatCompletionBody,
    @Res() res: Response,
  ) {
    if (!(await this.webhook.verifySecret(headers['x-vapi-secret']))) {
      throw new UnauthorizedException('Secret inválido');
    }
    await this.bridge.handleChatCompletion(body, res);
  }
}
