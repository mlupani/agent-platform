import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { GoogleCalendarConfigService } from './google-calendar-config.service';
import type { BusyInterval } from './calendar.types';

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly config: GoogleCalendarConfigService) {}

  getAuthUrl(state: string): string {
    const client = this.createOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state,
    });
  }

  async exchangeCode(code: string) {
    const client = this.createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    let connectedEmail: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const me = await oauth2.userinfo.get();
      connectedEmail = me.data.email ?? null;
    } catch {
      // email is optional
    }

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      connectedEmail,
    };
  }

  async isConnected(businessId: string): Promise<boolean> {
    const cfg = await this.config.getForRuntime(businessId);
    return Boolean(cfg?.enabled && cfg.refreshTokenEnc);
  }

  async getBusyIntervals(
    businessId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<BusyInterval[]> {
    const calendar = await this.getCalendarClient(businessId);
    if (!calendar) return [];

    const cfg = await this.config.getForRuntime(businessId);
    try {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: [{ id: cfg!.calendarId }],
        },
      });
      const busy =
        res.data.calendars?.[cfg!.calendarId]?.busy?.map((item) => ({
          start: new Date(item.start!),
          end: new Date(item.end!),
        })) ?? [];
      await this.config.setStatus(businessId, 'connected', null);
      return busy;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google freebusy failed';
      this.logger.warn(message);
      await this.config.setStatus(businessId, 'error', message);
      return [];
    }
  }

  async listEvents(
    businessId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<
    Array<{
      id: string;
      summary: string;
      description?: string | null;
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      htmlLink?: string | null;
      status?: string | null;
    }>
  > {
    const calendar = await this.getCalendarClient(businessId);
    if (!calendar) return [];
    const cfg = await this.config.getForRuntime(businessId);

    try {
      const res = await calendar.events.list({
        calendarId: cfg!.calendarId || 'primary',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      });

      await this.config.setStatus(businessId, 'connected', null);

      return (res.data.items ?? [])
        .filter((item) => item.status !== 'cancelled' && item.id)
        .map((item) => {
          const allDay = Boolean(item.start?.date && !item.start?.dateTime);
          const startsAt = item.start?.dateTime || item.start?.date || '';
          const endsAt = item.end?.dateTime || item.end?.date || startsAt;
          // all-day end is exclusive in Google; keep as-is for display
          return {
            id: item.id!,
            summary: item.summary || '(Sin título)',
            description: item.description ?? null,
            startsAt,
            endsAt,
            allDay,
            htmlLink: item.htmlLink ?? null,
            status: item.status ?? null,
          };
        })
        .filter((item) => item.startsAt);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google list events failed';
      this.logger.warn(message);
      await this.config.setStatus(businessId, 'error', message);
      return [];
    }
  }

  async createEvent(params: {
    businessId: string;
    summary: string;
    description?: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    attendeeEmail?: string;
  }): Promise<string | null> {
    const calendar = await this.getCalendarClient(params.businessId);
    if (!calendar) return null;
    const cfg = await this.config.getForRuntime(params.businessId);

    try {
      const res = await calendar.events.insert({
        calendarId: cfg!.calendarId,
        requestBody: {
          summary: params.summary,
          description: params.description,
          start: {
            dateTime: params.startsAt.toISOString(),
            timeZone: params.timezone,
          },
          end: {
            dateTime: params.endsAt.toISOString(),
            timeZone: params.timezone,
          },
          attendees: params.attendeeEmail
            ? [{ email: params.attendeeEmail }]
            : undefined,
        },
      });
      await this.config.setStatus(params.businessId, 'connected', null);
      return res.data.id ?? null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google create event failed';
      this.logger.warn(message);
      await this.config.setStatus(params.businessId, 'error', message);
      return null;
    }
  }

  async updateEvent(params: {
    businessId: string;
    eventId: string;
    summary?: string;
    description?: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
  }): Promise<boolean> {
    const calendar = await this.getCalendarClient(params.businessId);
    if (!calendar) return false;
    const cfg = await this.config.getForRuntime(params.businessId);

    try {
      await calendar.events.patch({
        calendarId: cfg!.calendarId,
        eventId: params.eventId,
        requestBody: {
          summary: params.summary,
          description: params.description,
          start: {
            dateTime: params.startsAt.toISOString(),
            timeZone: params.timezone,
          },
          end: {
            dateTime: params.endsAt.toISOString(),
            timeZone: params.timezone,
          },
        },
      });
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google update event failed';
      this.logger.warn(message);
      await this.config.setStatus(params.businessId, 'error', message);
      return false;
    }
  }

  async deleteEvent(businessId: string, eventId: string): Promise<boolean> {
    const calendar = await this.getCalendarClient(businessId);
    if (!calendar) return false;
    const cfg = await this.config.getForRuntime(businessId);

    try {
      await calendar.events.delete({
        calendarId: cfg!.calendarId,
        eventId,
      });
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google delete event failed';
      this.logger.warn(message);
      await this.config.setStatus(businessId, 'error', message);
      return false;
    }
  }

  private createOAuthClient() {
    const { clientId, clientSecret, redirectUri } =
      this.config.getOAuthCredentials();
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  private async getCalendarClient(businessId: string) {
    const cfg = await this.config.getForRuntime(businessId);
    if (!cfg?.enabled || !cfg.refreshTokenEnc) return null;
    if (!this.config.oauthConfigured()) {
      this.logger.warn('Google OAuth env vars missing');
      return null;
    }

    const refreshToken = await this.config.getRefreshToken(businessId);
    if (!refreshToken) return null;

    const auth = this.createOAuthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth });
  }
}
