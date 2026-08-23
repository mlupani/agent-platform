import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';

export interface Contactability {
  isContactable: boolean;
  channels: string[];
  missingFields: string[];
}

@Injectable()
export class LeadContactabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async resolve(input: {
    businessId: string;
    phone?: string | null;
    email?: string | null;
    conversation?: {
      channel: string;
      contactPhone?: string | null;
    } | null;
  }): Promise<Contactability> {
    const channels: string[] = [];
    const phone =
      input.phone?.trim() || input.conversation?.contactPhone?.trim() || '';
    const email = input.email?.trim() || '';
    const channel = input.conversation?.channel?.toUpperCase() ?? '';

    const [whatsappReady, emailReady] = await Promise.all([
      this.isWhatsAppReady(input.businessId),
      this.isEmailReady(input.businessId),
    ]);

    if (phone && whatsappReady) channels.push('whatsapp');
    if (email && emailReady) channels.push('email');
    if (channel === 'INSTAGRAM') channels.push('instagram');
    if (channel === 'FACEBOOK') channels.push('facebook');
    if (channel === 'WHATSAPP' && phone && !channels.includes('whatsapp')) {
      channels.push('whatsapp');
    }

    const missingFields: string[] = [];
    if (
      !phone &&
      !email &&
      !['INSTAGRAM', 'FACEBOOK', 'WHATSAPP'].includes(channel)
    ) {
      missingFields.push('phone', 'email');
    } else if (!phone && channel === 'WEB') {
      missingFields.push('phone');
    }

    return {
      isContactable: channels.length > 0,
      channels,
      missingFields,
    };
  }

  private async isWhatsAppReady(businessId: string) {
    const config = await this.prisma.whatsAppConfig.findUnique({
      where: { businessId },
      select: { status: true, sessionStatus: true },
    });
    return config?.status === 'connected' || config?.sessionStatus === 'WORKING';
  }

  private async isEmailReady(businessId: string) {
    return Boolean(await this.email.resolveTransport(businessId));
  }
}
