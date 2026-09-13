import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIVideoITVProvider, flattenUpstreamErrorBody } from './OpenAIVideoITVProvider';
import type { ITVConfig, ITVRequest } from '../../types';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeJsonResponse(payload: unknown, status = 200): Response {
  const body = JSON.stringify(payload);
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

function makeConfig(overrides: Partial<ITVConfig> = {}): ITVConfig {
  return {
    provider: 'openai-video',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    modelName: 'sora-2',
    defaultDuration: 8,
    modelDefaults: { durationMin: 4, durationMax: 20, durationStep: 1, defaultDuration: 8 },
    ...overrides,
  };
}

describe('OpenAIVideoITVProvider', () => {
  it('POSTs OpenAI 标准 /v1/videos with seconds 字符串', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-1', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const request: ITVRequest = {
      capability: 'video.text-to-video',
      prompt: '一只猫',
      options: { duration: 6, aspectRatio: '16:9' },
    };

    const result = await provider.start(request);
    expect(result.mode).toBe('async');
    if (result.mode === 'async') {
      expect(result.taskId).toBe('task-1');
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.example.com/v1/videos');
    expect(calledInit?.method).toBe('POST');
    const body = JSON.parse(calledInit?.body as string);
    expect(body.model).toBe('sora-2');
    expect(body.prompt).toBe('一只猫');
    expect(body.seconds).toBe('6');
  });

  it('image-to-video 把 primaryImage URL 放进 image 字段', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-2', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const request: ITVRequest = {
      capability: 'video.image-to-video',
      prompt: '让画里的猫开始跑',
      primaryImage: { transport: 'remote-url', value: 'https://cdn.example.com/cat.png' },
      options: { duration: 5 },
    };

    await provider.start(request);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.image).toBe('https://cdn.example.com/cat.png');
    expect(body.seconds).toBe('5');
  });

  it('image-to-video 若 prompt 使用 @Image 占位符，则 images 数组包含主图和附加参考图', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-2b', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const request: ITVRequest = {
      capability: 'video.image-to-video',
      prompt: '让 @Image 1 中的人物参考 @Image 2 的服装动作',
      primaryImage: { transport: 'remote-url', value: 'https://cdn.example.com/shot.png' },
      additionalReferences: [
        { transport: 'remote-url', value: 'https://cdn.example.com/ref.png' },
      ],
      options: { duration: 5 },
    };

    await provider.start(request);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.image).toBe('https://cdn.example.com/shot.png');
    expect(body.images).toEqual([
      'https://cdn.example.com/shot.png',
      'https://cdn.example.com/ref.png',
    ]);
  });

  it('reference-to-video 把多张图放进 images 数组', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-ref', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const request: ITVRequest = {
      capability: 'video.reference-to-video',
      prompt: '动漫风格教室场景',
      referenceImages: [
        { transport: 'remote-url', value: 'https://cdn.example.com/room.png' },
        { transport: 'remote-url', value: 'https://cdn.example.com/char.png' },
      ],
      options: { duration: 8 },
    };

    await provider.start(request);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.images).toEqual([
      'https://cdn.example.com/room.png',
      'https://cdn.example.com/char.png',
    ]);
    expect(body.image).toBeUndefined();
  });

  it('start-end-to-video 把 endFrame 放进 metadata.end_frame_url', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-se', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const request: ITVRequest = {
      capability: 'video.start-end-to-video',
      prompt: '从白天到夜晚',
      startFrame: { transport: 'remote-url', value: 'https://cdn.example.com/start.png' },
      endFrame: { transport: 'remote-url', value: 'https://cdn.example.com/end.png' },
      options: { duration: 6 },
    };

    await provider.start(request);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.image).toBe('https://cdn.example.com/start.png');
    expect(body.metadata).toEqual({ end_frame_url: 'https://cdn.example.com/end.png' });
  });

  it('用户配置的 durationMin/Max 限制时长，超过最大值会被 clamp', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-3', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig({
      modelDefaults: { durationMin: 4, durationMax: 8, durationStep: 1 },
    }));
    const request: ITVRequest = {
      capability: 'video.text-to-video',
      prompt: 'long video',
      options: { duration: 99 },
    };

    await provider.start(request);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.seconds).toBe('8');
  });

  it('GET /v1/videos/{id} 解析 OpenAI 标准成功响应', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      id: 'task-1',
      status: 'completed',
      progress: 100,
      metadata: { url: 'https://cdn.example.com/result.mp4' },
    }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const snapshot = await provider.getTaskSnapshot('task-1');
    expect(snapshot.state).toBe('succeeded');
    expect(snapshot.progress).toBe(100);
    expect(snapshot.output?.source).toBe('https://cdn.example.com/result.mp4');
  });

  it('GET 解析失败状态返回 error', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({
      id: 'task-1',
      status: 'failed',
      fail_reason: '内容审核失败',
    }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    const snapshot = await provider.getTaskSnapshot('task-1');
    expect(snapshot.state).toBe('failed');
    expect(snapshot.error).toBe('内容审核失败');
  });

  it('validate 要求 baseUrl + 凭据 + 模型名', () => {
    expect(new OpenAIVideoITVProvider(makeConfig()).validate()).toBe(true);
    expect(new OpenAIVideoITVProvider(makeConfig({ baseUrl: '' })).validate()).toBe(false);
    expect(new OpenAIVideoITVProvider(makeConfig({ modelName: '' })).validate()).toBe(false);
    expect(new OpenAIVideoITVProvider(makeConfig({ apiKey: '', profileId: undefined })).validate()).toBe(false);
  });

  it('model.defaults.videosPath 覆盖默认 /v1/videos 路径', async () => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ id: 'task-cust', status: 'queued' }));

    const provider = new OpenAIVideoITVProvider(makeConfig({
      modelDefaults: { videosPath: '/v1/videos/generations' },
    }));
    await provider.start({
      capability: 'video.text-to-video',
      prompt: '画一个城市',
      options: { duration: 8 },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/videos/generations');
  });

  it('start 失败时把上游 nested HTML 错误展平为人话', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 'fail_to_fetch_task',
      message: JSON.stringify({
        code: 'fail_to_fetch_task',
        message: '<!DOCTYPE html><html><body><pre>Cannot POST /v1/videos</pre></body></html>',
        data: null,
      }),
      data: null,
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }));

    const provider = new OpenAIVideoITVProvider(makeConfig());
    await expect(provider.start({
      capability: 'video.text-to-video',
      prompt: '一只猫',
      options: { duration: 5 },
    })).rejects.toThrowError(/路由未注册/);
  });
});

