import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../utils/safeFetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => safeFetchMock(url, init),
}));

vi.mock('../../services/electronService', () => ({
  electronService: {
    isElectron: () => false,
    app: { getPath: vi.fn() },
    fs: { downloadFile: vi.fn(), readFileAsBase64: vi.fn(), remove: vi.fn() },
  },
}));

import { GeminiNativeTTIProvider } from './GeminiNativeTTIProvider';

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe('GeminiNativeTTIProvider · query-key ChannelAuth', () => {
  it('profileId 存在 → header 带 x-koma-channel-id + x-koma-channel-query-key-name', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }],
    }), { status: 200 }));

    const provider = new GeminiNativeTTIProvider({
      provider: 'gemini-native-tti',
      profileId: 'ch-g',
      baseUrl: 'https://example.com',
      modelName: 'gemini-2.5-flash',
    } as any);

    await provider.start({ prompt: 'a cat' } as any);
    const [url, init] = safeFetchMock.mock.calls[0];
    // URL 不应包含 ?key=（由主进程 query-key 代理注入）
    expect(url).not.toContain('?key=');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-koma-channel-id']).toBe('ch-g');
    expect(headers['x-koma-channel-query-key-name']).toBe('key');
  });

  it('回退：无 profileId + apiKey → URL 拼上 ?key=<apiKey>', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }],
    }), { status: 200 }));

    const provider = new GeminiNativeTTIProvider({
      provider: 'gemini-native-tti',
      apiKey: 'sk-g',
      baseUrl: 'https://example.com',
      modelName: 'gemini-2.5-flash',
    } as any);

    await provider.start({ prompt: 'a cat' } as any);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get('key')).toBe('sk-g');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-koma-channel-id']).toBeUndefined();
  });

  it('validate: profileId || apiKey && modelName', () => {
    const make = (c: any) => new GeminiNativeTTIProvider(c).validate();
    expect(make({ provider: 'gemini-native-tti', profileId: 'x', modelName: 'm' })).toBe(true);
    expect(make({ provider: 'gemini-native-tti', apiKey: 'k', modelName: 'm' })).toBe(true);
    expect(make({ provider: 'gemini-native-tti', profileId: 'x' })).toBe(false);
    expect(make({ provider: 'gemini-native-tti', modelName: 'm' })).toBe(false);
  });

  it('401 channel_api_key_missing → 抛 ChannelNetError', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'channel_api_key_missing', message: 'no key' } }),
      { status: 401 },
    ));
    const provider = new GeminiNativeTTIProvider({
      provider: 'gemini-native-tti',
      profileId: 'ch-g',
      baseUrl: 'https://example.com',
      modelName: 'gemini-2.5-flash',
    } as any);
    await expect(provider.start({ prompt: 'x' } as any)).rejects.toThrowError(/Gemini 生图请求失败/);
  });
});
