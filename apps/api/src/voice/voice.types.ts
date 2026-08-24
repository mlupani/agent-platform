export type VoiceProviderName = 'seedance' | 'elevenlabs';

export interface VoiceInfo {
  voiceId: string;
  name: string;
  provider: VoiceProviderName;
  language?: string | null;
  accent?: string | null;
  gender?: string | null;
  previewUrl?: string | null;
  labels?: Record<string, string>;
}

export interface VoiceGenerateInput {
  text: string;
  voiceId: string;
  model?: string;
  // Prepared for future pronunciation dictionaries
  pronunciationDictionaryLocators?: Array<{ pronunciation_dictionary_id: string; version_id: string }>;
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  };
}

export interface GeneratedAudio {
  buffer: Buffer;
  mimeType: string;
  durationSeconds?: number;
  provider: VoiceProviderName;
  voiceId: string;
  voiceName?: string;
  model: string;
  text: string;
  estimatedCost?: number;
}

export interface VoiceListResult {
  voices: VoiceInfo[];
  provider: VoiceProviderName;
}
