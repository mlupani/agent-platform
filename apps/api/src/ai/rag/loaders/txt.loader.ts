import { Injectable } from '@nestjs/common';
import type { DocumentLoader, LoadedDocument } from './document-loader.interface';

@Injectable()
export class TxtLoader implements DocumentLoader {
  readonly mimeTypes = ['text/plain'];

  async load(buffer: Buffer): Promise<LoadedDocument> {
    return { text: buffer.toString('utf8') };
  }
}
