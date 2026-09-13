/**
 * OpenAI 标准异步视频生成 Provider
 *
 * 协议参考 OpenAI Sora 视频 API（与 Koma 官方Koma 即梦走的同一套契约）：
 *   - 创建任务：POST {baseUrl}/v1/videos
 *       Body: { model, prompt, seconds, size?, image?, images?, metadata? }
 *       响应：{ id, status, model, created_at, ... }
 *   - 查询任务：GET {baseUrl}/v1/videos/{id}
 *       响应：{ id, status, progress, metadata: { url, result_urls? } }
 *
 * 与 Koma 内置的即梦/Grok 渠道的区别：
 *   - 不锁 baseUrl（可填任何兼容此协议的网关，例如自建 new-api、官方 OpenAI、第三方代理）
 *   - 不预设比例 / 分辨率白名单 —— 这些字段由渠道侧的模型 defaults 决定
 *   - 时长范围读取模型 defaults.durationMin/durationMax/durationStep（用户可在设置里改）
 *
 * 能力（全部 4 种都接，让 fallback 不会绕过本 provider）：
 *   - video.text-to-video        prompt → 视频
 *   - video.image-to-video       prompt + 起始帧 → image: <url>
 *   - video.reference-to-video   prompt + 多张参考图 → images: [...]（OpenAI 兼容扩展）
 *   - video.start-end-to-video   首帧 + 末帧 → image: <start> + metadata.end_frame_url
 *
 * 兼容性说明：images 数组与 metadata.end_frame_url 不是 OpenAI 官方规范，但 new-api、
 * one-api 等主流兼容网关都接受这两种扩展。如果上游严格只认 OpenAI 原生字段，
 * reference-to-video / start-end-to-video 仍可能被上游拒；用户可以在设置里把模型
 * 的能力勾选限制为 text/image-to-video。
 */

import type {
  ITVConfig,
  ITVOptions,
  ProviderStartResult,
  ProviderTaskSnapshot,
} from '../../types';
import { createLogger } from '../../store/logger';
import { sanitizeBodyForLog } from '../../utils/logFormatting';
import { safeFetch } from '../../utils/safeFetch';
import { buildChannelAuthRequest } from '../channel/auth';
import {
  assertSupportedVideoCapabilities,
  type ITVProvider,
  type ITVRequest,
  type ITVResult,
} from './types';
import { clampDurationToSpec, type VideoDurationSpec } from './durationSpec';

const logger = createLogger('OpenAIVideoITVProvider');

interface OpenAIVideoCreateResponse {
  video_id?: string;
  id?: string;
  task_id?: string;
  status?: string;
  model?: string;
  created_at?: number | string;
  error?: { code?: string; message?: string };
}

