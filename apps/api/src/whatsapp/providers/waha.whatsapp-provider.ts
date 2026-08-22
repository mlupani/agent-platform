import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withExponentialBackoff } from '../../common/utils/retry';
import { withTimeout } from '../../common/utils/timeout';
import { WhatsAppConfigService } from '../whatsapp-config.service';
import type {
  WhatsAppProvider,
  WhatsAppProviderStatus,
  WhatsAppSendTextParams,
  WhatsAppSendTextResult,
} from './whatsapp-provider.interface';

export interface WahaChatMessage {
  id?: string;
  timestamp?: number;
  from?: string;
  fromMe?: boolean;
  to?: string;
  body?: string;
  hasMedia?: boolean;
  ack?: number;
  ackName?: string;
  location?: unknown;
  vCards?: unknown[];
  _data?: Record<string, unknown>;
}

export interface WahaChatOverview {
  id?:
    | string
    | {
        server?: string;
        user?: string;
        _serialized?: string;
      };
  name?: string | null;
  picture?: string | null;
  isGroup?: boolean;
  timestamp?: number;
  lastMessage?: WahaChatMessage | null;
  _chat?: {
    unreadCount?: number;
    timestamp?: number;
    id?:
      | string
      | {
          server?: string;
          user?: string;
          _serialized?: string;
        };
  };
}

