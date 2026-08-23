import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { withTimeout } from '../../common/utils/timeout';
import type { InboundMediaFile } from './inbound-audio';
import { filenameForMime, transcriptionLanguage } from './inbound-audio';

const MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';

@Injectable()
export class AudioTranscriptionService {
  private readonly logger = new Logger(AudioTranscriptionService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY') ?? '',
    });
    this.model =
      this.config.get<string>('OPENAI_TRANSCRIBE_MODEL') ?? DEFAULT_MODEL;
  }

  async transcribe(
    file: InboundMediaFile,
    language?: string | null,
  ): Promise<string | null> {
    if (!file.buffer.length) return null;
    if (file.buffer.length > MAX_BYTES) {
      this.logger.warn(
        `Audio too large to transcribe: ${file.buffer.length} bytes`,
      );
      return null;
    }

    const filename = file.filename || filenameForMime(file.mimeType);
    const upload = new File([new Uint8Array(file.buffer)], filename, {
      type: file.mimeType || 'audio/ogg',
    });
    const lang = transcriptionLanguage(language);

    try {
      const result = await withTimeout(
        () =>
          this.client.audio.transcriptions.create({
            file: upload,
            model: this.model,
            ...(lang ? { language: lang } : {}),
          }),
        25_000,
        'audio transcription',
      );
      const text = result.text?.trim();
      return text || null;
    } catch (error) {
      this.logger.warn(
        `Transcription failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  async transcribeFromUrl(
    url: string,
    options?: { mimeType?: string; language?: string | null; headers?: Record<string, string> },
  ): Promise<string | null> {
    const file = await this.download(url, options?.headers, options?.mimeType);
    if (!file) return null;
    return this.transcribe(file, options?.language);
  }

  async download(
    url: string,
    headers?: Record<string, string>,
    fallbackMime?: string,
  ): Promise<InboundMediaFile | null> {
    try {
      const response = await withTimeout(
        () => fetch(url, { headers }),
        15_000,
        'audio download',
      );
      if (!response.ok) {
        this.logger.warn(`Audio download failed: HTTP ${response.status}`);
        return null;
      }
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_BYTES) {
        this.logger.warn(`Audio download skipped, content-length ${length}`);
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) return null;
      const mimeType =
        fallbackMime ||
        response.headers.get('content-type') ||
        'audio/ogg';
      return {
        buffer,
        mimeType: mimeType.split(';')[0].trim(),
        filename: filenameForMime(mimeType),
      };
    } catch (error) {
      this.logger.warn(
        `Audio download failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
  }
}
