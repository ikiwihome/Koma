/**
 * Grok2API Imagine ITV Provider
 *
 * Uses Grok2API/NewAPI `/v1/videos` endpoint for async video generation.
 * We intentionally keep this provider isolated to avoid impacting existing ITV providers.
 */
import type { ITVConfig, ProviderStartResult, ProviderTaskSnapshot } from '../../types';
import {
  assertSupportedVideoCapabilities,
  type ITVProvider,
  type ITVRequest,
  type ITVResult,
} from './types';
import { isImageToVideoRequest, isReferenceToVideoRequest } from '../../types';
import { safeFetch } from '../../utils/safeFetch';
import { buildChannelAuthRequest } from '../channel/auth';
import { createLogger } from '../../store/logger';
import { sanitizeBodyForLog } from '../../utils/logFormatting';
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  normalizeVideoDurationSeconds,
  type AllowedVideoDurationSeconds,
} from '../../utils/videoDuration';

const logger = createLogger('Grok2ApiImagineITV');

// 对齐 video_plugin_疾刃API 的 _GROK_MAX_REFERENCE_IMAGES：grok2api 单次最多 7 张参考图。
const GROK_MAX_REFERENCE_IMAGES = 7;

type VideoCreateResponse = Record<string, unknown>;
type VideoTaskResponse = Record<string, unknown>;

function normalizePromptImagePlaceholders(prompt: string): string {
  // Grok / OpenAI-video 兼容上游以 @Image N 作为参考图占位协议。
  // 这里只做协议规范化：@图片3 / @Image3 -> @Image 3，不把占位符改成自然语言。
  return prompt.replace(/@(?:Image|图片)\s*(\d+)/gu, '@Image $1');
}

function createCacheBustNonce(): string {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.getRandomValues) {
    const bytes = new Uint8Array(14);
    cryptoLike.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(32).padStart(2, '0')).join('').slice(0, 22);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function bustUrlCache(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  const hashIndex = url.indexOf('#');
  const main = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const sep = main.includes('?') ? '&' : '?';
  return `${main}${sep}_r=${createCacheBustNonce()}${hash}`;
}

function toGrokQuality(value: unknown): 'high' | 'standard' {
  const raw = String(value || '').trim().toLowerCase();
  if (['720p', '1080p', 'hd', 'high', '高清', '1280x720', '720x1280', '1920x1080', '1080x1920'].includes(raw)) {
    return 'high';
  }
  return 'standard';
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function trimUrlTail(candidate: string): string {
  let s = candidate.trim();
  // Common trailing chars when the model returns HTML attributes or markdown-ish wrappers.
  // Also handle percent-encoded tails like %22%3E (">).
  for (let i = 0; i < 10; i += 1) {
    const before = s;
    s = s.replace(/[)"'<>.,;\]]+$/g, '');
    s = s.replace(/(%22|%27|%3E|%3C)+$/gi, '');
    if (s === before) break;
  }
  return s;
}

function normalizeCandidateUrl(candidate: string, baseUrl: string): string | null {
  const c = trimUrlTail(candidate);
  if (!c) return null;
  if (c.startsWith('data:')) return c;
  if (/^https?:\/\//i.test(c)) return c;
  if (c.startsWith('koma-local:')) return c;

  if (c.startsWith('/') || c.startsWith('./')) {
    if (/\.(mp4|webm|mov|m3u8)(\?.*)?$/i.test(c) || c.includes('/files/') || c.includes('/generated/')) {
      try {
        return new URL(c, baseUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractUrlsFromText(text: string, baseUrl: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const direct = normalizeCandidateUrl(text, baseUrl);
  if (direct) out.push(direct);

  // href/src="..."
  for (const m of text.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/gi)) {
    const u = normalizeCandidateUrl(m[1], baseUrl);
    if (u) out.push(u);
  }
  for (const m of text.matchAll(/(?:href|src)\s*=\s*'([^']+)'/gi)) {
    const u = normalizeCandidateUrl(m[1], baseUrl);
    if (u) out.push(u);
  }

  // Markdown link/image
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)|!\[[^\]]*\]\(([^)]+)\)/g)) {
    const u = normalizeCandidateUrl((m[1] || m[2] || '').trim(), baseUrl);
    if (u) out.push(u);
  }

  // Plain URLs
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const u = normalizeCandidateUrl(m[0], baseUrl);
    if (u) out.push(u);
  }

  // data:
  for (const m of text.matchAll(/data:[^ \n\r\t]+/g)) {
    const u = normalizeCandidateUrl(m[0], baseUrl);
    if (u) out.push(u);
  }

  // Relative media paths
  for (const m of text.matchAll(/(\/[^\s)]+\.(mp4|webm|mov|m3u8)(\?[^\s)]*)?)/gi)) {
    const u = normalizeCandidateUrl(m[1], baseUrl);
    if (u) out.push(u);
  }

  return out;
}

