import { Injectable } from '@nestjs/common';

@Injectable()
export class ChunkerService {
  /**
   * Parte por secciones markdown (##) cuando aplica; si no, ventana fija con overlap.
   */
  chunk(text: string, chunkSize = 800, overlap = 120): string[] {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    if (this.looksLikeFaqMarkdown(normalized)) {
      const sections = this.splitMarkdownSections(normalized);
      const chunks: string[] = [];
      for (const section of sections) {
        if (section.length <= chunkSize) {
          chunks.push(section);
        } else {
          chunks.push(...this.windowChunk(section, chunkSize, overlap));
        }
      }
      return chunks.filter(Boolean);
    }

    return this.windowChunk(normalized, chunkSize, overlap);
  }

  private looksLikeFaqMarkdown(text: string): boolean {
    const headings = text.match(/^##\s+.+/gm);
    return Boolean(headings && headings.length >= 2);
  }

  private splitMarkdownSections(text: string): string[] {
    const parts = text.split(/\n(?=##\s+)/);
    return parts.map((part) => part.trim()).filter(Boolean);
  }

  private windowChunk(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    if (text.length <= chunkSize) return [text];

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(text.length, start + chunkSize);
      chunks.push(text.slice(start, end).trim());
      if (end >= text.length) break;
      start = Math.max(0, end - overlap);
    }
    return chunks.filter(Boolean);
  }
}
