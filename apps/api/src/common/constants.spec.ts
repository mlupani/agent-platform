import { channelTypes } from './constants';

describe('constants', () => {
  it('incluye VOICE como canal de conversación', () => {
    expect(channelTypes).toContain('VOICE');
  });
});
