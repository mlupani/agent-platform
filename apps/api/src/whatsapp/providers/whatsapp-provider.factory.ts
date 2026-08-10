import { Injectable } from '@nestjs/common';
import { WhatsAppConfigService } from '../whatsapp-config.service';
import { MetaCloudWhatsAppProvider } from './meta-cloud.whatsapp-provider';
import { WahaWhatsAppProvider } from './waha.whatsapp-provider';
import type { WhatsAppProvider } from './whatsapp-provider.interface';

@Injectable()
export class WhatsAppProviderFactory {
  constructor(
    private readonly config: WhatsAppConfigService,
    private readonly waha: WahaWhatsAppProvider,
    private readonly meta: MetaCloudWhatsAppProvider,
  ) {}

  async getForBusiness(businessId: string): Promise<WhatsAppProvider> {
    const config = await this.config.getForRuntime(businessId);
    if (config?.provider === 'meta_cloud') return this.meta;
    return this.waha;
  }

  getWaha(): WahaWhatsAppProvider {
    return this.waha;
  }
}
