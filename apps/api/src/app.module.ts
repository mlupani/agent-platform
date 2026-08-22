import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuardsModule } from './common/guards/auth-guards.module';
import { AutomationsModule } from './automations/automations.module';
import { BusinessesModule } from './businesses/businesses.module';
import { ChannelsModule } from './channels/channels.module';
import { ChatModule } from './chat/chat.module';
import { WebChatModule } from './web-chat/web-chat.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ConversationsModule } from './conversations/conversations.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ServicesModule } from './services/services.module';
import { UsersModule } from './users/users.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { CalendarModule } from './calendar/calendar.module';
import { ObservabilityModule } from './observability/observability.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ContentModule } from './content/content.module';
import { SocialModule } from './social/social.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    BullModule.forRoot({
      connection: (() => {
        const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
        return {
          host: url.hostname,
          port: Number(url.port || 6379),
        };
      })(),
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    AuthGuardsModule,
    RealtimeModule,
    AiModule,
    BusinessesModule,
    ServicesModule,
    ConversationsModule,
    KnowledgeModule,
    IntegrationsModule,
    AutomationsModule,
    ChannelsModule,
    WhatsAppModule,
    CalendarModule,
    ObservabilityModule,
    UsersModule,
    AnalyticsModule,
    ChatModule,
    WebChatModule,
    ContentModule,
    SocialModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
