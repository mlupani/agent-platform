import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ApiKeyGuard } from './api-key.guard';

@Global()
@Module({
  imports: [AuthModule],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard, AuthModule],
})
export class AuthGuardsModule {}
