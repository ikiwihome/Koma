import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Grok2ApiImagineITVProvider } from './Grok2ApiImagineITVProvider';
import { safeFetch } from '../../utils/safeFetch';

vi.mock('../../utils/safeFetch', () => ({
  safeFetch: vi.fn(),
}));

function createProvider(overrides: Record<string, unknown> = {}) {
  return new Grok2ApiImagineITVProvider({
    id: 'i1',
    name: 'grok2v',
    provider: 'grok2api-imagine-itv' as any,
    baseUrl: 'http://127.0.0.1:8000',
    apiKey: 'k',
    isDefault: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    modelName: 'grok-imagine-video',
    defaultDuration: 6,
    defaultResolution: '720p',
    ...overrides,
  } as any);
}

function mockCreateResponse(value: Record<string, unknown>) {
  (safeFetch as any).mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value),
  });
}

function firstRequestBody(): Record<string, any> {
  return JSON.parse((safeFetch as any).mock.calls[0][1].body as string);
}

function expectImageReferences(body: Record<string, any>, expectedUrls: string[]) {
  expect(body.images).toBeUndefined();
  expect(body.metadata).toBeUndefined();
  expect(body.input_reference).toBeUndefined();
  expect(body.image_reference).toHaveLength(expectedUrls.length);

  expectedUrls.forEach((expectedUrl, index) => {
    const reference = body.image_reference[index];
    expect(reference.type).toBe('image_url');
    const actualUrl = String(reference.image_url?.url || '');
    const sep = expectedUrl.includes('?') ? '&' : '?';
    expect(actualUrl.startsWith(`${expectedUrl}${sep}_r=`)).toBe(true);
  });
}