function scoreMediaUrl(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (u.startsWith('data:video/')) score += 200;
  if (/\.(mp4|webm|mov|m3u8)(\?|$)/.test(u)) score += 180;
  if (u.includes('/video/') || u.includes('video')) score += 40;
  if (u.includes('preview_image')) score -= 120;
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(u)) score -= 100;
  return score;
}

function findBestMediaUrlDeep(value: unknown, baseUrl: string): { best?: string; candidates: Array<{ url: string; score: number }> } {
  const visited = new Set<any>();
  const stack: unknown[] = [value];
  const candidates: Array<{ url: string; score: number }> = [];
  let steps = 0;

  const addCandidate = (u: string) => {
    const score = scoreMediaUrl(u);
    candidates.push({ url: u, score });
  };

  while (stack.length > 0 && steps < 5000) {
    steps += 1;
    const cur = stack.pop();
    if (typeof cur === 'string') {
      for (const u of extractUrlsFromText(cur, baseUrl)) addCandidate(u);
      continue;
    }
    if (!cur || typeof cur !== 'object') continue;
    if (visited.has(cur as any)) continue;
    visited.add(cur as any);

    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i -= 1) stack.push(cur[i]);
      continue;
    }

    const obj = cur as Record<string, unknown>;
    for (const key of ['url', 'videoUrl', 'video_url', 'src', 'href', 'path', 'output', 'result', 'preview', 'preview_image']) {
      if (key in obj) stack.push(obj[key]);
    }
    for (const v of Object.values(obj)) stack.push(v);
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]?.url;
  return { best, candidates: candidates.slice(0, 12) };
}

export class Grok2ApiImagineITVProvider implements ITVProvider {
  type = 'grok2api-imagine-itv' as const;
  config: ITVConfig;

  // Grok2API 接收 URL 或 data-uri（base64），但 data-uri 会让 prompt body 暴增、
  // 且部分代理对超长 base64 直接 413/超时。这里仅声明 remote-url，让上游管线
  // 通过 ensureRemoteUrlForSingleSource/Multiple 把本地图片先上传到图床（七牛云 OSS 等）。
  assetTransports = {
    primaryImage: ['remote-url'] as const,
    additionalReferences: ['remote-url'] as const,
    referenceImages: ['remote-url'] as const,
  };

  constructor(config: ITVConfig) {
    // grok2api-imagine-itv 协议固有需要 grok-image-index 编译（@角色名 → @Image N 且 refs 自动限 3）。
    // 这里硬绑定协议，避免用户漏配导致送上游的 messages content 索引对不上而 400。
    this.config = { ...config, promptProtocol: config.promptProtocol ?? 'grok-image-index' };
  }

  private getModelName(): string {
    const value = String(this.config.modelName || '').trim();
    if (!value) {
      throw new Error('模型名称未配置');
    }
    return value;
  }

  private normalizeVideoLengthSeconds(value: unknown): AllowedVideoDurationSeconds {
    return normalizeVideoDurationSeconds(value, DEFAULT_VIDEO_DURATION_SECONDS);
  }

  private normalizeAspectRatio(value: string | undefined): string | undefined {
    if (!value || typeof value !== 'string') return undefined;
    const v = value.trim();
    // Preferred format: "9:16" / "16:9"
    if (/^\d{1,3}\s*:\s*\d{1,3}$/.test(v)) {
      const [aRaw, bRaw] = v.split(':').map(s => Number(s.trim()));
      if (!Number.isFinite(aRaw) || !Number.isFinite(bRaw) || aRaw <= 0 || bRaw <= 0) return undefined;
      // Keep as reduced ratio for stability
      const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
      const g = gcd(aRaw, bRaw);
      return `${Math.round(aRaw / g)}:${Math.round(bRaw / g)}`;
    }

    // Settings UI uses "1280x720" style; convert it to reduced ratio string.
    const m = v.match(/^(\d{3,5})x(\d{3,5})$/);
    if (!m) return undefined;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
    const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
    const g = gcd(w, h);
    return `${Math.round(w / g)}:${Math.round(h / g)}`;
  }

