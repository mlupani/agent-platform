import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
} from './auth.constants';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.validateCredentials(
      body.username,
      body.password,
    );
    if (!user) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const { sid, payload } = await this.auth.createSession(user);
    this.setSessionCookie(res, sid);

    return {
      user: {
        id: payload.userId,
        username: payload.username,
        role: payload.role,
        displayName: payload.displayName,
      },
    };
  }

  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sid = this.readSid(req);
    await this.auth.destroySession(sid);
    res.clearCookie(ADMIN_SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const sid = this.readSid(req);
    const session = await this.auth.getSession(sid);
    if (!session) {
      throw new UnauthorizedException('No autenticado');
    }
    await this.auth.touchSession(sid!, session);
    return {
      user: {
        id: session.userId,
        username: session.username,
        role: session.role,
        displayName: session.displayName,
      },
    };
  }

  private readSid(req: Request): string | undefined {
    const fromCookie = (
      req as Request & { cookies?: Record<string, string> }
    ).cookies?.[ADMIN_SESSION_COOKIE];
    if (fromCookie) return fromCookie;
    // Fallback por si cookie-parser no corrió
    const header = req.headers.cookie ?? '';
    const match = header
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${ADMIN_SESSION_COOKIE}=`));
    return match?.slice(ADMIN_SESSION_COOKIE.length + 1);
  }

  private setSessionCookie(res: Response, sid: string) {
    const secure = (process.env.ADMIN_URL ?? '').startsWith('https');
    res.cookie(ADMIN_SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: ADMIN_SESSION_TTL_SECONDS * 1000,
    });
  }
}
