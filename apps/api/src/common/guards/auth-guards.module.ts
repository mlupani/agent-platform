import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ApiKeyGuard } from './api-key.guard';
import { AdminRoleGuard } from './admin-role.guard';

@Global()
@Module({
  imports: [AuthModule],
  providers: [ApiKeyGuard, AdminRoleGuard],
  exports: [ApiKeyGuard, AdminRoleGuard, AuthModule],
})
export class AuthGuardsModule {}
