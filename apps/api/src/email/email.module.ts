import { Module } from '@nestjs/common';
import { SecretsService } from '../common/crypto/secrets.service';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService, SecretsService],
  exports: [EmailService],
})
export class EmailModule {}
