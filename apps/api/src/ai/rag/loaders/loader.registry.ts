import { BadRequestException, Injectable } from '@nestjs/common';
import { MarkdownLoader } from './markdown.loader';
import { PdfLoader } from './pdf.loader';
import { TxtLoader } from './txt.loader';
import type { DocumentLoader } from './document-loader.interface';

@Injectable()
export class LoaderRegistry {
  private readonly loaders: DocumentLoader[];

  constructor(
    txt: TxtLoader,
    markdown: MarkdownLoader,
    pdf: PdfLoader,
  ) {
    this.loaders = [txt, markdown, pdf];
  }

  resolve(mimeType: string, filename: string): DocumentLoader {
    const byMime = this.loaders.find((loader) =>
      loader.mimeTypes.includes(mimeType),
    );
    if (byMime) return byMime;

    if (filename.endsWith('.md')) return this.loaders[1];
    if (filename.endsWith('.txt')) return this.loaders[0];
    if (filename.endsWith('.pdf')) return this.loaders[2];

    throw new BadRequestException(
      `No document loader available for ${mimeType || filename}`,
    );
  }
}
