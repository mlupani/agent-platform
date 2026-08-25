import { Module } from '@nestjs/common';
import { PacksModule } from '../packs/packs.module';
import { StudentContextService } from './student-context.service';

@Module({
  imports: [PacksModule],
  providers: [StudentContextService],
  exports: [StudentContextService],
})
export class StudentsModule {}
