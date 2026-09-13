import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Grok2ApiImagineTTIProvider } from './Grok2ApiImagineTTIProvider';

vi.mock('../../utils/safeFetch', () => {
  return {
    safeFetch: vi.fn(),
  };
});

import { safeFetch } from '../../utils/safeFetch';

describe('Grok2ApiImagineTTIProvider', () => {
  beforeEach(() => {
    (safeFetch as any).mockReset();
  });

  it('uses /v1/images/generations when no references exist and forwards batch n=9', async () => {
    const imageUrls = Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/${index + 1}.jpg`);
    (safeFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: imageUrls.map(url => ({ url })),
      }),
    });

    const p = new Grok2ApiImagineTTIProvider({
      id: 'c1',
      name: 'grok2',
      provider: 'grok2api-imagine-tti' as any,
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: 'k',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: 'grok-imagine-1.0',
    } as any);

    const result = await p.start({ prompt: 'p', count: 9, references: [] } as any);
    expect((safeFetch as any).mock.calls[0][0]).toContain('/v1/images/generations');
    const init = (safeFetch as any).mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.n).toBe(9);
    expect(result.mode).toBe('immediate');
    expect((result as any).output.url).toBe(imageUrls[0]);
    expect((result as any).output.metadata?.batchImages).toHaveLength(9);
  });

  it('uses /v1/chat/completions when references exist (JSON body) and forwards image_config.n=9', async () => {
    const imageUrls = Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/chat-${index + 1}.png`);
    (safeFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: `ok ${imageUrls.map((url, index) => `![img-${index + 1}](${url})`).join(' ')}`,
          },
        }],
      }),
    });

    const p = new Grok2ApiImagineTTIProvider({
      id: 'c1',
      name: 'grok2',
      provider: 'grok2api-imagine-tti' as any,
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: 'k',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: 'grok-imagine-1.0-edit',
    } as any);

    const result = await p.start({
      prompt: 'p',
      count: 9,
      references: [
        { transport: 'data-url', value: 'data:image/png;base64,AAAA' },
      ],
    } as any);

    expect((safeFetch as any).mock.calls[0][0]).toContain('/v1/chat/completions');
    const init = (safeFetch as any).mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.messages[0].content[0].type).toBe('text');
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.image_config.n).toBe(9);
    expect(result.mode).toBe('immediate');
    expect((result as any).output.url).toBe(imageUrls[0]);
    expect((result as any).output.metadata?.batchImages).toHaveLength(9);
  });

  it('extracts url from non-standard response shape (deep scan)', async () => {
    (safeFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: [{ type: 'text', text: 'done' }] } }],
        data: [{ url: '/outputs/abc.png' }],
      }),
    });

    const p = new Grok2ApiImagineTTIProvider({
      id: 'c1',
      name: 'grok2',
      provider: 'grok2api-imagine-tti' as any,
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: 'k',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: 'grok-imagine-1.0-edit',
    } as any);

    const result = await p.start({
      prompt: 'p',
      references: [
        { transport: 'data-url', value: 'data:image/png;base64,AAAA' },
      ],
    } as any);

    expect((result as any).output.url).toBe('http://127.0.0.1:8000/outputs/abc.png');
  });

  it('maps request aspectRatio to generation size and falls back to channel defaultSize', async () => {
    (safeFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: 'https://cdn.example.com/portrait.jpg' }] }),
    }).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ url: 'https://cdn.example.com/default.jpg' }] }),
    });

    const p = new Grok2ApiImagineTTIProvider({
      id: 'c1',
      name: 'grok2',
      provider: 'grok2api-imagine-tti' as any,
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: 'k',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelName: 'grok-imagine-1.0',
      defaultSize: '720x1280',
    } as any);

    await p.start({ prompt: 'p', references: [], options: { aspectRatio: '9:16' } } as any);
    await p.start({ prompt: 'p', references: [] } as any);

    const firstBody = JSON.parse((safeFetch as any).mock.calls[0][1].body);
    const secondBody = JSON.parse((safeFetch as any).mock.calls[1][1].body);
    // 上游 grok2api/openai/router.py _ALLOWED_SIZES 只接受 1280x720 / 720x1280 / 1024x1024 等 HD 档；
    // 9:16 → 720x1280，没显式 aspectRatio 时退到渠道 defaultSize（这里是 720x1280，本身就是 HD 允许档）。
    expect(firstBody.size).toBe('720x1280');
    expect(secondBody.size).toBe('720x1280');
    // aspect_ratio 字段不再写入 — 上游 ImageConfig 只有 size 字段，多传也是被 extra=ignore 忽略
    expect(firstBody.aspect_ratio).toBeUndefined();
    expect(secondBody.aspect_ratio).toBeUndefined();
  });

});
