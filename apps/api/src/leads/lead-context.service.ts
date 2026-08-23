import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeadContactabilityService } from './lead-contactability.service';
import { LeadLifecycleService } from './lead-lifecycle.service';

export interface LeadPromptSnapshot {
  text: string;
  askForMissingContact: boolean;
  missingFields: string[];
}

@Injectable()
export class LeadContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactability: LeadContactabilityService,
    private readonly lifecycle: LeadLifecycleService,
  ) {}

  async snapshot(
    businessId: string,
    conversationId?: string | null,
  ): Promise<LeadPromptSnapshot | null> {
    if (!conversationId) return null;
    const lead = await this.prisma.lead.findFirst({
      where: { businessId, conversationId },
      include: { conversation: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) return null;
    const config = await this.lifecycle.getPublic(businessId);
    const contact = await this.contactability.resolve({
      businessId,
      phone: lead.phone,
      email: lead.email,
      conversation: lead.conversation
        ? {
            channel: lead.conversation.channel,
            contactPhone: lead.conversation.contactPhone,
          }
        : null,
    });
    const nextFollowUp = await this.prisma.leadFollowUp.findFirst({
      where: { leadId: lead.id, status: { in: ['pending', 'review'] } },
      orderBy: { scheduledAt: 'asc' },
    });
    const lines = [
      'Lead actual:',
      `- Nombre: ${lead.name || 'sin nombre'}`,
      `- Estado: ${lead.status}`,
      lead.interest ? `- Interés: ${lead.interest}` : null,
      lead.objections ? `- Objeciones: ${lead.objections}` : null,
      `- Contactable: ${contact.isContactable ? 'sí' : 'no'} (${contact.channels.join(', ') || 'sin canal'})`,
      contact.missingFields.length
        ? `- Datos faltantes: ${contact.missingFields.join(', ')}`
        : null,
      nextFollowUp
        ? `- Próximo seguimiento: ${nextFollowUp.scheduledAt.toISOString()} (${nextFollowUp.objective})`
        : null,
    ].filter(Boolean);

    if (
      config.askForMissingContact &&
      !contact.isContactable &&
      ['interested', 'contacted'].includes(lead.status)
    ) {
      lines.push(
        'Si hay interés, pedí WhatsApp o email con naturalidad y guardalo con createLead. No pidas teléfono si ya estás en WhatsApp.',
      );
    }

    return {
      text: lines.join('\n'),
      askForMissingContact:
        config.askForMissingContact && !contact.isContactable,
      missingFields: contact.missingFields,
    };
  }
}
