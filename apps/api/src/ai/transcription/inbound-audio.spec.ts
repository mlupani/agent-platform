import {
  AUDIO_UNTRANSCRIBED,
  formatVoiceMessage,
  isAudioAttachment,
  isWahaAudioPayload,
  rewriteWahaFileUrl,
  transcriptionLanguage,
} from './inbound-audio';

describe('inbound-audio', () => {
  it('detects WhatsApp voice notes', () => {
    expect(
      isWahaAudioPayload({
        type: 'ptt',
        hasMedia: true,
        media: { mimetype: 'audio/ogg; codecs=opus' },
      }),
    ).toBe(true);
    expect(
      isWahaAudioPayload({
        hasMedia: true,
        media: { mimetype: 'image/jpeg' },
      }),
    ).toBe(false);
  });

  it('formats transcript and caption', () => {
    expect(formatVoiceMessage({ transcript: 'Quiero un turno' })).toBe(
      '[Audio] Quiero un turno',
    );
    expect(
      formatVoiceMessage({
        transcript: 'Mañana a las 10',
        caption: 'Consulta',
      }),
    ).toBe('Consulta\n[Audio] Mañana a las 10');
    expect(formatVoiceMessage({ caption: '[Adjunto]' })).toBe(
      AUDIO_UNTRANSCRIBED,
    );
  });

  it('rewrites WAHA file URLs to the internal base', () => {
    expect(
      rewriteWahaFileUrl(
        'http://localhost:3000/api/files/msg.ogg',
        'http://waha:3000',
      ),
    ).toBe('http://waha:3000/api/files/msg.ogg');
  });

  it('detects Instagram audio attachments', () => {
    expect(isAudioAttachment({ type: 'audio', url: 'https://cdn/a.m4a' })).toBe(
      true,
    );
    expect(isAudioAttachment({ type: 'image', url: 'https://cdn/a.jpg' })).toBe(
      false,
    );
  });

  it('normalizes language to ISO-639-1', () => {
    expect(transcriptionLanguage('es-AR')).toBe('es');
    expect(transcriptionLanguage('')).toBeUndefined();
  });
});
