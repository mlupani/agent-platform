import { HttpException, HttpStatus } from '@nestjs/common';

export class SocialError extends HttpException {
  constructor(message: string, status: HttpStatus) {
    super(message, status);
  }
}

export class SocialNotConfiguredError extends SocialError {
  constructor() {
    super(
      'Zernio no está configurado. Falta ZERNIO_API_KEY en el servidor.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class SocialAccountNotFoundError extends SocialError {
  constructor(platform?: string) {
    super(
      platform
        ? `No hay una cuenta de ${platformLabel(platform)} conectada. Conectala en Integraciones.`
        : 'Cuenta social no encontrada',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class SocialOAuthError extends SocialError {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class SocialWebhookSignatureError extends SocialError {
  constructor() {
    super('Firma de webhook inválida', HttpStatus.UNAUTHORIZED);
  }
}

export class SocialRateLimitError extends SocialError {
  constructor() {
    super(
      'Zernio alcanzó el límite de peticiones. Probá de nuevo en unos minutos.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class SocialAuthError extends SocialError {
  constructor() {
    super(
      'Zernio rechazó la API key. Revisá ZERNIO_API_KEY.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export class SocialProviderError extends SocialError {
  constructor(message: string) {
    super(message, HttpStatus.BAD_GATEWAY);
  }
}

export function safeSocialMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 280);
}

function platformLabel(platform: string): string {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'tiktok') return 'TikTok';
  return platform;
}
