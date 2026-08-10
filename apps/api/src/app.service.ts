import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      status: 'ok',
      service: 'ai-automation-core',
      timestamp: new Date().toISOString(),
    };
  }
}