interface OpenAIVideoTaskResponse extends OpenAIVideoCreateResponse {
  video_url?: string;
  url?: string;
  remixed_from_video_id?: string;
  progress?: number | string;
  metadata?: {
    url?: string;
    result_urls?: string[];
    [k: string]: unknown;
  };
  // 兼容字段：部分网关把 result_urls 直接挂在顶层
  result_urls?: string[];
  fail_reason?: string;
  // 兼容 sora 风格响应
  result?: { type?: string; data?: Array<{ url?: string }> };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizePathSegment(value: string | undefined, fallback: string): string {
  const raw = readString(value) ?? fallback;
  const cleaned = raw.replace(/^\/+|\/+$/g, '');
  return `/${cleaned}`;
}

function resolveVideosPath(config: ITVConfig): string {
  return normalizePathSegment(
    readString(config.modelDefaults?.videosPath),
    'v1/videos',
  );
}

function promptUsesImagePlaceholders(prompt: string): boolean {
  return /@(?:Image|图片)\s*\d+/u.test(prompt);
}

/**
 * 把上游嵌套的 fail_to_fetch_task / Express 默认 HTML 404 / multi-layer JSON 错误展平成一行人话。
 * 多次出现 fail_to_fetch_task 会被压缩为一次。HTML body 里若识别到 "Cannot POST /xxx" 这类
 * Express 默认 fallback，直接抽出路径并指明是路由未注册。
 */
export function flattenUpstreamErrorBody(rawBody: string, status: number): string {
  const trimmed = (rawBody ?? '').trim();
  if (!trimmed) return `HTTP ${status}（上游未返回内容）`;

  const EXPRESS_CANNOT = /Cannot\s+(GET|POST|PUT|DELETE|PATCH)\s+([^\s<>"\\]+)/i;

  // 先剥 JSON 层（一边收集 code，一边在每层 message 上看是不是 Express HTML）
  let current: unknown = trimmed;
  const seenCodes: string[] = [];
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== 'string') break;
    const text = current.trim();
    if (!text.startsWith('{')) break;
    try {
      current = JSON.parse(text);
    } catch {
      break;
    }
    if (current && typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      const code = readString(obj.code) ?? readString(obj.error_code);
      if (code) seenCodes.push(code);
      const inner = readString(obj.message)
        ?? readString((obj.error as Record<string, unknown> | undefined)?.message);
      if (!inner) break;
      // 如果 inner 是 Express HTML 直接命中
      const innerExpress = inner.match(EXPRESS_CANNOT);
      if (innerExpress) {
        const method = innerExpress[1].toUpperCase();
        const path = innerExpress[2].replace(/<\/?pre>/gi, '').replace(/&[a-z]+;/gi, '');
        const codeNote = seenCodes.length ? `（${[...new Set(seenCodes)].join(' / ')}）` : '';
        return `更上游 ${method} ${path} 路由未注册（HTTP ${status}）${codeNote}`;
      }
      // 否则进入下一层尝试解析
      current = inner;
    }
  }

  // 没剥到 JSON 包 HTML 的情况（裸 HTML）：直接在原始字串上找 Express 模式
  const expressCannot = trimmed.match(EXPRESS_CANNOT);
  if (expressCannot) {
    const method = expressCannot[1].toUpperCase();
    const path = expressCannot[2].replace(/<\/?pre>/gi, '').replace(/&[a-z]+;/gi, '');
    return `更上游 ${method} ${path} 路由未注册（HTTP ${status}）`;
  }

  const tail = typeof current === 'string'
    ? current.slice(0, 300)
    : JSON.stringify(current).slice(0, 300);
  const codeNote = seenCodes.length ? `（${[...new Set(seenCodes)].join(' / ')}）` : '';
  return `HTTP ${status}${codeNote}: ${tail}`;
}

/**
 * 从 ITVConfig 推断当前模型的时长 spec。
 *
 * 优先读取通过 ChannelConfig.models 用户配置的范围；如果没有配置或非法，
 * 兜底为 4-15s（覆盖大多数 OpenAI 兼容上游的合理区间）。
 */
function resolveDurationSpec(config: ITVConfig): VideoDurationSpec {
  const defaults = config.modelDefaults;
  const min = readNumber(defaults?.durationMin);
  const max = readNumber(defaults?.durationMax);
  const step = readNumber(defaults?.durationStep);
  const fallbackDefault = readNumber(config.defaultDuration);

  if (min != null && max != null && max >= min) {
    return {
      kind: 'range',
      min: Math.max(1, Math.floor(min)),
      max: Math.max(1, Math.floor(max)),
      step: step && step > 0 ? step : 1,
      default: fallbackDefault != null ? Math.min(Math.max(fallbackDefault, min), max) : Math.min(Math.max(5, min), max),
    };
  }

  return {
    kind: 'range',
    min: 4,
    max: 15,
    step: 1,
    default: fallbackDefault != null ? Math.min(Math.max(fallbackDefault, 4), 15) : 5,
  };
}

export class OpenAIVideoITVProvider implements ITVProvider {
  type = 'openai-video' as const;
  config: ITVConfig;

  // 统一要求上游可访问的远程 URL。分镜提示词会使用 @Image N 占位符，兼容网关通常只把
  // body.images 里的“已上传图片”纳入占位符索引；data-url 体积过大且容易被上游判为未上传图片。
  assetTransports = {
    primaryImage: ['remote-url'] as const,
    additionalReferences: ['remote-url'] as const,
    referenceImages: ['remote-url'] as const,
    startFrame: ['remote-url'] as const,
    endFrame: ['remote-url'] as const,
  };

  constructor(config: ITVConfig) {
    this.config = config;
  }

  private getBaseUrl(): string {
    const value = String(this.config.baseUrl || '').trim();
    if (!value) throw new Error('OpenAI 视频渠道缺少 baseUrl');
    return value.replace(/\/+$/, '').replace(/\/v1$/i, '');
  }

  private getHeaders(): Record<string, string> {
    return buildChannelAuthRequest({
      channelId: this.config.profileId,
      apiKey: this.config.apiKey,
      mode: 'bearer-header',
      headers: { 'Content-Type': 'application/json' },
    }).headers;
  }

