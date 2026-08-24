import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VoiceInfo, VoiceGenerateInput, GeneratedAudio } from './voice.types';
import type { VoiceProvider } from './voice-provider.interface';

interface ElevenLabsVoiceResponse {
  voices: Array<{
    voice_id: string;
    name: string;
    labels?: Record<string, string>;
    preview_url?: string | null;
    settings?: Record<string, unknown>;
  }>;
}

@Injectable()
export class ElevenLabsProvider implements VoiceProvider {
  readonly name = 'elevenlabs' as const;
  private readonly logger = new Logger(ElevenLabsProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ELEVENLABS_API_KEY')?.trim() || '';
    this.baseUrl =
      this.config.get<string>('ELEVENLABS_API_URL')?.trim() ||
      'https://api.elevenlabs.io';
    this.defaultModel =
      this.config.get<string>('ELEVENLABS_MODEL')?.trim() ||
      this.config.get<string>('ELEVENLABS_DEFAULT_MODEL')?.trim() ||
      'eleven_multilingual_v2';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (!this.isConfigured()) {
      throw new Error(
        'ELEVENLABS_API_KEY no configurada. Configurá la variable de entorno.',
      );
    }
    const url = `${this.baseUrl}/v1/voices`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'xi-api-key': this.apiKey },
      });
    } catch (error) {
      this.logger.error(
        `ElevenLabs listVoices network error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new Error('No se pudo conectar a ElevenLabs');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`ElevenLabs listVoices failed ${res.status}: ${text.slice(0, 500)}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error('ElevenLabs API key inválida o sin permisos');
      }
      if (res.status === 429) {
        throw new Error('ElevenLabs rate limit — intentá en unos minutos');
      }
      throw new Error(`ElevenLabs no disponible (${res.status})`);
    }
    const data = (await res.json()) as ElevenLabsVoiceResponse;
    // Filtrar solo voces en español (ElevenLabs trae todas por defecto en inglés)
    const spanishFilter = (v: { labels?: Record<string, string>; name: string }) => {
      const labels = v.labels ?? {};
      const lang = (labels.language ?? '').toLowerCase();
      const accent = (labels.accent ?? '').toLowerCase();
      const name = v.name.toLowerCase();
      // ElevenLabs labels: language: es, es-419, spanish, etc. accent: Argentina, Mexico, Spain, Latino, etc.
      const isSpanishLang = lang.includes('es') || lang.includes('spanish') || lang.includes('español');
      const isSpanishAccent =
        accent.includes('spanish') ||
        accent.includes('español') ||
        accent.includes('argentina') ||
        accent.includes('mexico') ||
        accent.includes('mexican') ||
        accent.includes('spain') ||
        accent.includes('españa') ||
        accent.includes('latino') ||
        accent.includes('colombia') ||
        accent.includes('chile') ||
        accent.includes('peru') ||
        accent.includes('catalan') ||
        name.includes('sofía') ||
        name.includes('sofia');
      // Usar multilingual_v2: todas técnicamente hablan es, pero filtramos para no inundar con 100+ inglesas
      return isSpanishLang || isSpanishAccent;
    };

    const allVoices = (data.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      provider: 'elevenlabs' as const,
      language: v.labels?.language ?? v.labels?.accent ?? null,
      accent: v.labels?.accent ?? null,
      gender: v.labels?.gender ?? null,
      previewUrl: v.preview_url ?? null,
      labels: v.labels,
    }));

    // Debug: loguear labels reales para afinar filtro (no expone secrets)
    for (const v of data.voices ?? []) {
      this.logger.log(`[VOICE] ${v.name} (${v.voice_id}) labels=${JSON.stringify(v.labels)}`);
    }

    // Preset VOICE_IDS (si el usuario pasa lista de IDs, traemos esas voces directo sin filtrar)
    const presetIdsRaw = this.config.get<string>('ELEVENLABS_VOICE_IDS')?.trim() || '';
    if (presetIdsRaw) {
      const presetIds = [...new Set(presetIdsRaw.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean))];
      if (presetIds.length) {
        this.logger.log(`[VOICE] ELEVENLABS_VOICE_IDS configurado (${presetIds.length} ids) — trayendo voces por ID`);
        const presetVoices: typeof allVoices = [];
        await Promise.all(
          presetIds.map(async (vid) => {
            try {
              const r = await fetch(`${this.baseUrl}/v1/voices/${encodeURIComponent(vid)}`, {
                headers: { 'xi-api-key': this.apiKey },
              });
              if (!r.ok) {
                this.logger.warn(`[VOICE] Preset voice ${vid} no disponible (${r.status})`);
                return;
              }
              const j = (await r.json()) as { voice_id?: string; name?: string; labels?: Record<string, string>; preview_url?: string | null };
              const voiceId = j.voice_id || vid;
              const name = j.name || vid;
              presetVoices.push({
                voiceId,
                name,
                provider: 'elevenlabs' as const,
                language: j.labels?.language ?? j.labels?.accent ?? null,
                accent: j.labels?.accent ?? null,
                gender: j.labels?.gender ?? null,
                previewUrl: j.preview_url ?? null,
                labels: j.labels,
              });
            } catch (e) {
              this.logger.warn(`[VOICE] Error trayendo preset ${vid}: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }),
        );
        if (presetVoices.length) {
          this.logger.log(`[VOICE] Retornando ${presetVoices.length} voces preset`);
          return presetVoices;
        }
        this.logger.warn(`[VOICE] Ninguna preset voice encontrada, cayendo a filtro normal`);
      }
    }

    const filterMode = (this.config.get<string>('ELEVENLABS_VOICES_FILTER') ?? 'es').trim().toLowerCase();
    if (filterMode === 'all' || filterMode === 'todos') {
      this.logger.log(`[VOICE] Filtro desactivado (ELEVENLABS_VOICES_FILTER=all) — devolviendo ${allVoices.length} voces`);
      return allVoices;
    }

    const spanishVoices = (data.voices ?? []).filter(spanishFilter).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      provider: 'elevenlabs' as const,
      language: v.labels?.language ?? v.labels?.accent ?? null,
      accent: v.labels?.accent ?? null,
      gender: v.labels?.gender ?? null,
      previewUrl: v.preview_url ?? null,
      labels: v.labels,
    }));
    if (spanishVoices.length) {
      this.logger.log(`[VOICE] Filtradas ${spanishVoices.length}/${allVoices.length} voces en español`);
      return spanishVoices;
    }
    this.logger.warn(`[VOICE] Sin voces en español detectadas (${allVoices.length} totales) — devolviendo solo españolas (0). Agregá voces en español desde https://elevenlabs.io/app/voice-library?language=es o poné ELEVENLABS_VOICES_FILTER=all para ver todas`);
    return spanishVoices;
  }

  async generate(input: VoiceGenerateInput): Promise<GeneratedAudio> {
    if (!this.isConfigured()) {
      throw new Error('ELEVENLABS_API_KEY no configurada');
    }
    const text = input.text?.trim();
    if (!text) throw new Error('Texto requerido para generar audio');
    if (text.length > 5000) throw new Error('Texto demasiado largo (máx 5000 caracteres)');
    const voiceId = input.voiceId?.trim();
    if (!voiceId) throw new Error('voiceId requerido');
    const model = input.model?.trim() || this.defaultModel;

    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const body: Record<string, unknown> = {
      text,
      model_id: model,
      voice_settings: input.voiceSettings ?? {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    };
    // Prepared for future pronunciation dictionaries — only send if provided
    if (input.pronunciationDictionaryLocators?.length) {
      (body as Record<string, unknown>).pronunciation_dictionary_locators =
        input.pronunciationDictionaryLocators;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      this.logger.error(
        `ElevenLabs generate network error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new Error('No se pudo conectar a ElevenLabs');
    }

    if (!res.ok) {
      const textBody = await res.text().catch(() => '');
      this.logger.warn(
        `ElevenLabs generate failed ${res.status}: ${textBody.slice(0, 800)}`,
      );
      // Map to user-friendly messages, keep technical in logs
      if (res.status === 401 || res.status === 403) {
        throw new Error('ElevenLabs API key inválida');
      }
      if (res.status === 402) {
        throw new Error('Créditos insuficientes en ElevenLabs');
      }
      if (res.status === 429) {
        throw new Error('ElevenLabs rate limit — intentá en unos minutos');
      }
      if (res.status === 422) {
        // Try to parse detail
        try {
          const parsed = JSON.parse(textBody) as { detail?: { message?: string } | string };
          const msg =
            typeof parsed.detail === 'string'
              ? parsed.detail
              : typeof parsed.detail?.message === 'string'
                ? parsed.detail.message
                : null;
          if (msg && /voice.*not found/i.test(msg)) {
            throw new Error('Voice ID no existe en ElevenLabs');
          }
          throw new Error(msg || 'Parámetros inválidos para ElevenLabs');
        } catch {
          throw new Error('Voice ID inexistente o parámetros inválidos');
        }
      }
      if (res.status >= 500) {
        throw new Error('ElevenLabs no disponible, intentá más tarde');
      }
      // Generic
      try {
        const parsed = JSON.parse(textBody) as { detail?: unknown };
        if (parsed.detail) {
          throw new Error(typeof parsed.detail === 'string' ? parsed.detail : 'Error de ElevenLabs');
        }
      } catch {
        // ignore
      }
      throw new Error(`ElevenLabs error (${res.status})`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error('ElevenLabs devolvió audio vacío');

    const mime = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
    // Duration unknown until probe — caller can probe via ffprobe if needed
    return {
      buffer,
      mimeType: mime.includes('audio') ? mime : 'audio/mpeg',
      provider: 'elevenlabs',
      voiceId,
      model,
      text,
      // estimated cost placeholder — elevenlabs pricing per char; approximate
      estimatedCost: Number((text.length * 0.00018).toFixed(6)),
    };
  }

  async preview(input: { text: string; voiceId: string }): Promise<GeneratedAudio> {
    // Preview uses same TTS but with truncated text (first 120 chars)
    const previewText = input.text.slice(0, 200);
    return this.generate({ text: previewText, voiceId: input.voiceId });
  }
}
