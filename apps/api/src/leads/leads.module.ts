import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiModule } from '../ai/ai.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { ChannelsModule } from '../channels/channels.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocialModule } from '../social/social.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { LeadContactabilityService } from './lead-contactability.service';
import { LeadContextService } from './lead-context.service';
import { LeadConversionService } from './lead-conversion.service';
import { LeadEventsService } from './lead-events.service';
import { LeadFollowUpGeneratorService } from './lead-follow-up-generator.service';
import { LeadFollowUpProcessorService } from './lead-follow-up-processor.service';
import { LeadFollowUpSenderService } from './lead-follow-up-sender.service';
import { LeadFollowUpProcessor } from './lead-follow-up.processor';
import { LEAD_FOLLOW_UP_QUEUE } from './lead-follow-up.queue';
import { LeadFollowUpScheduler } from './lead-follow-up.scheduler';
import { LeadFollowUpService } from './lead-follow-up.service';
import { LeadLifecycleService } from './lead-lifecycle.service';
import { LeadsAdminController } from './leads-admin.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [
    BusinessesModule,
    EmailModule,
    NotificationsModule,
    ChannelsModule,
    forwardRef(() => WhatsAppModule),
    forwardRef(() => SocialModule),
    forwardRef(() => AiModule),
    BullModule.registerQueue({ name: LEAD_FOLLOW_UP_QUEUE }),
  ],
  controllers: [LeadsAdminController],
  providers: [
    LeadsService,
    LeadContactabilityService,
    LeadEventsService,
    LeadLifecycleService,
    LeadConversionService,
    LeadFollowUpService,
    LeadFollowUpGeneratorService,
    LeadFollowUpSenderService,
    LeadFollowUpProcessorService,
    LeadFollowUpScheduler,
    LeadFollowUpProcessor,
    LeadContextService,
  ],
  exports: [
    LeadsService,
    LeadConversionService,
    LeadFollowUpService,
    LeadContextService,
    LeadLifecycleService,
  ],
})
export class LeadsModule {}
