import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetchMock = vi.fn();
vi.mock('../../utils/safeFetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => safeFetchMock(url, init),
}));

vi.mock('../../services/electronService', () => ({
  electronService: {
    isElectron: () => false,  // 强制走 Blob URL 分支，避免触达 storage 路径
    getStoragePath: vi.fn(),
    fs: { mkdir: vi.fn(), writeFileBuffer: vi.fn() },
  },
}));

// URL.createObjectURL / blob polyfill
if (typeof URL.createObjectURL !== 'function') {
  (URL as any).createObjectURL = () => 'blob:test';
}

import { OpenAITTSProvider } from './OpenAITTSProvider';

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe('OpenAITTSProvider · ChannelAuth', () => {
  it('profileId 存在 → 走 x-koma-channel-id 代理，不发明文 Authorization', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(new Blob(['mp3']), { status: 200 }));

    const provider = new OpenAITTSProvider({
      provider: 'openai-tts',
      profileId: 'ch-oai',
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'tts-1',
    } as any);

    await provider.start({ text: '你好', voiceId: 'alloy' } as any);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-koma-channel-id']).toBe('ch-oai');
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('tts-1');
    expect(body.voice).toBe('alloy');
  });

  it('回退：无 profileId + apiKey → 明文 Bearer', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(new Blob(['mp3']), { status: 200 }));

    const provider = new OpenAITTSProvider({
      provider: 'openai-tts',
      apiKey: 'sk-oai',
      modelName: 'tts-1',
    } as any);

    await provider.start({ text: 'x', voiceId: 'echo' } as any);
    const [, init] = safeFetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-oai');
  });

  it('validate: profileId || apiKey && modelName', () => {
    const make = (c: any) => new OpenAITTSProvider(c).validate();
    expect(make({ provider: 'openai-tts', profileId: 'x', modelName: 'tts-1' })).toBe(true);
    expect(make({ provider: 'openai-tts', apiKey: 'k', modelName: 'tts-1' })).toBe(true);
    expect(make({ provider: 'openai-tts', profileId: 'x' })).toBe(false);
    expect(make({ provider: 'openai-tts', modelName: 'tts-1' })).toBe(false);
  });

  it('start 缺凭据抛错', async () => {
    const provider = new OpenAITTSProvider({
      provider: 'openai-tts',
      modelName: 'tts-1',
    } as any);
    await expect(provider.start({ text: 'x', voiceId: 'alloy' } as any))
      .rejects.toThrowError(/OpenAI API Key 未配置/);
  });

  it('401 channel_api_key_missing → 抛友好错误', async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'channel_api_key_missing', message: 'no key' } }),
      { status: 401 },
    ));
    const provider = new OpenAITTSProvider({
      provider: 'openai-tts',
      profileId: 'ch-oai',
      modelName: 'tts-1',
    } as any);
    await expect(provider.start({ text: 'x', voiceId: 'alloy' } as any))
      .rejects.toThrowError(/OpenAI TTS 合成失败/);
  });
});
