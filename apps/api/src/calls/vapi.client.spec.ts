import { VapiClient } from './vapi.client';

describe('VapiClient', () => {
  const client = new VapiClient();
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('listPhoneNumbers mapea la respuesta de Vapi', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 'pn_1', number: '+5491100000000', name: 'Principal', provider: 'twilio' },
      ],
    });

    const result = await client.listPhoneNumbers('key');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vapi.ai/phone-number',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      }),
    );
    expect(result).toEqual([
      { id: 'pn_1', number: '+5491100000000', name: 'Principal', provider: 'twilio' },
    ]);
  });

  it('updatePhoneNumber hace PATCH con el body dado', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await client.updatePhoneNumber('key', 'pn_1', { assistantId: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vapi.ai/phone-number/pn_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ assistantId: null });
  });

  it('getPhoneNumber + updatePhoneNumber conservan el discriminador provider', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'pn_1', provider: 'twilio', number: '+5491100000000' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const remote = await client.getPhoneNumber('key', 'pn_1');
    await client.updatePhoneNumber('key', 'pn_1', {
      provider: remote.provider,
      assistantId: null,
      squadId: null,
      server: { url: 'https://api.x.com/api/webhooks/vapi', secret: 's' },
    });

    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe('https://api.vapi.ai/phone-number/pn_1');
    expect(getInit.method).toBe('GET');

    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe('https://api.vapi.ai/phone-number/pn_1');
    expect(patchInit.method).toBe('PATCH');
    // El PATCH de /phone-number es una unión discriminada por `provider`.
    expect(JSON.parse(patchInit.body)).toMatchObject({
      provider: 'twilio',
      assistantId: null,
      squadId: null,
    });
  });

  it('lanza error legible si Vapi responde no-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(client.listPhoneNumbers('bad')).rejects.toThrow(/Vapi.*401/);
  });
});
