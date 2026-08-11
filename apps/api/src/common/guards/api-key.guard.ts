import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import {
  ADMIN_SESSION_COOKIE,
  type AdminSessionPayload,
} from '../../auth/auth.constants';

export type AuthedRequest = Request & {
  adminUser?: AdminSessionPayload & { via?: 'session' | 'apiKey' };
  cookies?: Record<string, string>;
};

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();

    const provided = request.header('x-api-key');
    const expected = this.config.get<string>('ADMIN_API_KEY');
    if (expected && provided && provided === expected) {
      request.adminUser = {
        userId: 'api-key',
        username: 'api-key',
        role: 'ADMIN',
        via: 'apiKey',
      };
      return true;
    }

    const sid = this.readSid(request);
    const session = await this.auth.getSession(sid);
    if (session) {
      request.adminUser = { ...session, via: 'session' };
      return true;
    }

    throw new UnauthorizedException('No autenticado');
  }

  private readSid(req: AuthedRequest): string | undefined {
    if (req.cookies?.[ADMIN_SESSION_COOKIE]) {
      return req.cookies[ADMIN_SESSION_COOKIE];
    }
    const header = req.headers.cookie ?? '';
    const match = header
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${ADMIN_SESSION_COOKIE}=`));
    return match?.slice(ADMIN_SESSION_COOKIE.length + 1);
  }
}