describe('flattenUpstreamErrorBody', () => {
  it('剥两层 fail_to_fetch_task 包 Express HTML 404', () => {
    const body = JSON.stringify({
      code: 'fail_to_fetch_task',
      message: JSON.stringify({
        code: 'fail_to_fetch_task',
        message: '<!DOCTYPE html><html><body><pre>Cannot POST /v1/videos</pre></body></html>',
        data: null,
      }),
      data: null,
    });
    const flat = flattenUpstreamErrorBody(body, 404);
    expect(flat).toContain('更上游 POST /v1/videos 路由未注册');
    expect(flat).toContain('HTTP 404');
    expect(flat).toContain('fail_to_fetch_task');
  });

  it('单层 OpenAI 错误结构 → JSON 文本兜底', () => {
    const body = JSON.stringify({
      error: { code: 'model_not_found', message: '模型未授权', type: 'invalid_request_error' },
    });
    const flat = flattenUpstreamErrorBody(body, 503);
    expect(flat).toContain('HTTP 503');
    expect(flat).toContain('模型未授权');
  });

  it('裸 HTML（无 JSON 包裹）也能识别', () => {
    const flat = flattenUpstreamErrorBody('<pre>Cannot POST /v1/video/generations</pre>', 404);
    expect(flat).toContain('更上游 POST /v1/video/generations');
  });

  it('空响应给提示', () => {
    expect(flattenUpstreamErrorBody('', 502)).toContain('上游未返回内容');
  });
});
