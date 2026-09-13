import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/safeFetch', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from '../utils/safeFetch';
import { OpenAIVideoITVProvider } from './itv/OpenAIVideoITVProvider';
import { OpenAICompatibleTTIProvider } from './tti/OpenAICompatibleTTIProvider';
import type { ITVRequest } from '../types';

const ref = { transport: 'remote-url' as const, value: 'https://example.com/image.png' };
const video = () => new OpenAIVideoITVProvider({ provider: 'openai-video', modelName: 'agnes-video-2.5-flash',
  apiKey: 'test', baseUrl: 'https://api.agnes-ai.cn/v1/', defaultDuration: 20 });
describe('Agnes media protocol', () => {
  beforeEach(() => vi.mocked(safeFetch).mockReset());
  it('sends image references in extra_body without duplicating v1', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://example.com/out.png' }] })));
    const provider = new OpenAICompatibleTTIProvider({ provider: 'openai-compatible-tti',
      modelName: 'agnes-image-2.5-flash', apiKey: 'test', baseUrl: 'https://api.agnes-ai.cn/v1/' } as any);
    await provider.start({ prompt: 'test', references: [ref], options: { aspectRatio: '16:9', imageSize: '2K' } });
    const [url, init] = vi.mocked(safeFetch).mock.calls[0];
    expect(url).toBe('https://api.agnes-ai.cn/v1/images/generations');
    expect(JSON.parse(init?.body as string)).toMatchObject({ size: '2K', ratio: '16:9', extra_body: { image: [ref.value], response_format: 'url' } });
    expect(JSON.parse(init?.body as string)).not.toHaveProperty('image_urls');
  });
  it.each([
    [{ capability: 'video.text-to-video', prompt: 'test' }, 'text'],
    [{ capability: 'video.image-to-video', prompt: 'test', primaryImage: ref }, 'keyframe'],
    [{ capability: 'video.start-end-to-video', prompt: 'test', startFrame: ref, endFrame: ref }, 'keyframe'],
    [{ capability: 'video.reference-to-video', prompt: '@Image 1', referenceImages: [ref] }, 'reference'],
  ] as const)('maps video mode %s', async (request, mode) => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(JSON.stringify({ id: 'task-other', video_id: 'video-1' })));
    expect(await video().start(request as ITVRequest)).toEqual({ mode: 'async', taskId: 'video-1' });
    const [url, init] = vi.mocked(safeFetch).mock.calls[0];
    expect(url).toBe('https://api.agnes-ai.cn/v1/videos');
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({ mode, size: '720P', seconds: '12' });
    expect(body).not.toHaveProperty('metadata');
    if (mode === 'reference') expect(body).toMatchObject({ images: [ref.value], prompt: '<Picture 1>' });
    if (mode === 'keyframe') expect(body.first_frame).toBe(ref.value);
  });
  it('rejects more than five references before sending a request', async () => {
    await expect(video().start({ capability: 'video.reference-to-video', prompt: 'test', referenceImages: Array(6).fill(ref) })).rejects.toThrow('1–5');
    expect(safeFetch).not.toHaveBeenCalled();
  });
  it('polls video_id with model_name and reads the completed URL', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(JSON.stringify({ status: 'completed', video_url: 'https://example.com/out.mp4' })));
    expect(await video().getTaskSnapshot('video-1')).toMatchObject({ state: 'succeeded', output: { source: 'https://example.com/out.mp4' } });
    expect(vi.mocked(safeFetch).mock.calls[0][0]).toBe('https://api.agnes-ai.cn/agnesapi?video_id=video-1&model_name=agnes-video-2.5-flash');
  });
});
