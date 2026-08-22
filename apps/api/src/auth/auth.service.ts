import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import {
  ADMIN_SESSION_TTL_SECONDS,
  type AdminRole,
  type AdminSessionPayload,
  sessionRedisKey,
} from './auth.constants';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureSeedUsers();
  }

  async ensureSeedUsers() {
    const seeds: Array<{
      username: string;
      password: string;
      role: AdminRole;
      displayName: string;
    }> = [
      {
        username:
          this.config.get<string>('AUTH_ADMIN_USERNAME')?.trim() || 'admin',
        password:
          this.config.get<string>('AUTH_ADMIN_PASSWORD')?.trim() || 'admin123',
        role: 'ADMIN',
        displayName: 'Administrador',
      },
      {
        username:
          this.config.get<string>('AUTH_USER_USERNAME')?.trim() || 'negocio',
        password:
          this.config.get<string>('AUTH_USER_PASSWORD')?.trim() || 'negocio123',
        role: 'USER',
        displayName: 'Negocio',
      },
    ];

    for (const seed of seeds) {
      if (!seed.username || !seed.password) continue;
      const existing = await this.prisma.adminUser.findUnique({
        where: { username: seed.username },
      });
      if (existing) continue;
      const passwordHash = await bcrypt.hash(seed.password, 10);
      await this.prisma.adminUser.create({
        data: {
          username: seed.username,
          passwordHash,
          role: seed.role,
          displayName: seed.displayName,
        },
      });
      this.logger.log(`Usuario panel creado: ${seed.username} (${seed.role})`);
    }
  }

  async validateCredentials(username: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { username: username.trim() },
    });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    return user;
  }

  async createSession(user: {
    id: string;
    username: string;
    role: string;
    displayName: string | null;
  }): Promise<{ sid: string; payload: AdminSessionPayload }> {
    const sid = randomUUID();
    const payload: AdminSessionPayload = {
      userId: user.id,
      username: user.username,
      role: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
      displayName: user.displayName,
    };
    await this.redis.set(
      sessionRedisKey(sid),
      JSON.stringify(payload),
      ADMIN_SESSION_TTL_SECONDS,
    );
    return { sid, payload };
  }

  async getSession(sid: string | undefined | null) {
    if (!sid) return null;
    const raw = await this.redis.get(sessionRedisKey(sid));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AdminSessionPayload;
    } catch {
      return null;
    }
  }

  async destroySession(sid: string | undefined | null) {
    if (!sid) return;
    await this.redis.getClient().del(sessionRedisKey(sid));
  }

  async touchSession(sid: string, payload: AdminSessionPayload) {
    await this.redis.set(
      sessionRedisKey(sid),
      JSON.stringify(payload),
      ADMIN_SESSION_TTL_SECONDS,
    );
  }
}