  private getAuthOnlyHeaders(): Record<string, string> {
    return buildChannelAuthRequest({
      channelId: this.config.profileId,
      apiKey: this.config.apiKey,
      mode: 'bearer-header',
    }).headers;
  }

  private getModelName(): string {
    const value = String(this.config.modelName || '').trim();
    if (!value) throw new Error('OpenAI 视频渠道未配置模型');
    return value;
  }

  validate(): boolean {
    const hasCredential = Boolean(this.config.profileId) || Boolean(this.config.apiKey);
    return hasCredential
      && Boolean(String(this.config.baseUrl || '').trim())
      && Boolean(String(this.config.modelName || '').trim());
  }

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;
    try {
      const response = await safeFetch(joinUrl(this.getBaseUrl(), '/v1/models'), {
        method: 'GET',
        headers: this.getAuthOnlyHeaders(),
      });
      return response.status !== 401 && response.status !== 403;
    } catch (err) {
      logger.warn('OpenAI 视频渠道 testConnection 失败', { error: err instanceof Error ? err.message : err });
      return false;
    }
  }

  async start(request: ITVRequest): Promise<ProviderStartResult<ITVResult>> {
    if (!this.validate()) throw new Error('OpenAI 视频渠道凭据/模型/baseUrl 未配置完整');
    assertSupportedVideoCapabilities(request, 'OpenAI 视频', [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
      'video.start-end-to-video',
    ]);

    const options = request.options as ITVOptions | undefined;
    const model = this.getModelName();
    const spec = resolveDurationSpec(this.config);
    const duration = clampDurationToSpec(options?.duration ?? this.config.defaultDuration, spec);

    const body: Record<string, unknown> = {
      model,
      prompt: String(request.prompt || '').trim(),
      seconds: String(duration),
    };

    const aspectRatio = String(options?.aspectRatio ?? '').trim();
    if (aspectRatio && aspectRatio.includes('x')) {
      body.size = aspectRatio;
    }
    const resolution = String(options?.resolution ?? this.config.defaultResolution ?? '').trim();
    if (resolution && resolution.includes('x')) {
      body.size = resolution;
    }

    const metadata: Record<string, unknown> = {};
    if (aspectRatio && !aspectRatio.includes('x')) {
      // 把 "16:9" 风格的比例放 metadata 透传给兼容网关，主体仍走 size。
      metadata.ratio = aspectRatio;
    }

    if (request.capability === 'video.image-to-video') {
      // OpenAI 标准：image 字段携带单张起始帧 URL；若 prompt 中使用 @Image N，
      // 兼容网关还需要 images 数组承载完整占位符索引（主图必须是 images[0]）。
      const primary = request.primaryImage?.value;
      if (primary) {
        body.image = primary;
      }
      const additional = (request.additionalReferences || [])
        .map(ref => ref?.value)
        .filter((value): value is string => Boolean(value));
      if (promptUsesImagePlaceholders(request.prompt)) {
        const images = [primary, ...additional].filter((value): value is string => Boolean(value));
        if (images.length) {
          body.images = images;
        }
      } else if (additional.length) {
        body.images = additional;
      }
    } else if (request.capability === 'video.reference-to-video') {
      // OpenAI 兼容扩展：多张参考图走 images 数组。
      const images = (request.referenceImages || [])
        .map(ref => ref?.value)
        .filter((value): value is string => Boolean(value));
      if (images.length) {
        body.images = images;
      }
    } else if (request.capability === 'video.start-end-to-video') {
      // 首帧通过 image，末帧通过 metadata.end_frame_url 透传。
      if (request.startFrame?.value) {
        body.image = request.startFrame.value;
      }
      if (request.endFrame?.value) {
        metadata.end_frame_url = request.endFrame.value;
      }
    }

    if (Object.keys(metadata).length > 0) {
      body.metadata = metadata;
    }

    const videosPath = resolveVideosPath(this.config);

    if (model === 'agnes-video-2.5-flash') {
      body.seconds = String(Math.max(4, Math.min(12, Math.round(duration))));
      body.size = '720P';
      body.aspect_ratio = aspectRatio || '16:9';
      body.n = 1;
      delete body.image;
      delete body.images;
      delete body.metadata;
      if (request.capability === 'video.text-to-video') body.mode = 'text';
      else if (request.capability === 'video.start-end-to-video') {
        body.mode = 'keyframe';
        body.first_frame = request.startFrame?.value;
        body.last_frame = request.endFrame?.value;
        if (!body.first_frame && !body.last_frame) throw new Error('Agnes 首尾帧模式需要至少一张图片');
      } else if (request.capability === 'video.image-to-video' && !request.additionalReferences?.length) {
        body.mode = 'keyframe';
        body.first_frame = request.primaryImage?.value;
        if (!body.first_frame) throw new Error('Agnes 图生视频需要首帧图片');
      } else {
        body.mode = 'reference';
        const images = request.capability === 'video.reference-to-video'
          ? request.referenceImages?.map(ref => ref.value) || []
          : [request.primaryImage?.value, ...(request.additionalReferences || []).map(ref => ref.value)].filter(Boolean);
        if (!images.length || images.length > 5) throw new Error('Agnes Flash 参考模式需要 1–5 张图片');
        body.images = images;
      }
      body.prompt = String(body.prompt).replace(/@(?:Image|图片)\s*(\d+)/gu, '<Picture $1>');
    }

    logger.info('OpenAI 视频任务创建', {
      capability: request.capability,
      model,
      videosPath,
      body: sanitizeBodyForLog(body),
    });

    const response = await safeFetch(joinUrl(this.getBaseUrl(), videosPath), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    if (!response.ok) {
      const flattened = flattenUpstreamErrorBody(raw, response.status);
      logger.error('OpenAI 视频任务创建失败', { status: response.status, videosPath, error: flattened, response: raw.slice(0, 1200) });
      throw new Error(`OpenAI 视频任务创建失败：${flattened}`);
    }
    let data: OpenAIVideoCreateResponse;
    try {
      data = JSON.parse(raw) as OpenAIVideoCreateResponse;
    } catch {
      throw new Error('OpenAI 视频上游返回非 JSON 响应');
    }
    const taskId = model === 'agnes-video-2.5-flash' ? data.video_id : data.id || data.task_id;
    if (!taskId) {
      throw new Error(data.error?.message || 'OpenAI 视频上游未返回 task_id');
    }
    return { mode: 'async', taskId };
  }

  async getTaskSnapshot(taskId: string): Promise<ProviderTaskSnapshot<ITVResult>> {
    const videosPath = resolveVideosPath(this.config);
    const response = await safeFetch(
      joinUrl(this.getBaseUrl(), this.getModelName() === 'agnes-video-2.5-flash'
        ? `/agnesapi?video_id=${encodeURIComponent(taskId)}&model_name=agnes-video-2.5-flash`
        : `${videosPath}/${encodeURIComponent(taskId)}`),
      { method: 'GET', headers: this.getAuthOnlyHeaders() },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const flattened = flattenUpstreamErrorBody(errorText || '', response.status);
      return { state: 'failed', progress: 0, error: flattened };
    }
    let data: OpenAIVideoTaskResponse;
    try {
      data = (await response.json()) as OpenAIVideoTaskResponse;
    } catch {
      return { state: 'failed', progress: 0, error: '查询返回非 JSON' };
    }

    // 状态映射：OpenAI 标准枚举 + 常见兼容值
    const status = String(data.status || '').toLowerCase();
    let state: ProviderTaskSnapshot<ITVResult>['state'];
    if (status === 'completed' || status === 'succeeded' || status === 'success') state = 'succeeded';
    else if (status === 'failed' || status === 'error') state = 'failed';
    else if (status === 'queued' || status === 'pending' || status === 'submitted') state = 'queued';
    else state = 'running';

    const progressRaw = data.progress;
    const progress = typeof progressRaw === 'number'
      ? Math.max(0, Math.min(100, Math.round(progressRaw)))
      : typeof progressRaw === 'string'
        ? Math.max(0, Math.min(100, Math.round(Number(progressRaw) || 0)))
        : (state === 'succeeded' ? 100 : 0);

    const resultUrl = data.video_url || data.url
      || (data.remixed_from_video_id?.startsWith('https://') ? data.remixed_from_video_id : undefined)
      || data.metadata?.url
      || (Array.isArray(data.metadata?.result_urls) && data.metadata?.result_urls?.[0])
      || (Array.isArray(data.result_urls) && data.result_urls[0])
      || data.result?.data?.[0]?.url;

    if (state === 'succeeded') {
      if (!resultUrl) {
        return { state: 'failed', progress: 100, error: '任务完成但未返回视频地址' };
      }
      return {
        state: 'succeeded',
        progress: 100,
        output: { source: resultUrl, taskId },
      };
    }
    if (state === 'failed') {
      return { state: 'failed', progress, error: data.fail_reason || data.error?.message || '任务失败' };
    }
    return { state, progress };
  }
}
