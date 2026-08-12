import { Module, forwardRef } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AutomationsModule } from '../automations/automations.module';
import { CalendarModule } from '../calendar/calendar.module';
import { EmailModule } from '../email/email.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AgentService } from './agents/agent.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { GuardrailsService } from './guardrails/guardrails.service';
import { MemoryService } from './memory/memory.service';
import { PromptBuilderService } from './prompts/prompt-builder.service';
import { GeminiProvider } from './providers/gemini.provider';
import { LlmProviderFactory } from './providers/llm-provider.factory';
import { LlmRoutingService } from './providers/llm-routing.service';
import { OpenAIProvider } from './providers/openai.provider';
import { ChunkerService } from './rag/chunker.service';
import { LoaderRegistry } from './rag/loaders/loader.registry';
import { MarkdownLoader } from './rag/loaders/markdown.loader';
import { PdfLoader } from './rag/loaders/pdf.loader';
import { TxtLoader } from './rag/loaders/txt.loader';
import { RagService } from './rag/rag.service';
import { CancelAppointmentTool } from './tools/implementations/cancel-appointment.tool';
import { CheckAvailabilityTool } from './tools/implementations/check-availability.tool';
import { CreateAppointmentTool } from './tools/implementations/create-appointment.tool';
import { CreateLeadTool } from './tools/implementations/create-lead.tool';
import { GetBusinessInformationTool } from './tools/implementations/get-business-information.tool';
import { GetOpeningHoursTool } from './tools/implementations/get-opening-hours.tool';
import { GetServicesTool } from './tools/implementations/get-services.tool';
import { RequestHumanAssistanceTool } from './tools/implementations/request-human-assistance.tool';
import { RescheduleAppointmentTool } from './tools/implementations/reschedule-appointment.tool';
import { SendEmailTool } from './tools/implementations/send-email.tool';
import { SendWhatsAppMessageTool } from './tools/implementations/send-whatsapp-message.tool';
import { TriggerAutomationTool } from './tools/implementations/trigger-automation.tool';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ToolRegistry } from './tools/tool-registry';
import { ToolsBootstrap } from './tools/tools.bootstrap';
import { ToolsController } from './tools/tools.controller';
import { PgVectorStore } from './vector-store/pgvector.store';

const demoTools = [
  GetBusinessInformationTool,
  GetOpeningHoursTool,
  GetServicesTool,
  CheckAvailabilityTool,
  CreateAppointmentTool,
  CancelAppointmentTool,
  RescheduleAppointmentTool,
  CreateLeadTool,
  RequestHumanAssistanceTool,
  SendEmailTool,
  SendWhatsAppMessageTool,
  TriggerAutomationTool,
];

@Module({
  imports: [
    AutomationsModule,
    AnalyticsModule,
    CalendarModule,
    EmailModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [ToolsController],
  providers: [
    OpenAIProvider,
    GeminiProvider,
    LlmProviderFactory,
    LlmRoutingService,
    PromptBuilderService,
    ToolRegistry,
    ToolExecutorService,
    EmbeddingsService,
    PgVectorStore,
    ChunkerService,
    TxtLoader,
    MarkdownLoader,
    PdfLoader,
    LoaderRegistry,
    RagService,
    MemoryService,
    GuardrailsService,
    AgentService,
    ToolsBootstrap,
    ...demoTools,
  ],
  exports: [
    AgentService,
    ToolRegistry,
    RagService,
    MemoryService,
    LlmProviderFactory,
    LlmRoutingService,
    GuardrailsService,
  ],
})
export class AiModule {}
