import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InstagramConfigService } from './instagram-config.service';
import type {
  InstagramDirectMessage,
  InstagramDirectThread,
} from './instagram.types';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(private readonly config: InstagramConfigService) {}

  async login(input: {
    businessId: string;
    username: string;
    password: string;
    verificationCode?: string;
  }) {
    await this.config.setStatus(input.businessId, 'connecting', null);

    try {
      const sessionId = await this.postFormAuth('/auth/login', {
        username: input.username,
        password: input.password,
        ...(input.verificationCode
          ? { verification_code: input.verificationCode }
          : {}),
      });

      if (!sessionId || sessionId === 'false') {
        throw new BadGatewayException('Login de Instagram rechazado');
      }

      const account = await this.getAccountInfo(sessionId);
      const username =
        String(account.username ?? input.username).replace(/^@/, '') ||
        input.username;
      const userId = account.pk != null ? String(account.pk) : null;

      await this.config.setSession({
        businessId: input.businessId,
        sessionId,
        username,
        userId,
        status: 'connected',
        lastError: null,
      });
      // Evita que el primer poll dispare el agente sobre historial
      await this.config.markSynced(input.businessId);

      return this.config.getPublic();
    } catch (error) {
      const message = this.errorMessage(error);
      const status = /challenge|two.?factor|2fa|verification/i.test(message)
        ? 'challenge'
        : 'error';
      await this.config.setStatus(input.businessId, status, message);
      throw error instanceof BadGatewayException ||
        error instanceof UnauthorizedException
        ? error
        : new BadGatewayException(message);
    }
  }

  async loginBySessionId(input: {
    businessId: string;
    sessionId: string;
    markSynced?: boolean;
  }) {
    await this.config.setStatus(input.businessId, 'connecting', null);
    try {
      const sessionId = await this.postFormAuth('/auth/login/by/sessionid', {
        sessionid: input.sessionId,
      });
      if (!sessionId || sessionId === 'false') {
        throw new BadGatewayException('Session ID de Instagram inválido');
      }
      const account = await this.getAccountInfo(sessionId);
      await this.config.setSession({
        businessId: input.businessId,
        sessionId,
        username: account.username ? String(account.username) : null,
        userId: account.pk != null ? String(account.pk) : null,
        status: 'connected',
      });
      if (input.markSynced !== false) {
        await this.config.markSynced(input.businessId);
      }
      return this.config.getPublic();
    } catch (error) {
      const message = this.errorMessage(error);
      await this.config.setStatus(input.businessId, 'error', message);
      throw new BadGatewayException(message);
    }
  }

  /**
   * Asegura que aiograpi-rest tenga la sesión en TinyDB.
   * Tras reinicios del contenedor Instagram hace falta rehidratar con sessionid.
   */
  async ensureLiveSession(businessId: string): Promise<boolean> {
    const sessionId = await this.config.getSessionId(businessId);
    if (!sessionId) {
      await this.config.setStatus(businessId, 'disconnected', null);
      return false;
    }

    try {
      const account = await this.getAccountInfo(sessionId);
      await this.config.setStatus(businessId, 'connected', null, {
        username: account.username ? String(account.username) : undefined,
        userId: account.pk != null ? String(account.pk) : undefined,
      });
      return true;
    } catch (firstError) {
      const firstMsg = this.errorMessage(firstError);
      this.logger.warn(
        `Instagram session check failed for ${businessId}: ${firstMsg}; rehydrating`,
      );
      try {
        await this.loginBySessionId({
          businessId,
          sessionId,
          markSynced: false,
        });
        return true;
      } catch (error) {
        this.logger.warn(
          `Instagram session restore failed for ${businessId}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        return false;
      }
    }
  }

  async disconnect(businessId: string) {
    await this.config.clearSession(businessId, 'disconnected');
    return this.config.getPublic();
  }

  async verifyStatus(businessId: string) {
    const sessionId = await this.config.getSessionId(businessId);
    if (!sessionId) {
      await this.config.setStatus(businessId, 'disconnected', null);
      return this.config.toPublic(
        (await this.config.getForRuntime(businessId))!,
      );
    }

    try {
      const account = await this.getAccountInfo(sessionId);
      await this.config.setStatus(businessId, 'connected', null, {
        username: account.username ? String(account.username) : undefined,
        userId: account.pk != null ? String(account.pk) : undefined,
      });
    } catch (error) {
      const message = this.errorMessage(error);
      await this.config.setStatus(businessId, 'error', message);
    }

    const config = await this.config.getForRuntime(businessId);
    return this.config.toPublic(config!);
  }

  async listThreads(
    businessId: string,
    amount = 20,
    options?: { messageLimit?: number; unreadOnly?: boolean },
  ): Promise<InstagramDirectThread[]> {
    const sessionId = await this.requireSession(businessId);
    const messageLimit = options?.messageLimit ?? 20;
    const filter = options?.unreadOnly ? 'unread' : '';
    const qs = new URLSearchParams({
      amount: String(amount),
      thread_message_limit: String(messageLimit),
    });
    if (filter) qs.set('selected_filter', filter);
    const data = await this.requestJson<InstagramDirectThread[]>(
      `/direct/threads?${qs.toString()}`,
      { method: 'GET', sessionId },
    );
    return Array.isArray(data) ? data : [];
  }

  async listMessages(
    businessId: string,
    threadId: string,
    amount = 30,
  ): Promise<InstagramDirectMessage[]> {
    const sessionId = await this.requireSession(businessId);
    const data = await this.requestJson<InstagramDirectMessage[]>(
      `/direct/messages?thread_id=${encodeURIComponent(threadId)}&amount=${amount}`,
      { method: 'GET', sessionId },
    );
    return Array.isArray(data) ? data : [];
  }

  async sendThreadMessage(
    businessId: string,
    threadId: string,
    text: string,
  ): Promise<{ externalId?: string }> {
    const sessionId = await this.requireSession(businessId);
    const body = new URLSearchParams({
      thread_id: threadId,
      text,
    });
    const data = await this.requestJson<InstagramDirectMessage>(
      '/direct/thread/message',
      {
        method: 'POST',
        sessionId,
        body,
        form: true,
      },
    );
    const externalId = this.messageId(data);
    return { externalId: externalId || undefined };
  }

  async getAccountInfo(sessionId: string): Promise<Record<string, unknown>> {
    const data = await this.requestJson<Record<string, unknown>>('/account', {
      method: 'GET',
      sessionId,
    });
    return data && typeof data === 'object' ? data : {};
  }

  messageId(message: InstagramDirectMessage | null | undefined): string {
    if (!message) return '';
    const id = message.id ?? message.item_id;
    return id != null ? String(id) : '';
  }

  threadId(thread: InstagramDirectThread): string {
    const id = thread.id ?? thread.thread_id;
    return id != null ? String(id) : '';
  }

  private async requireSession(businessId: string): Promise<string> {
    const sessionId = await this.config.getSessionId(businessId);
    if (!sessionId) {
      throw new UnauthorizedException('Instagram no está conectado');
    }
    return sessionId;
  }

  private async postFormAuth(
    path: string,
    fields: Record<string, string>,
  ): Promise<string> {
    const body = new URLSearchParams(fields);
    const raw = await this.requestRaw(path, {
      method: 'POST',
      body,
      form: true,
    });
    const text = raw.trim();
    if (!text) return '';
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1);
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === 'string') return parsed;
      if (typeof parsed === 'boolean') return parsed ? 'true' : 'false';
      if (parsed && typeof parsed === 'object' && 'sessionid' in parsed) {
        return String((parsed as { sessionid: unknown }).sessionid);
      }
    } catch {
      // plain sessionid
    }
    return text;
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: string;
      sessionId?: string;
      body?: URLSearchParams | string;
      form?: boolean;
    },
  ): Promise<T> {
    const raw = await this.requestRaw(path, options);
    if (!raw) return {} as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Respuesta no JSON de aiograpi-rest ${path}`);
      return {} as T;
    }
  }

  private async requestRaw(
    path: string,
    options: {
      method: string;
      sessionId?: string;
      body?: URLSearchParams | string;
      form?: boolean;
    },
  ): Promise<string> {
    const base = this.config.resolveApiUrl();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (options.sessionId) {
      headers['X-Session-ID'] = options.sessionId;
    }
    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: options.method,
        headers,
        body: options.body,
      });
    } catch (error) {
      throw new BadGatewayException(
        `No se pudo contactar aiograpi-rest (${base}): ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      const detail = this.extractDetail(text) || response.statusText;
      if (response.status === 401) {
        throw new UnauthorizedException(detail || 'Sesión Instagram inválida');
      }
      throw new BadGatewayException(
        `Instagram API ${response.status}: ${detail}`,
      );
    }
    return text;
  }

  private extractDetail(text: string): string {
    try {
      const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
      if (typeof parsed.detail === 'string') return parsed.detail;
      if (Array.isArray(parsed.detail)) {
        return parsed.detail
          .map((item) =>
            typeof item === 'object' && item && 'msg' in item
              ? String((item as { msg: unknown }).msg)
              : JSON.stringify(item),
          )
          .join('; ');
      }
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // plain text
    }
    return text.slice(0, 400);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'Error de Instagram';
  }
}