@Injectable()
export class WahaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'waha';
  private readonly logger = new Logger(WahaWhatsAppProvider.name);
  /** Evita martillar Chromium: reusa el mismo QR unos segundos. */
  private readonly qrCache = new Map<
    string,
    { value: string | null; at: number; inflight?: Promise<string | null> }
  >();
  private static readonly QR_TTL_MS = 8_000;

  constructor(
    private readonly config: WhatsAppConfigService,
    private readonly env: ConfigService,
  ) {}

  async sendText(
    params: WhatsAppSendTextParams,
  ): Promise<WhatsAppSendTextResult> {
    const waConfig = await this.config.getForRuntime(params.businessId);
    if (!waConfig?.enabled) {
      throw new Error('WhatsApp no está habilitado para este negocio');
    }

    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(params.businessId);
    const session = params.session || waConfig.sessionName || 'default';
    const chatId = this.toChatId(params.to);

    try {
      const response = await withExponentialBackoff(() =>
        withTimeout(
          async () => {
            const res = await fetch(`${baseUrl}/api/sendText`, {
              method: 'POST',
              headers: this.headers(apiKey),
              body: JSON.stringify({
                session,
                chatId,
                text: params.body,
              }),
            });
            const json = (await res.json().catch(() => ({}))) as {
              id?:
                | string
                | {
                    id?: string;
                    _serialized?: string;
                    fromMe?: boolean;
                    remote?: string;
                  };
              key?: { id?: string };
              error?: string | { message?: string };
            };
            if (!res.ok) {
              const message =
                typeof json.error === 'string'
                  ? json.error
                  : (json.error?.message ?? `WAHA ${res.status}`);
              throw Object.assign(new Error(message), { status: res.status });
            }
            return json;
          },
          12_000,
          'waha sendText',
        ),
      );

      await this.config.setStatus(params.businessId, 'connected', null, {
        sessionStatus: 'WORKING',
      });

      return {
        externalId: this.normalizeMessageId(response.id, response.key?.id),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'WAHA send failed';
      this.logger.warn(`WAHA send failed: ${message}`);
      await this.config.setStatus(params.businessId, 'error', message);
      throw error;
    }
  }

  async getStatus(businessId: string): Promise<WhatsAppProviderStatus> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) {
      return { status: 'disconnected' };
    }

    try {
      const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
      const apiKey = await this.config.getWahaApiKey(businessId);
      const session = waConfig.sessionName || 'default';
      const res = await fetch(`${baseUrl}/api/sessions/${session}`, {
        headers: this.headers(apiKey),
      });
      if (res.status === 404) {
        return {
          status: 'disconnected',
          sessionStatus: 'STOPPED',
          displayPhoneNumber: waConfig.displayPhoneNumber,
          meId: waConfig.meId,
        };
      }
      const json = (await res.json()) as {
        status?: string;
        me?: { id?: string; pushName?: string };
      };
      const sessionStatus = json.status ?? waConfig.sessionStatus;
      const mapped = this.mapSessionStatus(sessionStatus);
      // No pedir QR en cada poll: martilla Chromium y provoca "detached Frame"
      return {
        status: mapped,
        sessionStatus,
        meId: json.me?.id ?? waConfig.meId,
        displayPhoneNumber:
          this.phoneFromMeId(json.me?.id) ?? waConfig.displayPhoneNumber,
        lastError: mapped === 'error' ? waConfig.lastError : null,
        qrDataUrl: null,
      };
    } catch (error) {
      return {
        status: 'error',
        sessionStatus: waConfig.sessionStatus,
        lastError: error instanceof Error ? error.message : 'status failed',
        meId: waConfig.meId,
        displayPhoneNumber: waConfig.displayPhoneNumber,
      };
    }
  }

  async disconnect(
    businessId: string,
    options?: { logout?: boolean },
  ): Promise<void> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) return;
    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(businessId);
    const session = waConfig.sessionName || 'default';

    const res = await fetch(`${baseUrl}/api/sessions/stop`, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify({
        name: session,
        logout: options?.logout ?? false,
      }),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(text || `WAHA stop failed (${res.status})`);
    }

    this.qrCache.delete(businessId);
    await this.config.setStatus(businessId, 'disconnected', null, {
      sessionStatus: 'STOPPED',
    });
  }

  async startSession(businessId: string): Promise<WhatsAppProviderStatus> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) throw new Error('WhatsApp no configurado');

    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(businessId);
    const session = waConfig.sessionName || 'default';
    const hookUrl =
      this.env.get<string>('WAHA_WEBHOOK_URL') ||
      this.config.resolveWebhookUrl().replace('localhost:3001', 'api:3001');

    // Si la sesión ya existe y no está STOPPED/FAILED, solo devolver status/QR
    const existing = await this.fetchSessionRaw(baseUrl, apiKey, session);
    if (
      existing &&
      existing.status &&
      existing.status !== 'STOPPED' &&
      existing.status !== 'FAILED'
    ) {
      const status = await this.getStatus(businessId);
      let qrDataUrl: string | null = null;
      if (
        status.status === 'scan_qr' ||
        status.sessionStatus === 'SCAN_QR_CODE'
      ) {
        qrDataUrl = await this.fetchQrDataUrl(businessId);
      }
      await this.config.setStatus(businessId, status.status, null, {
        sessionStatus: status.sessionStatus,
        meId: status.meId,
        displayPhoneNumber: status.displayPhoneNumber,
      });
      return { ...status, qrDataUrl };
    }

    // FAILED deja Chromium en mal estado: stop limpio antes de start
    if (existing?.status === 'FAILED') {
      try {
        await fetch(`${baseUrl}/api/sessions/stop`, {
          method: 'POST',
          headers: this.headers(apiKey),
          body: JSON.stringify({ name: session, logout: false }),
        });
        await new Promise((r) => setTimeout(r, 800));
      } catch (error) {
        this.logger.warn(
          `Stop before restart failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
      this.qrCache.delete(businessId);
    }

    await this.config.setStatus(businessId, 'connecting', null, {
      sessionStatus: 'STARTING',
    });

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/sessions/start`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          name: session,
          engine:
            this.env.get<string>('WHATSAPP_DEFAULT_ENGINE')?.trim() || 'NOWEB',
          config: {
            // Evitar webhooks de estados/stories, grupos, canales y listas de difusión
            ignore: {
              status: true,
              groups: true,
              channels: true,
              broadcast: true,
            },
            // NOWEB: store requerido para Status y sync de chats
            noweb: {
              store: {
                enabled: true,
                fullSync: true,
              },
            },
            webhooks: [
              {
                url: hookUrl,
                events: [
                  'message',
                  'message.any',
                  'message.ack',
                  'session.status',
                ],
              },
            ],
          },
        }),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? `No se pudo conectar a WAHA (${baseUrl}): ${error.message}`
          : `No se pudo conectar a WAHA (${baseUrl})`;
      this.logger.error(message);
      await this.config.setStatus(businessId, 'error', message);
      throw new Error(message, { cause: error });
    }

    // 422 = ya iniciada → no es error, seguimos con status/QR
    if (!res.ok && res.status !== 422) {
      const text = await res.text();
      await this.config.setStatus(
        businessId,
        'error',
        text || `WAHA ${res.status}`,
      );
      throw new Error(
        text || `No se pudo iniciar la sesión WAHA (${res.status})`,
      );
    }

    await new Promise((r) => setTimeout(r, 1200));
    const status = await this.getStatus(businessId);
    let qrDataUrl: string | null = null;
    if (
      status.status === 'scan_qr' ||
      status.sessionStatus === 'SCAN_QR_CODE'
    ) {
      // Una sola lectura de QR tras start (no en cada poll)
      qrDataUrl = await this.fetchQrDataUrl(businessId);
    }
    await this.config.setStatus(
      businessId,
      status.status,
      status.lastError ?? null,
      {
        sessionStatus: status.sessionStatus,
        meId: status.meId,
        displayPhoneNumber: status.displayPhoneNumber,
      },
    );
    return { ...status, qrDataUrl };
  }

  private async fetchSessionRaw(
    baseUrl: string,
    apiKey: string | null,
    session: string,
  ): Promise<{ status?: string } | null> {
    try {
      const res = await fetch(`${baseUrl}/api/sessions/${session}`, {
        headers: this.headers(apiKey),
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return (await res.json()) as { status?: string };
    } catch {
      return null;
    }
  }

  async fetchQrDataUrl(businessId: string): Promise<string | null> {
    const cached = this.qrCache.get(businessId);
    if (
      cached &&
      Date.now() - cached.at < WahaWhatsAppProvider.QR_TTL_MS &&
      !cached.inflight
    ) {
      return cached.value;
    }
    if (cached?.inflight) return cached.inflight;

    const inflight = this.fetchQrDataUrlUncached(businessId).then((value) => {
      this.qrCache.set(businessId, { value, at: Date.now() });
      return value;
    });
    this.qrCache.set(businessId, {
      value: cached?.value ?? null,
      at: cached?.at ?? 0,
      inflight,
    });
    return inflight;
  }

  private async fetchQrDataUrlUncached(
    businessId: string,
  ): Promise<string | null> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) return null;
    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(businessId);
    const session = waConfig.sessionName || 'default';

    try {
      const res = await fetch(
        `${baseUrl}/api/${encodeURIComponent(session)}/auth/qr?format=image`,
        {
          headers: {
            ...this.headers(apiKey),
            Accept: 'application/json',
          },
        },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        mimetype?: string;
        data?: string;
      };
      if (!json.data) return null;
      const mime = json.mimetype || 'image/png';
      return `data:${mime};base64,${json.data}`;
    } catch (error) {
      this.logger.warn(
        `QR fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  async getSessionMe(
    businessId: string,
  ): Promise<{ id?: string; lid?: string; pushName?: string } | null> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) return null;
    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(businessId);
    const session = waConfig.sessionName || 'default';
    try {
      const res = await fetch(`${baseUrl}/api/sessions/${session}`, {
        headers: this.headers(apiKey),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        me?: { id?: string; lid?: string; pushName?: string };
      };
      return json.me ?? null;
    } catch {
      return null;
    }
  }

  async listChatsOverview(
    businessId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<WahaChatOverview[]> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) throw new Error('WhatsApp no configurado');
    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(businessId);
    const session = waConfig.sessionName || 'default';
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const res = await fetch(
      `${baseUrl}/api/${encodeURIComponent(session)}/chats/overview?limit=${limit}&offset=${offset}`,
      { headers: this.headers(apiKey) },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `WAHA chats overview failed (${res.status})`);
    }
    const json = (await res.json()) as WahaChatOverview[];
    return Array.isArray(json) ? json : [];
  }

  async getChatMessages(
    businessId: string,
    chatId: string,
    options?: { limit?: number; downloadMedia?: boolean },
  ): Promise<WahaChatMessage[]> {
    const waConfig = await this.config.getForRuntime(businessId);
    if (!waConfig) throw new Error('WhatsApp no configurado');
    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(businessId);
    const session = waConfig.sessionName || 'default';
    const limit = options?.limit ?? 80;
    const downloadMedia = options?.downloadMedia === true;
    const encodedChat = encodeURIComponent(chatId);

    const res = await fetch(
      `${baseUrl}/api/${encodeURIComponent(session)}/chats/${encodedChat}/messages?limit=${limit}&downloadMedia=${downloadMedia}`,
      { headers: this.headers(apiKey) },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `WAHA chat messages failed (${res.status})`);
    }
    const json = (await res.json()) as WahaChatMessage[];
    return Array.isArray(json) ? json : [];
  }

  async sendImageStatus(params: {
    businessId: string;
    imageUrl: string;
    caption?: string;
    mimetype?: string;
    filename?: string;
  }): Promise<{ externalId?: string; raw?: unknown }> {
    const waConfig = await this.config.getForRuntime(params.businessId);
    if (!waConfig?.enabled) {
      throw new Error('WhatsApp no está habilitado para este negocio');
    }

    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(params.businessId);
    const session = waConfig.sessionName || 'default';
    const mimetype = params.mimetype || 'image/jpeg';
    const filename =
      params.filename || `status.${mimetype.includes('png') ? 'png' : 'jpg'}`;

    const res = await fetch(
      `${baseUrl}/api/${encodeURIComponent(session)}/status/image`,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          file: {
            mimetype,
            url: params.imageUrl,
            filename,
          },
          caption: params.caption?.trim() || undefined,
          contacts: null,
        }),
      },
    );

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const nested =
        json.exception &&
        typeof json.exception === 'object' &&
        json.exception &&
        'message' in json.exception
          ? String(json.exception.message)
          : '';
      const raw =
        nested ||
        (typeof json.message === 'string' && json.message) ||
        (typeof json.error === 'string' && json.error) ||
        text ||
        `WAHA status image failed (${res.status})`;

      if (/isStatusRankingEnabled|StatusUtils|Status ranking/i.test(raw)) {
        throw Object.assign(
          new Error(
            'WAHA (motor WEBJS) no puede publicar Status por un bug de WhatsApp Web. Reiniciá WAHA con WHATSAPP_DEFAULT_ENGINE=NOWEB y volvé a escanear el QR en Integraciones.',
          ),
          { status: res.status },
        );
      }

      throw Object.assign(new Error(raw.slice(0, 500)), { status: res.status });
    }

    return {
      externalId: this.normalizeMessageId(
        (json.id as
          string | { id?: string; _serialized?: string } | undefined) ?? null,
        typeof json.key === 'object' && json.key && 'id' in json.key
          ? String((json.key as { id?: unknown }).id ?? '')
          : undefined,
      ),
      raw: json,
    };
  }

  async sendVideoStatus(params: {
    businessId: string;
    videoUrl: string;
    caption?: string;
    mimetype?: string;
    filename?: string;
  }): Promise<{ externalId?: string; raw?: unknown }> {
    const waConfig = await this.config.getForRuntime(params.businessId);
    if (!waConfig?.enabled) {
      throw new Error('WhatsApp no está habilitado para este negocio');
    }

    const baseUrl = this.resolveBaseUrl(waConfig.wahaBaseUrl);
    const apiKey = await this.config.getWahaApiKey(params.businessId);
    const session = waConfig.sessionName || 'default';
    const mimetype = params.mimetype || 'video/mp4';
    const filename = params.filename || 'status.mp4';

    const res = await fetch(
      `${baseUrl}/api/${encodeURIComponent(session)}/status/video`,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          file: {
            mimetype,
            url: params.videoUrl,
            filename,
          },
          caption: params.caption?.trim() || undefined,
          convert: true,
          contacts: null,
        }),
      },
    );

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const nested =
        json.exception &&
        typeof json.exception === 'object' &&
        json.exception &&
        'message' in json.exception
          ? String(json.exception.message)
          : '';
      const raw =
        nested ||
        (typeof json.message === 'string' && json.message) ||
        (typeof json.error === 'string' && json.error) ||
        text ||
        `WAHA status video failed (${res.status})`;

      if (/isStatusRankingEnabled|StatusUtils|Status ranking/i.test(raw)) {
        throw Object.assign(
          new Error(
            'WAHA (motor WEBJS) no puede publicar Status por un bug de WhatsApp Web. Reiniciá WAHA con WHATSAPP_DEFAULT_ENGINE=NOWEB y volvé a escanear el QR en Integraciones.',
          ),
          { status: res.status },
        );
      }

      throw Object.assign(new Error(raw.slice(0, 500)), { status: res.status });
    }

    return {
      externalId: this.normalizeMessageId(
        (json.id as
          string | { id?: string; _serialized?: string } | undefined) ?? null,
        typeof json.key === 'object' && json.key && 'id' in json.key
          ? String((json.key as { id?: unknown }).id ?? '')
          : undefined,
      ),
      raw: json,
    };
  }

  mapSessionStatus(sessionStatus?: string | null): string {
    switch (sessionStatus) {
      case 'WORKING':
        return 'connected';
      case 'SCAN_QR_CODE':
        return 'scan_qr';
      case 'STARTING':
        return 'connecting';
      case 'FAILED':
        return 'error';
      case 'STOPPED':
      default:
        return 'disconnected';
    }
  }

  toChatId(to: string): string {
    if (to.includes('@')) return to;
    const digits = to.replace(/\D/g, '');
    return `${digits}@c.us`;
  }

  private normalizeMessageId(
    id?:
      | string
      | {
          id?: string;
          _serialized?: string;
        }
      | null,
    fallback?: string | null,
  ): string | undefined {
    if (typeof id === 'string' && id.trim()) return id;
    if (id && typeof id === 'object') {
      if (typeof id._serialized === 'string' && id._serialized.trim()) {
        return id._serialized;
      }
      if (typeof id.id === 'string' && id.id.trim()) return id.id;
    }
    if (typeof fallback === 'string' && fallback.trim()) return fallback;
    return undefined;
  }

  phoneFromMeId(meId?: string | null): string | null {
    if (!meId) return null;
    return meId.replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '');
  }

  private resolveBaseUrl(configured?: string | null): string {
    const fromEnv = this.env.get<string>('WAHA_BASE_URL');
    let url = (configured || fromEnv || 'http://localhost:3002').replace(
      /\/$/,
      '',
    );

    // Si la API corre en Docker y el config apunta a localhost, usar el hostname del servicio
    const looksLocal =
      /localhost|127\.0\.0\.1/.test(url) || url.includes('0.0.0.0');
    if (looksLocal && fromEnv && !/localhost|127\.0\.0\.1/.test(fromEnv)) {
      url = fromEnv.replace(/\/$/, '');
    }

    return url;
  }

  private headers(apiKey: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['X-Api-Key'] = apiKey;
    return headers;
  }
}
