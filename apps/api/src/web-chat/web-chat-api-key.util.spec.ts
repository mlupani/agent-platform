import {
  generateWidgetApiKey,
  hashWidgetApiKey,
  widgetApiKeyPrefix,
  extractWidgetApiKey,
  originAllowed,
  widgetApiKeysEqual,
} from './web-chat-api-key.util';

describe('web-chat-api-key.util', () => {
  it('generates a prefixed key and stable hash', () => {
    const key = generateWidgetApiKey();
    expect(key.startsWith('nlw_')).toBe(true);
    expect(widgetApiKeyPrefix(key)).toBe(key.slice(0, 12));
    expect(hashWidgetApiKey(key)).toHaveLength(64);
    expect(hashWidgetApiKey(key)).toBe(hashWidgetApiKey(key));
    expect(
      widgetApiKeysEqual(hashWidgetApiKey(key), hashWidgetApiKey(key)),
    ).toBe(true);
  });

  it('reads the key from x-api-key or Bearer', () => {
    expect(extractWidgetApiKey({ 'x-api-key': ' nlw_abc ' })).toBe('nlw_abc');
    expect(extractWidgetApiKey({ authorization: 'Bearer nlw_xyz' })).toBe(
      'nlw_xyz',
    );
    expect(extractWidgetApiKey({})).toBeNull();
  });

  it('allows any origin when the list is empty', () => {
    expect(originAllowed('https://landing.test', [])).toBe(true);
    expect(originAllowed(undefined, [])).toBe(true);
  });

  it('restricts origin when a list is configured', () => {
    expect(
      originAllowed('https://landing.test', ['https://landing.test']),
    ).toBe(true);
    expect(originAllowed('https://other.test', ['https://landing.test'])).toBe(
      false,
    );
    expect(originAllowed(undefined, ['https://landing.test'])).toBe(false);
  });
});
