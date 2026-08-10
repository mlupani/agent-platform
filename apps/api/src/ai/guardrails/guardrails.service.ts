import { Injectable } from '@nestjs/common';
import { stripUnsafeInstructions } from '../../common/utils/sanitize';

@Injectable()
export class GuardrailsService {
  sanitizeUserInput(message: string): string {
    return stripUnsafeInstructions(message).trim().slice(0, 8000);
  }

  isBlockedConversationStatus(status: string): boolean {
    return status === 'HUMAN' || status === 'WAITING_HUMAN' || status === 'CLOSED';
  }
}
