import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CancelAppointmentTool } from './implementations/cancel-appointment.tool';
import { CheckAvailabilityTool } from './implementations/check-availability.tool';
import { CreateAppointmentTool } from './implementations/create-appointment.tool';
import { CreateLeadTool } from './implementations/create-lead.tool';
import { GetBusinessInformationTool } from './implementations/get-business-information.tool';
import { GetOpeningHoursTool } from './implementations/get-opening-hours.tool';
import { GetServicesTool } from './implementations/get-services.tool';
import { RequestHumanAssistanceTool } from './implementations/request-human-assistance.tool';
import { RescheduleAppointmentTool } from './implementations/reschedule-appointment.tool';
import { SendEmailTool } from './implementations/send-email.tool';
import { SendWhatsAppMessageTool } from './implementations/send-whatsapp-message.tool';
import { TriggerAutomationTool } from './implementations/trigger-automation.tool';
import { ToolRegistry } from './tool-registry';

const AUTO_ENABLE_TOOLS = [
  { name: 'sendEmail', risk: 'WRITE' },
  { name: 'sendWhatsAppMessage', risk: 'WRITE' },
] as const;

@Injectable()
export class ToolsBootstrap implements OnModuleInit {
  private readonly logger = new Logger(ToolsBootstrap.name);

  constructor(
    private readonly registry: ToolRegistry,
    private readonly prisma: PrismaService,
    private readonly getBusinessInformation: GetBusinessInformationTool,
    private readonly getOpeningHours: GetOpeningHoursTool,
    private readonly getServices: GetServicesTool,
    private readonly checkAvailability: CheckAvailabilityTool,
    private readonly createAppointment: CreateAppointmentTool,
    private readonly cancelAppointment: CancelAppointmentTool,
    private readonly rescheduleAppointment: RescheduleAppointmentTool,
    private readonly createLead: CreateLeadTool,
    private readonly requestHumanAssistance: RequestHumanAssistanceTool,
    private readonly sendEmail: SendEmailTool,
    private readonly sendWhatsAppMessage: SendWhatsAppMessageTool,
    private readonly triggerAutomation: TriggerAutomationTool,
  ) {}

  async onModuleInit() {
    this.registry.register(this.getBusinessInformation);
    this.registry.register(this.getOpeningHours);
    this.registry.register(this.getServices);
    this.registry.register(this.checkAvailability);
    this.registry.register(this.createAppointment);
    this.registry.register(this.cancelAppointment);
    this.registry.register(this.rescheduleAppointment);
    this.registry.register(this.createLead);
    this.registry.register(this.requestHumanAssistance);
    this.registry.register(this.sendEmail);
    this.registry.register(this.sendWhatsAppMessage);
    this.registry.register(this.triggerAutomation);

    await this.ensureConfirmationToolsEnabled();
  }

  /** Agrega tools nuevas de confirmación a negocios/agentes ya existentes. */
  private async ensureConfirmationToolsEnabled(): Promise<void> {
    try {
      const businesses = await this.prisma.business.findMany({
        select: { id: true },
      });

      for (const business of businesses) {
        for (const tool of AUTO_ENABLE_TOOLS) {
          await this.prisma.toolConfig.upsert({
            where: {
              businessId_name: {
                businessId: business.id,
                name: tool.name,
              },
            },
            create: {
              businessId: business.id,
              name: tool.name,
              enabled: true,
              risk: tool.risk,
              requireConfirmation: false,
            },
            update: {
              enabled: true,
              risk: tool.risk,
              requireConfirmation: false,
            },
          });
        }

        const agents = await this.prisma.agentConfig.findMany({
          where: { businessId: business.id },
          select: { id: true, enabledTools: true },
        });

        for (const agent of agents) {
          const next = [...agent.enabledTools];
          let changed = false;
          for (const tool of AUTO_ENABLE_TOOLS) {
            if (!next.includes(tool.name)) {
              next.push(tool.name);
              changed = true;
            }
          }
          if (changed) {
            await this.prisma.agentConfig.update({
              where: { id: agent.id },
              data: { enabledTools: next },
            });
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron auto-habilitar tools de confirmación: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}
