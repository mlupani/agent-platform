import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BusinessesService } from '../businesses/businesses.service';
import { GoogleCalendarConfigService } from './google-calendar-config.service';
import { GoogleCalendarService } from './google-calendar.service';

const upsertSchema = z.object({
  calendarId: z.string().min(1).optional(),
  refreshToken: z.string().min(10).optional(),
  enabled: z.boolean().optional(),
  connectedEmail: z.string().email().optional().nullable(),
});

@Controller('admin/calendar')
@UseGuards(ApiKeyGuard)
export class CalendarAdminController {
  constructor(
    private readonly config: GoogleCalendarConfigService,
    private readonly google: GoogleCalendarService,
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

  @Get('oauth-url')
  async oauthUrl() {
    const businessId = await this.businesses.getCurrentId();
    const url = this.google.getAuthUrl(businessId);
    return { url };
  }
}

@Controller('oauth/google')
@SkipThrottle()
export class GoogleOAuthController {
  constructor(
    private readonly google: GoogleCalendarService,
    private readonly config: GoogleCalendarConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    if (error) {
      return {
        ok: false,
        error,
        message: 'Autorización de Google cancelada o rechazada.',
      };
    }
    if (!code || !state) {
      return { ok: false, message: 'Falta code o state en el callback.' };
    }

    const tokens = await this.google.exchangeCode(code);
    if (!tokens.refreshToken) {
      await this.config.saveTokens({
        businessId: state,
        connectedEmail: tokens.connectedEmail,
      });
      return {
        ok: true,
        warning:
          'Google no devolvió refresh_token (puede que ya estuviera autorizado). Pegá el token manualmente o revocá el acceso y reintentá.',
        connectedEmail: tokens.connectedEmail,
      };
    }

    await this.config.saveTokens({
      businessId: state,
      refreshToken: tokens.refreshToken,
      connectedEmail: tokens.connectedEmail,
    });

    return {
      ok: true,
      message: 'Google Calendar conectado. Podés cerrar esta ventana.',
      connectedEmail: tokens.connectedEmail,
    };
  }
}
