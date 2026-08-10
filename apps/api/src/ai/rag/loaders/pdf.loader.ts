import { Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import type { DocumentLoader, LoadedDocument } from './document-loader.interface';

@Injectable()
export class PdfLoader implements DocumentLoader {
  readonly mimeTypes = ['application/pdf'];

  async load(buffer: Buffer, filename: string): Promise<LoadedDocument> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return {
        text: result.text,
        metadata: { pages: result.pages.length, filename },
      };
    } finally {
      await parser.destroy();
    }
  }
}