  private resolveGrokSize(aspectRatio: string | undefined): string {
    const ratio = this.normalizeAspectRatio(aspectRatio) || '16:9';
    const sizes: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1280x720',
      '9:16': '720x1280',
      '4:3': '1152x864',
      '3:4': '864x1152',
      '21:9': '1680x720',
    };
    return sizes[ratio] || sizes['16:9'];
  }

  private extractTaskId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const obj = value as Record<string, unknown>;
    const direct = obj.id || obj.task_id || obj.taskId;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const data = obj.data;
    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;
      const nestedId = nested.id || nested.task_id || nested.taskId;
      if (typeof nestedId === 'string' && nestedId.trim()) return nestedId.trim();
    }
    return undefined;
  }

  private mapTaskState(value: unknown): ProviderTaskSnapshot<ITVResult>['state'] {
    const status = String(value || '').trim().toLowerCase();
    if (['completed', 'succeeded', 'success', 'done'].includes(status)) return 'succeeded';
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return 'failed';
    if (['queued', 'pending', 'created', 'submitted'].includes(status)) return 'queued';
    return 'running';
  }

  private buildTaskContentUrl(taskId: string): string {
    return joinUrl(this.config.baseUrl || '', `/v1/videos/${encodeURIComponent(taskId)}/content`);
  }

  validate(): boolean {
    const hasCredentialRef = Boolean(this.config.profileId) || Boolean(this.config.apiKey);
    return hasCredentialRef && Boolean(this.config.baseUrl) && Boolean(String(this.config.modelName || '').trim());
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

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;
    try {
      const resp = await safeFetch(joinUrl(this.config.baseUrl || '', '/v1/models'), {
        method: 'GET',
        headers: this.getAuthOnlyHeaders(),
      });
      return resp.status !== 401 && resp.status !== 403;
    } catch {
      return false;
    }
  }

  async start(request: ITVRequest): Promise<ProviderStartResult<ITVResult>> {
    if ((!this.config.apiKey && !this.config.profileId) || !this.config.baseUrl) {
      throw new Error('API Key 或 API 地址未配置');
    }
    const modelName = this.getModelName();
    assertSupportedVideoCapabilities(request, 'Grok2API Imagine Video', [
      'video.text-to-video',
      'video.image-to-video',
      'video.reference-to-video',
    ]);
    const mode = request.capability === 'video.text-to-video'
      ? 'text_to_video'
      : request.capability === 'video.reference-to-video'
        ? 'reference_to_video'
        : 'image_to_video';
    // 对齐 Python 参考实现 _submit_video_task_grok + _merge_image_paths：
    // 参考图/首帧按顺序合并，去重后截到 7 张；mode 本身不下发到 upstream。
    const rawImageInputs = isReferenceToVideoRequest(request)
      ? request.referenceImages
      : isImageToVideoRequest(request)
        ? [request.primaryImage, ...(request.additionalReferences || [])]
        : [];
    const seenImageValues = new Set<string>();
    const imageInputs: typeof rawImageInputs = [];
    for (const item of rawImageInputs) {
      const value = item?.value;
      if (!value || seenImageValues.has(value)) continue;
      seenImageValues.add(value);
      imageInputs.push(item);
      if (imageInputs.length >= GROK_MAX_REFERENCE_IMAGES) break;
    }
    if (mode !== 'text_to_video' && imageInputs.length === 0) {
      throw new Error('Grok2API Imagine Video 需要至少一张参考图');
    }

    const protocol = (this.config as any)?.promptProtocol;
    const debugBody = Boolean(protocol) || (import.meta as any)?.env?.DEV === true;
    const opts = request.options || {};
    const durationRaw = opts.duration ?? this.config.defaultDuration;
    const duration = this.normalizeVideoLengthSeconds(durationRaw);
    const resolutionRaw = typeof opts.resolution === 'string'
      ? opts.resolution
      : this.config.defaultResolution;
    const aspectRatio = this.normalizeAspectRatio(
      typeof opts.aspectRatio === 'string' ? opts.aspectRatio : undefined,
    ) || this.normalizeAspectRatio(resolutionRaw) || '16:9';
    const size = this.resolveGrokSize(aspectRatio);

    // 对齐 template_/video_plugin_疾刃API_v1.1.8 的 Grok 路径：
    // /v1/videos 需要 image_reference 对象数组，prompt 保持 @Image N 协议。
    const images = imageInputs.map(imageInput => imageInput.value);
    const prompt = images.length > 0
      ? normalizePromptImagePlaceholders(request.prompt)
      : request.prompt;
    const body: Record<string, any> = {
      model: modelName,
      prompt,
      size,
      seconds: String(duration),
      quality: toGrokQuality(resolutionRaw || '720p'),
    };
    if (images.length > 0) {
      body.image_reference = images.map(url => ({
        type: 'image_url',
        image_url: { url: bustUrlCache(url) },
      }));
    }

    if (debugBody) {
      logger.info('ITV videos request body', {
        provider: this.config.provider,
        mode,
        capability: request.capability,
        contentType: 'application/json',
        ...(protocol ? { promptProtocol: protocol } : undefined),
        requestedDuration: durationRaw,
        normalizedDuration: duration,
        requestedAspectRatio: opts.aspectRatio,
        normalizedAspectRatio: aspectRatio,
        requestedResolution: resolutionRaw,
        normalizedSize: size,
        imagesCount: images.length,
        imageReferenceCount: body.image_reference?.length || 0,
        body: sanitizeBodyForLog(body),
      });
    }

    const resp = await safeFetch(joinUrl(this.config.baseUrl || '', '/v1/videos'), {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Connection': 'close',
        'User-Agent': 'jimeng-newapi-bridge/koma-builtin',
        ...(debugBody ? { 'x-koma-debug-body': '1' } : undefined),
        ...(debugBody ? { 'x-koma-trace-operation': 'itv.videos.create' } : undefined),
      },
      body: JSON.stringify(body),
    });
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`提交视频任务失败 (${resp.status}): ${raw.slice(0, 1200)}`);

    let data: VideoCreateResponse | null = null;
    try {
      data = JSON.parse(raw) as VideoCreateResponse;
    } catch {
      const { best, candidates } = findBestMediaUrlDeep(raw, this.config.baseUrl || '');
      if (!best || scoreMediaUrl(best) <= 0) {
        logger.warn('ITV videos create response is not JSON and has no detectable video url', {
          rawPreview: raw.slice(0, 1200),
          candidates,
        });
        throw new Error('API 返回了无法识别的视频响应（/v1/videos，非 JSON）');
      }
      return { mode: 'immediate', output: { source: best, durationSec: duration } };
    }

    const { best, candidates } = findBestMediaUrlDeep(data, this.config.baseUrl || '');
    if (best && scoreMediaUrl(best) > 0) {
      return { mode: 'immediate', output: { source: best, durationSec: duration } };
    }

    const taskId = this.extractTaskId(data);
    if (!taskId) {
      logger.warn('ITV videos create response missing task id/video url', {
        provider: this.config.provider,
        response: sanitizeBodyForLog(data as any),
        rawPreview: raw.slice(0, 1200),
        candidates,
      });
      throw new Error('API 返回了无法识别的视频任务响应（缺少 task id）');
    }

    return { mode: 'async', taskId };
  }

  async getTaskSnapshot(taskId: string): Promise<ProviderTaskSnapshot<ITVResult>> {
    const resp = await safeFetch(joinUrl(this.config.baseUrl || '', `/v1/videos/${encodeURIComponent(taskId)}`), {
      method: 'GET',
      headers: this.getAuthOnlyHeaders(),
    });
    const raw = await resp.text();
    if (!resp.ok) {
      return { state: 'failed', progress: 0, error: `查询视频任务失败 (${resp.status}): ${raw.slice(0, 600)}` };
    }

    let data: VideoTaskResponse;
    try {
      data = JSON.parse(raw) as VideoTaskResponse;
    } catch {
      return { state: 'failed', progress: 0, error: `API 返回了非 JSON 视频任务响应: ${raw.slice(0, 300)}` };
    }

    const status = (data.status ?? (data.data as any)?.status) as unknown;
    const state = this.mapTaskState(status);
    const progressRaw = data.progress ?? (data.data as any)?.progress;
    const progress = typeof progressRaw === 'number'
      ? Math.max(0, Math.min(100, progressRaw))
      : state === 'succeeded'
        ? 100
        : 0;

    const { best, candidates } = findBestMediaUrlDeep(data, this.config.baseUrl || '');
    if (state === 'succeeded') {
      if (best && scoreMediaUrl(best) > 0) {
        return { state: 'succeeded', progress: 100, output: { source: best } };
      }
      const contentUrl = this.buildTaskContentUrl(taskId);
      logger.info('ITV videos task completed without video url; using content endpoint', {
        provider: this.config.provider,
        taskId,
        contentUrl,
        response: sanitizeBodyForLog(data as any),
        candidates,
      });
      return { state: 'succeeded', progress: 100, output: { source: contentUrl, taskId } };
    }

    if (state === 'failed') {
      const error = String((data.error as any)?.message || data.error || data.message || '视频任务失败');
      return { state: 'failed', progress, error };
    }

    return { state, progress };
  }
}
