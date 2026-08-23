import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthedRequest } from './api-key.guard';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (request.adminUser?.role === 'ADMIN') return true;
    throw new ForbiddenException(
      'Solo el administrador puede ver esta sección',
    );
  }
}
