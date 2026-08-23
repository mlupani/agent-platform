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

interface ZernioOAuthErrorMapped {
  message: string;
  platform?: 'instagram' | 'tiktok' | 'facebook';
}

export function mapZernioOAuthError(
  error?: string,
  description?: string,
): ZernioOAuthErrorMapped {
  const code = (error ?? '').trim();
  const desc = (description ?? '').trim();
  const haystack = `${code} ${desc}`.toLowerCase();

  if (
    haystack.includes('no_facebook_pages') ||
    haystack.includes('no facebook pages') ||
    /no pages/.test(haystack)
  ) {
    return {
      platform: 'facebook',
      message:
        'Facebook no encontró ninguna Página. No se puede conectar un perfil personal: tenés que ser administrador o editor de una Página, entrar con esa cuenta y aceptar el permiso de ver las Páginas.',
    };
  }

  if (
    haystack.includes('access_denied') ||
    haystack.includes('user_denied') ||
    haystack.includes('user_cancelled') ||
    haystack.includes('user_canceled')
  ) {
    return {
      message:
        'Cancelaste el permiso. Volvé a conectar y aceptá todos los permisos que pide Meta, incluido el de ver las Páginas.',
    };
  }

  if (
    haystack.includes('reconnect_account_mismatch') ||
    haystack.includes('account_mismatch')
  ) {
    return {
      message:
        'La cuenta de Facebook no coincide con la que ya estaba conectada. Entrá con la misma cuenta o desconectá primero.',
    };
  }

  if (haystack.includes('payment_required') || haystack.includes('free_tier')) {
    return {
      message:
        'Zernio pidió una cuenta de pago para completar esta conexión. Revisá el plan de Zernio.',
    };
  }

  const readable = desc && desc !== code ? desc : '';
  if (readable && !/^[a-z0-9_]+$/i.test(readable)) {
    return { message: readable };
  }
  if (code && !/^[a-z0-9_]+$/i.test(code)) {
    return { message: code };
  }
  return { message: 'No se pudo completar la conexión. Volvé a intentar.' };
}

function platformLabel(platform: string): string {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'tiktok') return 'TikTok';
  if (platform === 'facebook') return 'Facebook';
  return platform;
}
