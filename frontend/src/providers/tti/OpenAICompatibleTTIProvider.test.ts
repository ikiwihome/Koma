import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleTTIProvider } from './OpenAICompatibleTTIProvider';

vi.mock('../../utils/safeFetch', () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from '../../utils/safeFetch';

describe('OpenAICompatibleTTIProvider', () => {
  beforeEach(() => {
    (safeFetch as any).mockReset();
  });

  it('forwards batch count=9 and exposes batchImages for synchronous generations', async () => {
    const imageUrls = Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/openai-${index + 1}.png`);
    (safeFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: imageUrls.map(url => ({ url })),
      }),
    });

    const provider = new OpenAICompatibleTTIProvider({
      id: 'c1',
      name: 'openai-compatible',
      provider: 'openai-compatible-tti' as any,
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: 'image-model',
    } as any);

    const result = await provider.start({ prompt: 'p', count: 9 } as any);

    const body = JSON.parse((safeFetch as any).mock.calls[0][1].body);
    expect(body.n).toBe(9);
    expect(result).toEqual(expect.objectContaining({
      mode: 'immediate',
      output: expect.objectContaining({
        url: imageUrls[0],
        metadata: expect.objectContaining({
          batchImages: expect.arrayContaining([
            expect.objectContaining({ url: imageUrls[0] }),
            expect.objectContaining({ url: imageUrls[8] }),
          ]),
        }),
      }),
    }));
    expect((result as any).output.metadata?.batchImages).toHaveLength(9);
  });

  it('sends OpenAI-compatible size as WxH instead of raw aspectRatio', async () => {
    (safeFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/square.png' }] }),
    });

    const provider = new OpenAICompatibleTTIProvider({
      id: 'c1',
      name: 'openai-compatible',
      provider: 'openai-compatible-tti' as any,
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: 'image-model',
      defaultSize: '720x1280',
    } as any);

    await provider.start({ prompt: 'p', options: { aspectRatio: '1:1' } } as any);

    const body = JSON.parse((safeFetch as any).mock.calls[0][1].body);
    expect(body.size).toBe('1024x1024');
  });

});