describe('Grok2ApiImagineITVProvider', () => {
  beforeEach(() => {
    (safeFetch as any).mockReset();
  });

  it('calls /v1/videos with plugin-compatible image_reference payload', async () => {
    mockCreateResponse({ id: 'task-1', status: 'queued' });

    const p = createProvider();

    const res = await p.start({
      capability: 'video.image-to-video',
      prompt: 'p',
      primaryImage: { transport: 'remote-url', value: 'https://img.example.com/1.jpg' },
      additionalReferences: [
        { transport: 'remote-url', value: 'https://img.example.com/2.jpg' },
      ],
      options: { duration: 6, aspectRatio: '16:9', resolution: '720p' },
    } as any);

    expect((safeFetch as any).mock.calls[0][0]).toContain('/v1/videos');
    const init = (safeFetch as any).mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('grok-imagine-video');
    expect(body.prompt).toBe('p');
    expect(body.size).toBe('1280x720');
    expect(body.seconds).toBe('6');
    expect(body.quality).toBe('high');
    expectImageReferences(body, [
      'https://img.example.com/1.jpg',
      'https://img.example.com/2.jpg',
    ]);
    expect(res).toEqual({ mode: 'async', taskId: 'task-1' });
  });

  it('Grok wire prompt preserves @Image N placeholders', async () => {
    mockCreateResponse({ id: 'task-ref-placeholders' });

    const p = createProvider();

    await p.start({
      capability: 'video.reference-to-video',
      prompt: '让 @Image 1 中的人物参考 @Image 2 的动作，旧写法 @图片3 也要稳定',
      referenceImages: [
        { transport: 'remote-url', value: 'https://img.example.com/1.jpg' },
        { transport: 'remote-url', value: 'https://img.example.com/2.jpg' },
        { transport: 'remote-url', value: 'https://img.example.com/3.jpg' },
      ],
      options: { duration: 6, aspectRatio: '16:9', resolution: '720p' },
    } as any);

    const body = firstRequestBody();
    expect(body.prompt).toBe('让 @Image 1 中的人物参考 @Image 2 的动作，旧写法 @Image 3 也要稳定');
    expectImageReferences(body, [
      'https://img.example.com/1.jpg',
      'https://img.example.com/2.jpg',
      'https://img.example.com/3.jpg',
    ]);
  });

  it('custom Grok baseUrl sends multi-reference image_reference and preserves @Image placeholders', async () => {
    mockCreateResponse({ id: 'task-custom-ref' });

    const p = createProvider({
      id: 'i-custom',
      name: 'Koma官方 Grok 自定义域名',
      baseUrl: 'https://www.kopi11.cn',
      isDefault: false,
      modelName: 'grok-imagine-1.0-video',
      defaultDuration: 20,
      defaultResolution: '1280x720',
    });

    await p.start({
      capability: 'video.reference-to-video',
      prompt: '@Image 1 是场景，@Image 2 我 与 @Image 3 小白 对峙，@Image 4 红烧肉 和 @Image 5 字典 在桌面。',
      referenceImages: [
        { transport: 'remote-url', value: 'https://cdn.example.com/scene.jpg' },
        { transport: 'remote-url', value: 'https://cdn.example.com/me.jpg' },
        { transport: 'remote-url', value: 'https://cdn.example.com/xiaobai.jpg' },
        { transport: 'remote-url', value: 'https://cdn.example.com/meat.jpg' },
        { transport: 'remote-url', value: 'https://cdn.example.com/dictionary.jpg' },
      ],
      options: { duration: 20, aspectRatio: '16:9', resolution: '1280x720' },
    } as any);

    expect((safeFetch as any).mock.calls[0][0]).toBe('https://www.kopi11.cn/v1/videos');
    const body = firstRequestBody();
    expect(body.prompt).toBe('@Image 1 是场景，@Image 2 我 与 @Image 3 小白 对峙，@Image 4 红烧肉 和 @Image 5 字典 在桌面。');
    expect(body.quality).toBe('high');
    expectImageReferences(body, [
      'https://cdn.example.com/scene.jpg',
      'https://cdn.example.com/me.jpg',
      'https://cdn.example.com/xiaobai.jpg',
      'https://cdn.example.com/meat.jpg',
      'https://cdn.example.com/dictionary.jpg',
    ]);
  });

  it('passes reference-to-video referenceImages through image_reference and caps at 7', async () => {
    mockCreateResponse({ id: 'task-ref-cap' });

    const p = createProvider();
    const refs = Array.from({ length: 9 }, (_, i) => ({
      transport: 'remote-url' as const,
      value: `https://img.example.com/ref-${i}.jpg`,
    }));

    await p.start({
      capability: 'video.reference-to-video',
      prompt: 'p',
      referenceImages: refs,
      options: { duration: 10, aspectRatio: '9:16' },
    } as any);

    const body = firstRequestBody();
    expectImageReferences(body, refs.slice(0, 7).map(ref => ref.value));
  });

  it('supports text-to-video without image references', async () => {
    mockCreateResponse({ id: 'task-text' });

    const p = createProvider();

    const res = await p.start({
      capability: 'video.text-to-video',
      prompt: 'A calico cat playing a piano on stage',
      options: { duration: 12, aspectRatio: '9:16', resolution: '720p' },
    } as any);

    const body = firstRequestBody();
    expect(body.model).toBe('grok-imagine-video');
    expect(body.prompt).toBe('A calico cat playing a piano on stage');
    expect(body.size).toBe('720x1280');
    expect(body.seconds).toBe('12');
    expect(body.quality).toBe('high');
    expect(body.input_reference).toBeUndefined();
    expect(body.images).toBeUndefined();
    expect(body.image_reference).toBeUndefined();
    expect(body.metadata).toBeUndefined();
    expect(res).toEqual({ mode: 'async', taskId: 'task-text' });
  });

  it('extracts immediate video url but avoids preview images', async () => {
    mockCreateResponse({
      preview_image: 'http://x/y/preview_image.jpg',
      video_url: 'http://x/y/out.mp4',
    });

    const p = createProvider();

    const res = await p.start({
      capability: 'video.image-to-video',
      prompt: 'p',
      primaryImage: { transport: 'remote-url', value: 'https://img.example.com/1.jpg' },
      additionalReferences: [],
      options: {},
    } as any);

    expect((res as any).output.source).toBe('http://x/y/out.mp4');
  });

  it('prefers request aspectRatio over channel defaultResolution and normalizes short duration to whitelist', async () => {
    mockCreateResponse({ id: 'task-portrait' });

    const p = createProvider();

    await p.start({
      capability: 'video.reference-to-video',
      prompt: 'p',
      referenceImages: [{ transport: 'remote-url', value: 'https://img.example.com/1.jpg' }],
      options: { duration: 4, aspectRatio: '9:16' },
    } as any);

    const body = firstRequestBody();
    expect(body.seconds).toBe('6');
    expect(body.size).toBe('720x1280');
    expect(body.quality).toBe('high');
  });

  it('normalizes legacy illegal duration inputs before submitting seconds', async () => {
    mockCreateResponse({ id: 'task-duration-normalized' });

    const p = createProvider();

    await p.start({
      capability: 'video.image-to-video',
      prompt: 'p',
      primaryImage: { transport: 'remote-url', value: 'https://img.example.com/1.jpg' },
      additionalReferences: [],
      options: { duration: 15 },
    } as any);

    const body = firstRequestBody();
    expect(body.seconds).toBe('16');
  });

  it('falls back to default 10 seconds when duration is missing or invalid', async () => {
    mockCreateResponse({ id: 'task-duration-default' });

    const p = createProvider({ defaultResolution: undefined });

    await p.start({
      capability: 'video.text-to-video',
      prompt: 'p',
      options: { duration: Number.NaN },
    } as any);

    const body = firstRequestBody();
    expect(body.seconds).toBe('10');
    expect(body.quality).toBe('high');
  });

  it('keeps built-in Grok model name unchanged', async () => {
    mockCreateResponse({ id: 'task-original-model' });

    const p = createProvider({ modelName: 'grok-imagine-video' });

    await p.start({
      capability: 'video.image-to-video',
      prompt: 'p',
      primaryImage: { transport: 'remote-url', value: 'https://img.example.com/1.jpg' },
      additionalReferences: [],
      options: { duration: 6 },
    } as any);

    const body = firstRequestBody();
    expect(body.model).toBe('grok-imagine-video');
  });

  it('polls /v1/videos/{taskId} and extracts completed video url', async () => {
    mockCreateResponse({ status: 'completed', progress: 100, video_url: '/files/video?id=1' });

    const p = createProvider();
    const snapshot = await p.getTaskSnapshot('task-1');

    expect((safeFetch as any).mock.calls[0][0]).toBe('http://127.0.0.1:8000/v1/videos/task-1');
    expect(snapshot).toEqual({
      state: 'succeeded',
      progress: 100,
      output: { source: 'http://127.0.0.1:8000/files/video?id=1' },
    });
  });

  it('uses /content endpoint when completed task has no video url', async () => {
    mockCreateResponse({ status: 'completed', progress: 100 });

    const p = createProvider();
    const snapshot = await p.getTaskSnapshot('task-1');

    expect(snapshot).toEqual({
      state: 'succeeded',
      progress: 100,
      output: { source: 'http://127.0.0.1:8000/v1/videos/task-1/content', taskId: 'task-1' },
    });
  });
});
