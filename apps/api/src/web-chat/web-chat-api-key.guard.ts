import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { hashWidgetApiKey, extractWidgetApiKey, originAllowed } from './web-chat-api-key.util';
import { WebChatConfigService } from './web-chat-config.service';
import type { WebChatAuthContext } from './web-chat.types';

export type WidgetAuthedRequest = Request & {
  webChatAuth?: WebChatAuthContext;
};

@Injectable()
export class WebChatApiKeyGuard implements CanActivate {
  constructor(private readonly config: WebChatConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WidgetAuthedRequest>();
    const apiKey = extractWidgetApiKey(request.headers);
    if (!apiKey) {
      throw new UnauthorizedException('API key del widget requerida');
    }

    const hashed = hashWidgetApiKey(apiKey);
    const config = await this.config.findByApiKeyHash(hashed);
    if (!config?.enabled || !config.apiKeyHash) {
      throw new UnauthorizedException('API key inválida o canal web deshabilitado');
    }

    const origin = request.headers.origin;
    if (!originAllowed(origin, config.allowedOrigins)) {
      throw new ForbiddenException('Origen no permitido para el widget');
    }

    request.webChatAuth = {
      businessId: config.businessId,
      configId: config.id,
      allowedOrigins: config.allowedOrigins,
    };
    return true;
  }
}
