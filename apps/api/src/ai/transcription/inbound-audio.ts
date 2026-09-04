export const AUDIO_UNTRANSCRIBED = '[Audio no transcrito]';
export const AUDIO_PREFIX = '[Audio]';

const AUDIO_TYPES = new Set([
  'ptt',
  'audio',
  'voice',
  'ptt_audio',
  'audio_ogg',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/opus',
  'audio/webm',
  'ig_voice',
  'voice_media',
]);

export interface InboundMediaFile {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface SocialAudioAttachment {
  type?: string;
  url?: string;
  mimeType?: string;
}

export function isAudioMime(value?: string | null): boolean {
  const mime = (value ?? '').toLowerCase();
  return (
    mime.startsWith('audio/') ||
    mime.includes('ogg') ||
    mime.includes('opus') ||
    mime.includes('mpeg') && mime.includes('audio')
  );
}

export function isAudioType(value?: string | null): boolean {
  const type = (value ?? '').trim().toLowerCase();
  if (!type) return false;
  if (AUDIO_TYPES.has(type)) return true;
  return type.includes('audio') || type.includes('voice') || type === 'ptt';
}

export function isWahaAudioPayload(payload: Record<string, unknown>): boolean {
  const media = asRecord(payload.media);
  const data = asRecord(payload._data);
  const type =
    stringOf(payload.type) ??
    stringOf(data?.type) ??
    stringOf(data?.mimetype);
  const mime =
    stringOf(media?.mimetype) ??
    stringOf(payload.mimetype) ??
    stringOf(data?.mimetype);
  if (isAudioType(type) || isAudioMime(mime)) return true;
  return false;
}

export function extractWahaMedia(
  payload: Record<string, unknown>,
): { url?: string; mimetype?: string; filename?: string } {
  const media = asRecord(payload.media);
  const data = asRecord(payload._data);
  return {
    url:
      stringOf(media?.url) ??
      stringOf(payload.mediaUrl) ??
      stringOf(data?.url) ??
      stringOf(data?.mediaUrl),
    mimetype:
      stringOf(media?.mimetype) ??
      stringOf(payload.mimetype) ??
      stringOf(data?.mimetype),
    filename:
      stringOf(media?.filename) ??
      stringOf(payload.filename) ??
      stringOf(data?.filename),
  };
}

export function rewriteWahaFileUrl(
  mediaUrl: string,
  wahaBaseUrl: string,
): string {
  const base = wahaBaseUrl.replace(/\/$/, '');
  try {
    const parsed = new URL(mediaUrl, `${base}/`);
    if (
      parsed.pathname.startsWith('/api/files') ||
      parsed.pathname.includes('/files/')
    ) {
      return `${base}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    if (mediaUrl.startsWith('/')) return `${base}${mediaUrl}`;
    return mediaUrl;
  }
}

export function isAudioAttachment(attachment: SocialAudioAttachment): boolean {
  return isAudioType(attachment.type) || isAudioMime(attachment.mimeType);
}

export function extractAttachmentUrl(
  attachment: Record<string, unknown>,
): SocialAudioAttachment {
  const nested =
    asRecord(attachment.payload) ??
    asRecord(attachment.media) ??
    asRecord(attachment.file);
  return {
    type: stringOf(attachment.type) ?? stringOf(nested?.type),
    mimeType:
      stringOf(attachment.mimeType) ??
      stringOf(attachment.mimetype) ??
      stringOf(nested?.mimeType) ??
      stringOf(nested?.mimetype),
    url:
      stringOf(attachment.url) ??
      stringOf(attachment.mediaUrl) ??
      stringOf(attachment.src) ??
      stringOf(attachment.href) ??
      stringOf(nested?.url) ??
      stringOf(nested?.mediaUrl),
  };
}

export function parseAttachments(value: unknown): SocialAudioAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (asRecord(item) ? extractAttachmentUrl(item) : null))
    .filter((item): item is SocialAudioAttachment => Boolean(item));
}

export function isPlaceholderCaption(text?: string | null): boolean {
  const value = (text ?? '').trim();
  return (
    !value ||
    value === '[Adjunto]' ||
    value === '[Media]' ||
    value === '[Contacto]' ||
    value === AUDIO_PREFIX ||
    value === AUDIO_UNTRANSCRIBED
  );
}

export function formatVoiceMessage(input: {
  transcript?: string | null;
  caption?: string | null;
}): string {
  const spoken = input.transcript?.trim() || '';
  const caption = isPlaceholderCaption(input.caption)
    ? ''
    : (input.caption ?? '').trim();
  if (spoken && caption) return `${caption}\n${AUDIO_PREFIX} ${spoken}`;
  if (spoken) return `${AUDIO_PREFIX} ${spoken}`;
  if (caption) return caption;
  return AUDIO_UNTRANSCRIBED;
}

export function transcriptionLanguage(language?: string | null): string | undefined {
  const code = (language ?? '').trim().toLowerCase().slice(0, 2);
  if (code.length === 2) return code;
  return undefined;
}

export function filenameForMime(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'voice.mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'voice.m4a';
  if (mimeType.includes('wav')) return 'voice.wav';
  if (mimeType.includes('webm')) return 'voice.webm';
  return 'voice.ogg';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
