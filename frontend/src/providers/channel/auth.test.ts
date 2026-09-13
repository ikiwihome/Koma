import { describe, expect, it, vi, beforeEach } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../utils/safeFetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => safeFetchMock(url, init),
}));

import { buildChannelAuthRequest, fetchWithChannelAuth } from './auth';

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe('buildChannelAuthRequest', () => {
  it('bearer-header with channelId sets x-koma-channel-id and no Authorization', () => {
    const res = buildChannelAuthRequest({
      channelId: 'ch-1',
      mode: 'bearer-header',
    });
    expect(res.headers['x-koma-channel-id']).toBe('ch-1');
    expect(res.headers['Authorization']).toBeUndefined();
    expect(res.url('https://api.example.com/v1/x')).toBe('https://api.example.com/v1/x');
  });

  it('query-key with channelId adds query-key-name header and no query rewrite', () => {
    const res = buildChannelAuthRequest({
      channelId: 'ch-2',
      mode: 'query-key',
      queryKeyName: 'key',
    });
    expect(res.headers['x-koma-channel-id']).toBe('ch-2');
    expect(res.headers['x-koma-channel-query-key-name']).toBe('key');
    // channelId 路径下 URL 不加 query，由主进程处理
    expect(res.url('https://api.example.com/v1/x')).toBe('https://api.example.com/v1/x');
  });

  it('raw-authorization with channelId adds raw header', () => {
    const res = buildChannelAuthRequest({
      channelId: 'ch-3',
      mode: 'raw-authorization',
    });
    expect(res.headers['x-koma-channel-id']).toBe('ch-3');
    expect(res.headers['x-koma-channel-raw-authorization']).toBe('true');
  });

  it('fallback: channelId missing + apiKey present → Bearer header', () => {
    const res = buildChannelAuthRequest({
      apiKey: 'sk-xxx',
      mode: 'bearer-header',
    });
    expect(res.headers['Authorization']).toBe('Bearer sk-xxx');
    expect(res.headers['x-koma-channel-id']).toBeUndefined();
  });

  it('fallback: channelId missing + apiKey present + query-key → URL contains ?<name>=<key>', () => {
    const res = buildChannelAuthRequest({
      apiKey: 'sk-xxx',
      mode: 'query-key',
      queryKeyName: 'api_key',
    });
    const finalUrl = res.url('https://api.example.com/v1/x');
    expect(new URL(finalUrl).searchParams.get('api_key')).toBe('sk-xxx');
    expect(res.headers['Authorization']).toBeUndefined();
  });

  it('fallback: channelId missing + apiKey present + raw-auth → Authorization: <apiKey>', () => {
    const res = buildChannelAuthRequest({
      apiKey: 'sk-xxx',
      mode: 'raw-authorization',
    });
    expect(res.headers['Authorization']).toBe('sk-xxx');
  });

  it('refuses $ENC$ placeholder as usable apiKey', () => {
    expect(() => buildChannelAuthRequest({
      apiKey: '$ENC$',
      mode: 'bearer-header',
    })).toThrowError(/channel_api_key_missing/);
  });

  it('query-key without queryKeyName throws', () => {
    expect(() => buildChannelAuthRequest({
      channelId: 'ch-x',
      mode: 'query-key',
    })).toThrowError(/queryKeyName required/);
  });
});

describe('fetchWithChannelAuth', () => {
  it('merges user headers + auth headers and calls safeFetch', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await fetchWithChannelAuth('https://api.example.com/v1/x', {
      channelId: 'ch-1',
      mode: 'bearer-header',
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Trace': 't1' },
        body: JSON.stringify({ a: 1 }),
      },
    });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/x');
    expect(init.headers['x-koma-channel-id']).toBe('ch-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-Trace']).toBe('t1');
    expect(init.method).toBe('POST');
  });

  it('non-2xx → throws ChannelNetError with parsed code', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'channel_api_key_missing', message: 'no key' } }),
      { status: 401 },
    ));
    await expect(fetchWithChannelAuth('https://api.example.com/x', {
      channelId: 'ch-1',
      mode: 'bearer-header',
    })).rejects.toMatchObject({
      code: 'channel_api_key_missing',
      status: 401,
      channelId: 'ch-1',
      actionable: true,
    });
  });
});
