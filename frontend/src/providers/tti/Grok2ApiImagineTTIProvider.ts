/**
 * Grok2API Imagine TTI Provider
 *
 * Goal:
 * - Keep existing providers untouched.
 * - Speak Grok2API reverse-engineered multimodal shape:
 *   - No references: OpenAI-compatible `/v1/images/generations`
 *   - With references: `/v1/images/edits` (multipart/form-data, repeated `image` fields)
 */
import type { TTIModelConfig, ProviderStartResult, ProviderTaskSnapshot } from '../../types';
import type { TTIProvider, TTIRequest, ImageResult } from './types';
import { safeFetch } from '../../utils/safeFetch';
import { buildChannelAuthRequest } from '../channel/auth';
import { createLogger } from '../../store/logger';
import { electronService } from '../../services/electronService';
import { base64ToBytes, parseDataUrl } from '../../utils/encoding';
import { sanitizeBodyForLog } from '../../utils/logFormatting';

const logger = createLogger('Grok2ApiImagineTTI');

const GROK2API_MAX_BATCH_IMAGES = 10;
const GROK2API_LITE_MAX_EDIT_BATCH_IMAGES = 4;

// Grok2API 上游 _ALLOWED_SIZES（grok2api/app/products/openai/router.py:213）唯一接受这一组：
// 1280x720 / 720x1280 / 1792x1024 / 1024x1792 / 1024x1024。
// resolve_aspect_ratio(size) 落不到表里就回到 "2:3" — 之前送 1920x1080 就是这条路，被默默改成 2:3。
const GROK_IMAGINE_GEN_ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '3:2': '1792x1024',
  '2:3': '1024x1792',
};

// /v1/images/edits（含 chat/completions 命中 image_to_image 走 grok-imagine-image-edit）
// 上游 _normalize_edit_size 硬编码只接受 "1024x1024"。其他值直接 400。
// 所以任何带参考图的请求注定 1:1 — 这是上游 grok-image-all 别名 image_to_image 路由的限制。
const GROK_IMAGINE_EDIT_FORCED_SIZE = '1024x1024';

function reduceAspectRatio(width: number, height: number): string | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function normalizeAspectRatioInput(value: string | undefined): string | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  const direct = raw.match(/^(\d{1,3})\s*:\s*(\d{1,3})$/);
  if (direct) return reduceAspectRatio(Number(direct[1]), Number(direct[2]));
  const wxh = raw.match(/^(\d{2,5})x(\d{2,5})$/);
  if (wxh) return reduceAspectRatio(Number(wxh[1]), Number(wxh[2]));
  return undefined;
}

/**
 * 文生图（无参考图）路径用的尺寸解析。
 * 优先级：显式 width/height（仅当落在上游允许集合内）> options.aspectRatio > defaultSize > 16:9 兜底。
 */
function resolveGenSize(
  options: { width?: number; height?: number; aspectRatio?: string } | undefined,
  defaultSize: string | undefined,
): string {
  const w = options?.width;
  const h = options?.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    const explicit = `${Math.round(w)}x${Math.round(h)}`;
    const allowed = Object.values(GROK_IMAGINE_GEN_ASPECT_TO_SIZE);
    if (allowed.includes(explicit)) return explicit;
  }
  const ratio = normalizeAspectRatioInput(options?.aspectRatio);
  if (ratio && GROK_IMAGINE_GEN_ASPECT_TO_SIZE[ratio]) {
    return GROK_IMAGINE_GEN_ASPECT_TO_SIZE[ratio];
  }
  if (defaultSize && Object.values(GROK_IMAGINE_GEN_ASPECT_TO_SIZE).includes(defaultSize)) {
    return defaultSize;
  }
  return GROK_IMAGINE_GEN_ASPECT_TO_SIZE['16:9'];
}

type ImageGenResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
  id?: string;
  created?: number;
};

type ChatCompletionsResponse = {
  id?: string;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

function extFromMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'bin';
}


function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function clampCount(value: unknown, max: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return 1;
  return Math.max(1, Math.min(max, Math.floor(normalized)));
}

function isLiteImageModel(modelName: string): boolean {
  return /(?:^|[-_\s])lite(?:$|[-_\s])/i.test(modelName);
}

