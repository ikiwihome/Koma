import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../utils/safeFetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => safeFetchMock(url, init),
}));

// URL.createObjectURL / blob polyfill for jsdom
if (typeof URL.createObjectURL !== 'function') {
  (URL as any).createObjectURL = () => 'blob:test';
}

import { FishAudioProvider } from './FishAudioProvider';

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe('FishAudioProvider · ChannelAuth', () => {
  it('profileId 存在 → 走 x-koma-channel-id 代理，不发明文 Authorization', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(new Blob(['abc']), { status: 200 }));
    const provider = new FishAudioProvider({
      provider: 'fish-audio',
      profileId: 'ch-1',
      baseUrl: 'https://api.fish.audio/v1',
    } as any);
    await provider.start({ text: 'hi', voiceId: 'v1' } as any);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe('https://api.fish.audio/v1/tts');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-koma-channel-id']).toBe('ch-1');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('回退：无 profileId + apiKey → 明文 Bearer', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(new Blob(['abc']), { status: 200 }));
    const provider = new FishAudioProvider({
      provider: 'fish-audio',
      apiKey: 'sk-fish',
    } as any);
    await provider.start({ text: 'hi', voiceId: 'v1' } as any);
    const [, init] = safeFetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-fish');
  });

  it('validate: 有 profileId 或 apiKey 即通过', () => {
    expect(new FishAudioProvider({ provider: 'fish-audio', profileId: 'x' } as any).validate()).toBe(true);
    expect(new FishAudioProvider({ provider: 'fish-audio', apiKey: 'sk' } as any).validate()).toBe(true);
    expect(new FishAudioProvider({ provider: 'fish-audio' } as any).validate()).toBe(false);
  });

  it('非 2xx → 抛 ChannelNetError 并被 catch 成友好错误', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'channel_api_key_missing', message: 'no key' } }),
      { status: 401 },
    ));
    const provider = new FishAudioProvider({
      provider: 'fish-audio',
      profileId: 'ch-1',
    } as any);
    await expect(provider.start({ text: 'hi', voiceId: 'v1' } as any))
      .rejects.toThrowError(/Fish Audio 合成失败/);
  });
});
