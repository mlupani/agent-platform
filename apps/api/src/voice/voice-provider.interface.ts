import type { VoiceInfo, VoiceGenerateInput, GeneratedAudio } from './voice.types';

export interface VoiceProvider {
  readonly name: string;
  isConfigured(): boolean;
  listVoices(): Promise<VoiceInfo[]>;
  generate(input: VoiceGenerateInput): Promise<GeneratedAudio>;
  preview?(input: { text: string; voiceId: string }): Promise<GeneratedAudio>;
}

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');
export const ELEVENLABS_VOICE_PROVIDER = Symbol('ELEVENLABS_VOICE_PROVIDER');
