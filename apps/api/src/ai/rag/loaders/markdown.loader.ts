import { Injectable } from '@nestjs/common';
import type {
  DocumentLoader,
  LoadedDocument,
} from './document-loader.interface';

@Injectable()
export class MarkdownLoader implements DocumentLoader {
  readonly mimeTypes = ['text/markdown', 'text/x-markdown'];

  async load(buffer: Buffer): Promise<LoadedDocument> {
    return { text: buffer.toString('utf8') };
  }
}