function extractMarkdownUrls(text: string): string[] {
  return Array.from(text.matchAll(/(?:!\[[^\]]*\]|\[[^\]]*\])\(([^)]+)\)/g))
    .map(match => (match[1] || '').trim())
    .filter(Boolean);
}

function normalizeCandidateUrl(candidate: string, baseUrl: string): string | null {
  const c = candidate.trim();
  if (!c) return null;
  if (c.startsWith('data:')) return c;
  if (/^https?:\/\//i.test(c)) return c;

  // Some deployments may return relative URLs (e.g. /outputs/xxx.png)
  if (c.startsWith('/') || c.startsWith('./')) {
    // Only treat as URL if it looks like a media file path.
    if (/\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(c) || c.includes('/outputs/') || c.includes('/static/')) {
      try {
        return new URL(c, baseUrl).toString();
      } catch {
        return null;
      }
    }
  }

  // Some UIs may return a koma-local URL for local file access.
  // Keep it as-is; downstream persistence can still accept it as a "source" string.
  if (c.startsWith('koma-local:')) return c;

  return null;
}

function extractUrlsFromText(text: string, baseUrl: string): string[] {
  if (!text) return [];

  const candidates = [
    ...extractMarkdownUrls(text),
    ...Array.from(text.matchAll(/data:[^ \n\r\t]+/g)).map(match => match[0]),
    ...Array.from(text.matchAll(/https?:\/\/[^\s)]+/g)).map(match => match[0]),
    ...Array.from(text.matchAll(/(?:^|[\s(])(\/[^\s)]+\.(?:png|jpg|jpeg|webp|gif)(?:\?[^\s)]*)?)/gi)).map(match => match[1] || ''),
  ];

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeCandidateUrl(candidate, baseUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function findMediaUrlsDeep(value: unknown, baseUrl: string): string[] {
  const visited = new Set<any>();
  const seen = new Set<string>();
  const urls: string[] = [];
  const stack: unknown[] = [value];
  let steps = 0;

  while (stack.length > 0 && steps < 5000) {
    steps += 1;
    const cur = stack.pop();
    if (typeof cur === 'string') {
      for (const url of extractUrlsFromText(cur, baseUrl)) {
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
      const normalized = normalizeCandidateUrl(cur, baseUrl);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
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
    // Common keys seen in reverse-engineered backends
    for (const key of ['url', 'imageUrl', 'image_url', 'src', 'href', 'path', 'output', 'result']) {
      if (key in obj) stack.push(obj[key]);
    }
    // Also scan all properties best-effort
    for (const v of Object.values(obj)) stack.push(v);
  }

  return urls;
}

function dropOverflowImageTags(prompt: string, maxImages: number): string {
  const out = prompt
    .replace(/\@Image\s+(\d+)\b/g, (m, nRaw) => (Number(nRaw) > maxImages ? '' : m))
    .replace(/\[\[IMAGE_TAG_(\d+)\]\]/g, (m, nRaw) => (Number(nRaw) > maxImages ? '' : m));
  return out.replace(/\s{2,}/g, ' ').trim();
}

function stripBatchMetadata(image: ImageResult): ImageResult {
  const metadata = image.metadata ? { ...image.metadata } : undefined;
  if (metadata?.batchImages) {
    delete metadata.batchImages;
  }
  return metadata ? { ...image, metadata } : { ...image };
}

function createImmediateImageResult(images: ImageResult[]): ImageResult {
  const normalized = images.map(stripBatchMetadata);
  const first = normalized[0];
  if (!first) {
    throw new Error('API 返回了无法识别的图片响应');
  }
  if (normalized.length === 1) {
    return first;
  }
  return {
    ...first,
    metadata: {
      ...(first.metadata ?? {}),
      batchImages: normalized,
    },
  };
}

function extractImageResultsFromGen(resp: ImageGenResponse): ImageResult[] {
  return (resp.data ?? [])
    .map(item => {
      const url = item.url || (item.b64_json ? `data:image/jpeg;base64,${item.b64_json}` : null);
      return url ? { path: url, url } : null;
    })
    .filter(Boolean) as ImageResult[];
}

export class Grok2ApiImagineTTIProvider implements TTIProvider {
  type = 'grok2api-imagine-tti' as const;
  config: TTIModelConfig;
  /** /v1/images/edits 走 multipart，参考图通过 parseDataUrl 解出字节，本地直传无需图床。 */
  supportsLocalReferences = true;

  constructor(config: TTIModelConfig) {
    // grok2api-imagine-tti 协议固有需要 grok-image-index 编译（@角色名 → @Image N 且 refs 自动限 3）。
    // 与 Grok2ApiImagineITVProvider 对称硬绑，避免用户漏配导致上游 400。
    this.config = { ...config, promptProtocol: config.promptProtocol ?? 'grok-image-index' };
  }

  private getModelName(): string {
    const value = String(this.config.modelName || '').trim();
    if (!value) {
      throw new Error('模型名称未配置');
    }
    return value;
  }

  validate(): boolean {
    const hasCredentialRef = Boolean(this.config.profileId) || Boolean(this.config.apiKey);
    return hasCredentialRef && Boolean(this.config.baseUrl) && Boolean(String(this.config.modelName || '').trim());
  }

  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    // 走统一抽象：profileId 存在 → x-koma-channel-id（主进程注入 Authorization）；
    // 否则回退明文 Bearer。详见 providers/channel/auth.ts。
    return buildChannelAuthRequest({
      channelId: this.config.profileId,
      apiKey: this.config.apiKey,
      mode: 'bearer-header',
      headers: extra,
    }).headers;
  }

  private getJsonHeaders(): Record<string, string> {
    return this.getHeaders({ 'Content-Type': 'application/json' });
  }

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;
    try {
      const resp = await safeFetch(joinUrl(this.config.baseUrl || '', '/v1/models'), {
        method: 'GET',
        headers: this.getHeaders(),
      });
      return resp.status !== 401 && resp.status !== 403;
    } catch {
      return false;
    }
  }

  async start(request: TTIRequest): Promise<ProviderStartResult<ImageResult>> {
    if ((!this.config.apiKey && !this.config.profileId) || !this.config.baseUrl) {
      throw new Error('API Key 或 API 地址未配置');
    }
    const modelName = this.getModelName();

    const hasRefs = Boolean(request.references?.length);
    const protocol = (this.config as any)?.promptProtocol;
    const debugBody = Boolean(protocol) || (import.meta as any)?.env?.DEV === true;

    // 文生图（无参考）走 grok-imagine-image-pro，支持上游 _ALLOWED_SIZES；
    // 图生图（带参考）路由到 grok-imagine-image-edit，硬编码只接受 1024x1024 — 一律送 1024x1024。
    const resolveSize = (): string => hasRefs
      ? GROK_IMAGINE_EDIT_FORCED_SIZE
      : resolveGenSize(request.options, this.config.defaultSize);
    const generationCount = clampCount(request.count, GROK2API_MAX_BATCH_IMAGES);
    const chatCount = clampCount(request.count, GROK2API_MAX_BATCH_IMAGES);
    const editCount = clampCount(
      request.count,
      isLiteImageModel(modelName) ? GROK2API_LITE_MAX_EDIT_BATCH_IMAGES : GROK2API_MAX_BATCH_IMAGES,
    );

    // 1) No references: call OpenAI-compatible images generation endpoint
    if (!hasRefs) {
      const size = resolveSize();
      const body: Record<string, any> = {
        model: modelName,
        prompt: request.prompt,
        n: generationCount,
        size,
      };

      if (debugBody) {
        logger.info('TTI generations request body', {
          provider: this.config.provider,
          ...(protocol ? { promptProtocol: protocol } : undefined),
          size,
          requestedAspectRatio: request.options?.aspectRatio,
          defaultSize: this.config.defaultSize,
          body: sanitizeBodyForLog(body),
        });
      }

      const resp = await safeFetch(joinUrl(this.config.baseUrl || '', '/v1/images/generations'), {
        method: 'POST',
        headers: {
          ...this.getJsonHeaders(),
          ...(debugBody ? { 'x-koma-debug-body': '1' } : undefined),
          ...(debugBody ? { 'x-koma-trace-operation': 'tti.generations' } : undefined),
        },
        body: JSON.stringify(body),
      });
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`创建任务失败: ${raw.slice(0, 1200)}`);

      let data: ImageGenResponse;
      try {
        data = JSON.parse(raw) as ImageGenResponse;
      } catch {
        logger.warn('TTI generations response is not JSON', { preview: raw.slice(0, 1200) });
        throw new Error('API 返回了无法识别的图片响应（images/generations，非 JSON）');
      }
      const images = extractImageResultsFromGen(data);
      if (!images.length) throw new Error('API 返回了无法识别的图片响应');
      return { mode: 'immediate', output: createImmediateImageResult(images) };
    }

    // 2) With references:
    // Some deployments/proxies may not support multipart reliably. Try JSON-body edit first.
    const refsAll = request.references || [];
    const refs = refsAll.slice(0, 3);
    const prompt = dropOverflowImageTags(request.prompt, refs.length);

    try {
      const content = [
        { type: 'text', text: prompt },
        ...refs.map(r => ({ type: 'image_url', image_url: { url: r.value } })),
      ];

      // 带参考图：上游 chat/completions 命中 image_to_image alias 走 grok-imagine-image-edit，
      // image_config.size 由 _normalize_edit_size 强制为 1024x1024，发别的会 400 — 索性老老实实送 1024x1024。
      const size = resolveSize();
      const body: Record<string, any> = {
        model: modelName,
        stream: false,
        messages: [{ role: 'user', content }],
        image_config: {
          n: chatCount,
          size,
        },
      };

      if (debugBody) {
        logger.info('TTI chat(edit) request body', {
          provider: this.config.provider,
          ...(protocol ? { promptProtocol: protocol } : undefined),
          size,
          requestedAspectRatio: request.options?.aspectRatio,
          defaultSize: this.config.defaultSize,
          body: sanitizeBodyForLog(body),
        });
      }

      const resp = await safeFetch(joinUrl(this.config.baseUrl || '', '/v1/chat/completions'), {
        method: 'POST',
        headers: {
          ...this.getJsonHeaders(),
          ...(debugBody ? { 'x-koma-debug-body': '1' } : undefined),
          ...(debugBody ? { 'x-koma-trace-operation': 'tti.chat.edit' } : undefined),
        },
        body: JSON.stringify(body),
      });
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`chat/edit failed (${resp.status}): ${raw.slice(0, 600)}`);

      let data: ChatCompletionsResponse;
      try {
        data = JSON.parse(raw) as ChatCompletionsResponse;
      } catch {
        throw new Error(`chat/edit non-json: ${raw.slice(0, 600)}`);
      }

      const images = findMediaUrlsDeep(data, this.config.baseUrl || '')
        .map(url => ({ path: url, url } satisfies ImageResult));
      if (!images.length) throw new Error('chat/edit has no media url');
      return { mode: 'immediate', output: createImmediateImageResult(images) };
    } catch (err: any) {
      logger.warn('TTI chat(edit) failed; falling back to images/edits multipart', {
        provider: this.config.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2.2) Fallback: use /v1/images/edits (multipart)
    // 上游 _normalize_edit_size 硬编码 1024x1024，其他值 400。直接送 1024x1024 避免回落失败。
    const editSize = resolveSize();
    const form = new FormData();
    form.append('model', modelName);
    form.append('prompt', prompt);
    form.append('n', String(editCount));
    form.append('size', editSize);

    // 先收集所有有效 refs（解析字节），再按数量决定字段名，避免循环里失败导致字段错乱。
    const validRefs: Array<{ bytes: Uint8Array; mimeType: string; index: number }> = [];
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      if (!ref?.value) continue;

      let mimeType = ref.mimeType || 'image/png';
      let bytes: Uint8Array | null = null;

      if (ref.value.startsWith('data:')) {
        const parsed = parseDataUrl(ref.value);
        mimeType = parsed.mimeType || mimeType;
        bytes = parsed.bytes;
      } else if (ref.transport === 'remote-url') {
        // Edits endpoint expects file parts; for remote URLs we best-effort download to temp first.
        if (!electronService.isElectron()) {
          throw new Error('当前环境无法处理 remote-url 参考图，请改用 data-url 或在 Electron 环境中运行');
        }
        const tmpDir = await electronService.app.getPath('temp');
        const tmpPath = `${tmpDir.replace(/\/+$/, '')}/koma-grok2api-edit-${Date.now()}-${i}.bin`;
        const dl = await electronService.fs.downloadFile(ref.value, tmpPath);
        if (!dl?.success) throw new Error(`下载参考图失败: ${ref.value}`);
        const base64 = await electronService.fs.readFileAsBase64(tmpPath);
        bytes = base64ToBytes(base64);
        // Best-effort cleanup (ignore errors)
        electronService.fs.remove(tmpPath).catch(() => {});
      } else {
        // data-url is expected for local assets; if we reach here it's likely a filesystem path or other
        throw new Error(`不支持的参考图输入: ${ref.transport}:${ref.value}`);
      }

      if (bytes && bytes.length > 0) {
        validRefs.push({ bytes, mimeType, index: i });
      }
    }

    // 防御：到这里有 refsAll 但 validRefs 为空，意味着所有 ref 解析失败 / value 为空。
    // 如果继续发空 multipart，上游会 422 'Field required: image[]'，错误信息让人无法定位。
    // 直接抛清晰错，让上层修资产引用。
    if (validRefs.length === 0) {
      throw new Error('所有参考图都未能解析为有效字节（请检查参考图来源是否可用）');
    }

    // 按 OpenAI 官方协议切换字段名：
    //  - 1 张参考图 → `image`（OpenAI 单文件标准字段）
    //  - 多张 → `image[]`（OpenAI 多文件数组语法）
    // 之前统一用 `image[]` 依赖上游 adaptor 自动归一为 image，
    // 但 komaapi 当前版本在单图场景报 "Field required: image[]" —— 显然没正确归一。
    // 改成按数量切，跟 OpenAI 官方 SDK / Node SDK 行为一致，最大兼容上游。
    const imageFieldName = validRefs.length === 1 ? 'image' : 'image[]';
    for (const item of validRefs) {
      const filename = `image${item.index + 1}.${extFromMime(item.mimeType)}`;
      form.append(imageFieldName, new Blob([item.bytes], { type: item.mimeType }), filename);
    }

    if (debugBody) {
      logger.info('TTI edits (multipart) request', {
        provider: this.config.provider,
        ...(protocol ? { promptProtocol: protocol } : undefined),
        model: modelName,
        size: resolveSize(),
        requestedAspectRatio: request.options?.aspectRatio,
        defaultSize: this.config.defaultSize,
        prompt,
        images: refsAll.map((r, i) => ({
          i: i + 1,
          transport: r.transport,
          mimeType: r.mimeType,
          valuePreview: typeof r.value === 'string' ? (r.value.startsWith('data:') ? `${r.value.slice(0, 80)}...(data-url)` : r.value) : String(r.value),
        })),
      });
    }

    const resp = await safeFetch(joinUrl(this.config.baseUrl || '', '/v1/images/edits'), {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        ...(debugBody ? { 'x-koma-debug-body': '1' } : undefined),
        ...(debugBody ? { 'x-koma-trace-operation': 'tti.images.edits' } : undefined),
      },
      body: form as any,
    });
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`创建任务失败: ${raw.slice(0, 1200)}`);

    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      logger.warn('TTI images/edits response is not JSON', { preview: raw.slice(0, 1200) });
      throw new Error('API 返回了无法识别的图片响应（images/edits，非 JSON）');
    }

    // Most deployments keep OpenAI-like shape: { data: [{url|b64_json}] }
    let images = extractImageResultsFromGen(data as ImageGenResponse);
    if (!images.length) {
      images = findMediaUrlsDeep(data, this.config.baseUrl || '')
        .map(url => ({ path: url, url } satisfies ImageResult));
    }
    if (!images.length) {
      logger.warn('TTI images/edits response has no detectable media url', {
        provider: this.config.provider,
        response: sanitizeBodyForLog(data as any),
        rawPreview: raw.slice(0, 1200),
      });
      throw new Error('API 返回了无法识别的图片响应（images/edits）');
    }
    return { mode: 'immediate', output: createImmediateImageResult(images) };
  }

  // Grok2API endpoints are typically immediate; keep snapshot unimplemented for now.
  async getTaskSnapshot(_taskId: string): Promise<ProviderTaskSnapshot<ImageResult>> {
    return { state: 'failed', progress: 0, error: 'Grok2API TTI does not support task snapshots' };
  }
}
