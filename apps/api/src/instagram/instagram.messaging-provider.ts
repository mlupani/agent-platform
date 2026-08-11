import { Injectable } from '@nestjs/common';
import type {
  ConnectionStatus,
  MessagingProvider,
  SendMessageResult,
  SendTextInput,
} from '../messaging/messaging-provider.interface';
import { InstagramConfigService } from './instagram-config.service';
import { InstagramService } from './instagram.service';

@Injectable()
export class InstagramMessagingProvider implements MessagingProvider {
  readonly channel = 'INSTAGRAM' as const;

  constructor(
    private readonly instagram: InstagramService,
    private readonly config: InstagramConfigService,
  ) {}

  async sendText(input: SendTextInput): Promise<SendMessageResult> {
    const threadId = String(input.to);
    const result = await this.instagram.sendThreadMessage(
      input.businessId,
      threadId,
      input.body,
    );
    return { externalId: result.externalId };
  }

  async getConnectionStatus(businessId?: string): Promise<ConnectionStatus> {
    const publicConfig = businessId
      ? await this.instagram.verifyStatus(businessId)
      : await this.config.getPublic();
    return {
      status: publicConfig.status,
      lastError: publicConfig.lastError,
      username: publicConfig.username,
      userId: publicConfig.userId,
      lastSyncAt: publicConfig.lastSyncAt,
    };
  }
}
