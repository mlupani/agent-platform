import { Injectable, OnModuleInit } from '@nestjs/common';
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
import { TriggerAutomationTool } from './implementations/trigger-automation.tool';
import { ToolRegistry } from './tool-registry';

@Injectable()
export class ToolsBootstrap implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
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
    private readonly triggerAutomation: TriggerAutomationTool,
  ) {}

  onModuleInit() {
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
    this.registry.register(this.triggerAutomation);
  }
}
