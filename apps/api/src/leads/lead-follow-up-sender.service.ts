import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChannelRegistry } from '../channels/channel.registry';
import { EmailService } from '../email/email.service';
import { SocialInboxService } from '../social/social-inbox.service';
import { WhatsAppProviderFactory } from '../whatsapp/providers/whatsapp-provider.factory';
import { LeadContactabilityService } from './lead-contactability.service';
import { LeadEventsService } from './lead-events.service';

@Injectable()
export class LeadFollowUpSenderService {
  private readonly logger = new Logger(LeadFollowUpSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppProviderFactory,
    private readonly socialInbox: SocialInboxService,
    private readonly contactability: LeadContactabilityService,
    private readonly events: LeadEventsService,
  ) {}

  async send(followUpId: string, body: string) {
    const followUp = await this.prisma.leadFollowUp.findUniqueOrThrow({
      where: { id: followUpId },
      include: {
        lead: { include: { conversation: true } },
      },
    });
    const lead = followUp.lead;
    const conversation = lead.conversation;
    const contact = await this.contactability.resolve({
      businessId: followUp.businessId,
      phone: lead.phone,
      email: lead.email,
      conversation: conversation
        ? { channel: conversation.channel, contactPhone: conversation.contactPhone }
        : null,
    });
    const preferred = (lead.preferredChannel || '').toLowerCase();
    const channel =
      (preferred && contact.channels.includes(preferred)
        ? preferred
        : conversation?.channel?.toLowerCase()) ||
      contact.channels[0];

    if (!channel) {
      throw new Error('El lead no tiene un canal contactable');
    }

    if (conversation && ['whatsapp', 'instagram', 'facebook'].includes(channel)) {
      const adapter = this.channels.get(conversation.channel);
      if (adapter) {
        await adapter.send({
          businessId: followUp.businessId,
          conversationId: conversation.id,
          message: body,
          metadata: { source: 'lead_follow_up', followUpId },
        });
      } else if (channel === 'instagram' || channel === 'facebook') {
        await this.socialInbox.sendForConversation({
          businessId: followUp.businessId,
          conversationId: conversation.id,
          body,
        });
      }
      await this.persistOutbound(conversation.id, followUp.businessId, body, followUpId);
    } else if (channel === 'whatsapp') {
      const phone = lead.phone || conversation?.contactPhone;
      if (!phone) throw new Error('Falta teléfono para WhatsApp');
      const provider = await this.whatsapp.getForBusiness(followUp.businessId);
      await provider.sendText({
        businessId: followUp.businessId,
        to: phone,
        body,
      });
      if (conversation) {
        await this.persistOutbound(conversation.id, followUp.businessId, body, followUpId);
      }
    } else if (channel === 'email') {
      if (!lead.email) throw new Error('Falta email');
      await this.email.send(
        {
          to: lead.email,
          subject: 'Te escribo para seguir con lo que charlamos',
          text: body,
        },
        followUp.businessId,
      );
    } else {
      throw new Error(`Canal ${channel} no disponible para follow-up`);
    }

    await this.prisma.leadFollowUp.update({
      where: { id: followUp.id },
      data: {
        status: 'sent',
        sentMessage: body,
        sentAt: new Date(),
        channel,
      },
    });
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { lastContactedAt: new Date() },
    });
    await this.events.append({
      businessId: followUp.businessId,
      leadId: lead.id,
      type: 'follow_up_sent',
      payload: { followUpId, channel },
    });
  }

  private async persistOutbound(
    conversationId: string,
    businessId: string,
    body: string,
    followUpId: string,
  ) {
    await this.prisma.message.create({
      data: {
        conversationId,
        businessId,
        role: 'assistant',
        sender: 'AI',
        content: body,
        status: 'sent',
        metadata: { source: 'lead_follow_up', followUpId } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessagePreview: body.slice(0, 280),
        lastMessageSender: 'AI',
        lastMessageAt: new Date(),
      },
    });
  }
}
