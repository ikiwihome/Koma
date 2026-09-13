/**
 * OpenAI-Compatible TTI Provider
 * 兼容 OpenAI /v1/images/generations 接口的自定义文生图服务
 * 支持 url 和 b64_json 两种返回格式
 */
import type { TTIModelConfig, ProviderStartResult, ProviderTaskSnapshot } from '../../types';
import type { TTIProvider, TTIOptions, TTIRequest, ImageResult } from './types';
import { safeFetch } from '../../utils/safeFetch';
import { buildChannelAuthRequest } from '../channel/auth';
import { createLogger } from '../../store/logger';
import { parseDataUrl } from '../../utils/encoding';
import { resolveTTISize } from './utils/ttiSize';

function extFromMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * 把参考图（data-url 或 remote-url）取出 (bytes, mimeType) 用于 multipart。
 * 走 renderer 的 safeFetch — 不动 IPC、不写临时文件，绕开 fs controller
 * `assertPathAllowed` 的白名单（之前 os.tmpdir() 被该校验拒）。
 */
async function fetchReferenceBytes(
  ref: { transport: string; value: string; mimeType?: string },
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!ref?.value) {
    throw new Error('参考图为空');
  }
  if (ref.value.startsWith('data:')) {
    const parsed = parseDataUrl(ref.value);
    return {
      bytes: parsed.bytes,
      mimeType: parsed.mimeType || ref.mimeType || 'image/png',
    };
  }
  if (ref.transport === 'remote-url' || /^https?:\/\//i.test(ref.value)) {
    const resp = await safeFetch(ref.value);
    if (!resp || !resp.ok) {
      throw new Error(`下载参考图失败 (${resp?.status ?? 'no response'}): ${ref.value}`);
    }
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const mimeType = ref.mimeType
      || resp.headers.get('content-type')?.split(';')[0]
      || 'image/png';
    return { bytes, mimeType };
  }
  throw new Error(`不支持的参考图输入: ${ref.transport}:${ref.value}`);
}

const logger = createLogger('OpenAICompatibleTTI');

const OPENAI_COMPATIBLE_MAX_BATCH_IMAGES = 10;

/**
 * OpenAI 系图像模型 size 规则。三族不同：
 *
 * gpt-image-2（2026 发布）：不是固定白名单，按 4 条规则验合规
 *   - 最大边 ≤ 3840px
 *   - 两条边都是 16 的倍数
 *   - 长短边比 ≤ 3:1
 *   - 总像素 ∈ [655,360, 8,294,400]
 *   实际上能跑几千种分辨率；这里给一张常用比例对应的合规预设。
 *
 * gpt-image-1：固定白名单 1024x1024 / 1024x1536 / 1536x1024（OpenAI Cookbook 规格）。
 * dall-e-3：固定白名单 1024x1024 / 1024x1792 / 1792x1024。
 */
const OPENAI_IMAGE_ALLOWED_SIZES_FIXED = new Set([
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
]);

// gpt-image-2：常用比例 → 16-对齐合规预设。
// 16:9 用 2048x1152（精确 16:9 + 16 对齐 + 不到 2K，速度合理）。
// 用户若显式给 width/height，按上面 4 条规则现场验证后照搬。
const OPENAI_ASPECT_TO_SIZE_GPT_IMAGE_2: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '2048x1152',
  '9:16': '1152x2048',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1536x1152',
  '3:4': '1152x1536',
  '21:9': '2240x960',
  '9:21': '960x2240',
};

const OPENAI_ASPECT_TO_SIZE_GPT_IMAGE_1: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
};

const OPENAI_ASPECT_TO_SIZE_DALLE3: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '3:2': '1792x1024',
  '2:3': '1024x1792',
};

type OpenAIImageFamily = 'gpt-image-2' | 'gpt-image-1' | 'dall-e';

function isOpenAIImageModel(modelName: string): OpenAIImageFamily | null {
  const m = modelName.toLowerCase().trim();
  if (m.startsWith('gpt-image-2')) return 'gpt-image-2';
  if (m.startsWith('gpt-image')) return 'gpt-image-1';
  if (m.startsWith('dall-e')) return 'dall-e';
  return null;
}

/**
 * 校验 (W, H) 是否符合 gpt-image-2 的 4 条约束。
 */
function isValidGptImage2Size(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  if (longest > 3840) return false;
  if (longest / shortest > 3) return false;
  const pixels = width * height;
  if (pixels < 655360 || pixels > 8294400) return false;
  return true;
}

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
 * 模型可识别为 OpenAI 系时，按对应族的规则解析 size，避开 1920x1080 等 16-未对齐 / 不在白名单的值。
 * 否则透传给共享 resolveTTISize（其他 OpenAI 兼容上游可能接受任意 WxH）。
 */
function resolveOpenAITTISize(
  modelName: string,
  options: TTIOptions | undefined,
  defaultSize: string | undefined,
): string | undefined {
  const family = isOpenAIImageModel(modelName);
  if (!family) {
    return resolveTTISize(options, defaultSize);
  }

  // gpt-image-2：先尝试用户显式 width/height；只要满足 4 条约束就直接用
  if (family === 'gpt-image-2') {
    const w = options?.width;
    const h = options?.height;
    if (typeof w === 'number' && typeof h === 'number' && isValidGptImage2Size(w, h)) {
      return `${Math.round(w)}x${Math.round(h)}`;
    }
    const ratio = normalizeAspectRatioInput(options?.aspectRatio);
    if (ratio && OPENAI_ASPECT_TO_SIZE_GPT_IMAGE_2[ratio]) {
      return OPENAI_ASPECT_TO_SIZE_GPT_IMAGE_2[ratio];
    }
    if (defaultSize) {
      const m = defaultSize.match(/^(\d+)x(\d+)$/);
      if (m && isValidGptImage2Size(Number(m[1]), Number(m[2]))) {
        return defaultSize;
      }
    }
    return OPENAI_ASPECT_TO_SIZE_GPT_IMAGE_2['1:1'];
  }

  // gpt-image-1 / dall-e-3：固定白名单
  const table = family === 'dall-e'
    ? OPENAI_ASPECT_TO_SIZE_DALLE3
    : OPENAI_ASPECT_TO_SIZE_GPT_IMAGE_1;

  const w = options?.width;
  const h = options?.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    const explicit = `${Math.round(w)}x${Math.round(h)}`;
    if (OPENAI_IMAGE_ALLOWED_SIZES_FIXED.has(explicit)) return explicit;
  }
  const ratio = normalizeAspectRatioInput(options?.aspectRatio);
  if (ratio && table[ratio]) return table[ratio];

  if (defaultSize && OPENAI_IMAGE_ALLOWED_SIZES_FIXED.has(defaultSize)) return defaultSize;
  return table['1:1'];
}

function sanitizeBodyForLog(body: Record<string, any>): Record<string, any> {
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      if (v.startsWith('data:')) {
        return `${v.slice(0, 140)}...(data-url ${v.length} chars)`;
      }
      return v.length > 2000 ? `${v.slice(0, 800)}...(truncated, ${v.length} chars)` : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(body);
}

interface ImageData {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface CreateResponse {
  id?: string;
  created?: number;
  // 异步模式字段
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  // 同步模式：直接返回结果
  data?: ImageData[];
}

interface TaskResponse {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  result?: {
    type: string;
    data: ImageData[];
  };
  data?: ImageData[];
  error?: {
    code: string;
    message: string;
  };
}

export class OpenAICompatibleTTIProvider implements TTIProvider {
  type = 'openai-compatible-tti' as const;
  config: TTIModelConfig;
  /**
   * OpenAI 系走 /v1/images/edits multipart，data-url 经 parseDataUrl 直接解出字节；
   * 非 OpenAI 系兼容上游走 image_urls JSON，data-url 也能填入（部分上游支持）。
   * 因此可以让调用方跳过图床上传。
   */
  supportsLocalReferences = true;

  constructor(config: TTIModelConfig) {
    // 默认启用 Koma 协议（grok-image-index）：把 @角色名/@场景名/@道具名 编译为
    // @Image N 并对齐参考图上限，保持与 Koma官方Grok / Koma官方Nano banana 一致。
    this.config = { ...config, promptProtocol: config.promptProtocol ?? 'grok-image-index' };
  }

  private getModelName(): string {
    const value = String(this.config.modelName || '').trim();
    if (!value) {
      throw new Error('模型名称未配置');
    }
    return value;
  }

  private getBaseUrl(): string {
    return (this.config.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
  }

  private buildTaskSnapshotCandidates(taskId: string): string[] {
    return [`${this.getBaseUrl()}/v1/images/generations/${encodeURIComponent(taskId)}`];
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

  validate(): boolean {
    const hasCredentialRef = Boolean(this.config.profileId) || Boolean(this.config.apiKey);
    return hasCredentialRef && Boolean(this.config.baseUrl) && Boolean(String(this.config.modelName || '').trim());
  }

  async testConnection(): Promise<boolean> {
    if (!this.validate()) return false;

    try {
      const response = await safeFetch(`${this.getBaseUrl()}/v1/models`, {
        method: 'GET',
        headers: this.getAuthOnlyHeaders(),
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  private clampCount(value: unknown, max = OPENAI_COMPATIBLE_MAX_BATCH_IMAGES): number {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return 1;
    return Math.max(1, Math.min(max, Math.floor(normalized)));
  }

  /**
   * 从 ImageData 中提取可用的图片结果
   * 支持 url 和 b64_json 两种格式
   */
  private extractImageResult(item: ImageData): ImageResult | null {
    if (item.url) {
      return {
        path: item.url,
        url: item.url,
      };
    }
    if (item.b64_json) {
      const dataUrl = `data:image/jpeg;base64,${item.b64_json}`;
      return {
        path: dataUrl,
        url: dataUrl,
      };
    }
    return null;
  }

  private createImmediateOutput(items?: ImageData[]): ImageResult | null {
    const images = (items ?? [])
      .map(item => this.extractImageResult(item))
      .filter(Boolean) as ImageResult[];
    const first = images[0];
    if (!first) return null;
    if (images.length === 1) return first;
    return {
      ...first,
      metadata: {
        ...(first.metadata ?? {}),
        batchImages: images,
      },
    };
  }

  /**
   * OpenAI 标准图生图：POST /v1/images/edits + multipart/form-data。
   * 支持多张参考图通过 image[] 字段。上游 OpenAI 兼容网关强制要求 multipart，
   * 无法用 JSON body 替代。
   */
  private async startImageEdits(params: {
    modelName: string;
    prompt: string;
    references: Array<{ transport: string; value: string; mimeType?: string }>;
    n: number;
    size: string | undefined;
    debugBody: boolean;
  }): Promise<ProviderStartResult<ImageResult>> {
    const { modelName, prompt, references, n, size, debugBody } = params;

    const form = new FormData();
    form.append('model', modelName);
    form.append('prompt', prompt);
    form.append('n', String(n));
    if (size) form.append('size', size);

    // 先收集有效 refs（解析字节），再按数量决定字段名 — 防止循环里失败导致字段错乱。
    const validRefs: Array<{ bytes: Uint8Array; mimeType: string; index: number }> = [];
    for (let i = 0; i < references.length; i += 1) {
      const ref = references[i];
      if (!ref?.value) continue;
      const { bytes, mimeType } = await fetchReferenceBytes(ref);
      if (bytes && bytes.length > 0) {
        validRefs.push({ bytes, mimeType, index: i });
      }
    }
    // 防御：多 ref 全部解析失败时给清晰错；不要发空 multipart 让上游报 "Field required: image[]"
    if (validRefs.length === 0) {
      throw new Error('所有参考图都未能解析为有效字节（请检查参考图来源是否可用）');
    }

    // 按 OpenAI 官方协议切换字段名：1 张 → `image`；多张 → `image[]`
    // 之前统一用 `image[]` 依赖上游 adaptor 自动归一；新版 komaapi / new-api 在单图场景
    // 报 "Field required: image[]" → 上游没正确归一。改成跟 OpenAI 官方 SDK 一致按数量切。
    const imageFieldName = validRefs.length === 1 ? 'image' : 'image[]';
    for (const item of validRefs) {
      const filename = `image${item.index + 1}.${extFromMime(item.mimeType)}`;
      form.append(imageFieldName, new Blob([item.bytes], { type: item.mimeType }), filename);
    }

    if (debugBody) {
      logger.info('TTI images/edits (multipart) request', {
        provider: this.config.provider,
        model: modelName,
        size,
        n,
        refsCount: references.length,
        prompt,
      });
    }

    // multipart：手动覆盖 Content-Type 让浏览器自动加 boundary，所以不能用 getHeaders()（含 application/json）
    const response = await safeFetch(joinUrl(this.getBaseUrl(), '/v1/images/edits'), {
      method: 'POST',
      headers: {
        ...this.getAuthOnlyHeaders(),
        ...(debugBody ? { 'x-koma-debug-body': '1' } : undefined),
        ...(debugBody ? { 'x-koma-trace-operation': 'tti.edits' } : undefined),
      },
      body: form as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`创建任务失败: ${errorText}`);
    }

    const raw = await response.text();
    let data: CreateResponse;
    try {
      data = JSON.parse(raw) as CreateResponse;
    } catch {
      logger.warn('TTI images/edits response is not JSON', { preview: raw.slice(0, 600) });
      throw new Error('API 返回了无法识别的图片响应（images/edits，非 JSON）');
    }

    if (data.data?.[0]) {
      const output = this.createImmediateOutput(data.data);
      if (output) {
        return { mode: 'immediate', output };
      }
    }
    throw new Error('API 返回了无法识别的图片响应（images/edits，data 为空）');
  }

  /**
   * 生成图片
   * 同步返回（直接拿到结果）或异步（返回 taskId 轮询）
   */
  async start(request: TTIRequest): Promise<ProviderStartResult<ImageResult>> {
    if ((!this.config.apiKey && !this.config.profileId) || !this.config.baseUrl) {
      throw new Error('API Key 或 API 地址未配置');
    }
    if (!String(this.config.modelName || '').trim()) {
      throw new Error('模型名称未配置');
    }

    const options: TTIOptions | undefined = request.options;
    const count = this.clampCount(request.count);
    const protocol = (this.config as any)?.promptProtocol;
    const debugBody = Boolean(protocol) || (import.meta as any)?.env?.DEV === true;

    const body: Record<string, any> = {
      model: this.getModelName(),
      prompt: request.prompt,
      n: count,
    };

    // OpenAI 系（gpt-image-* / dall-e-*）走专用 size 表（白名单只接受 1024x1024 / 1024x1536 /
    // 1536x1024 / 1024x1792 / 1792x1024）；其他自建 OpenAI 兼容上游走通用 resolveTTISize。
    // 之前共用 resolveTTISize 对 16:9 输出 1920x1080，被 OpenAI 直接 400。
    const size = resolveOpenAITTISize(this.getModelName(), options, this.config.defaultSize);
    if (size) {
      body.size = size;
    }

    // 图生图分支：OpenAI 协议规范是 POST /v1/images/edits + multipart/form-data，
    // 而不是把 image_urls 塞进 /v1/images/generations 的 JSON body。
    // 之前一律走 generations 那条路，gpt-image-2 + komaapi 网关会把含 image_urls 的请求重新
    // 路由到 chat 模型，于是上游用对话语气回"请上传图片"。这里识别到 OpenAI 系模型 + 有参考图
    // 时切到 edits multipart。
    const refs = request.references || [];
    const openaiFamily = isOpenAIImageModel(this.getModelName());
    const useImageEdits = openaiFamily !== null && refs.length > 0;

    if (useImageEdits) {
      return this.startImageEdits({
        modelName: this.getModelName(),
        prompt: request.prompt,
        references: refs,
        n: count,
        size,
        debugBody,
      });
    }

    if (this.getModelName() === 'agnes-image-2.5-flash') {
      body.size = options?.imageSize || '1K';
      body.ratio = options?.aspectRatio || '9:16';
      body.extra_body = {
        response_format: 'url',
        ...(refs.length ? { image: refs.map(item => item.value) } : {}),
      };
    } else if (refs.length > 0) {
      // 非 OpenAI 系兼容上游：保留旧行为（部分自建上游接受 image_urls 字段）
      body.image_urls = refs.map(item => ({ url: item.value }));
    }

    if (debugBody) {
      logger.info('TTI start request body', {
        provider: this.config.provider,
        ...(protocol ? { promptProtocol: protocol } : undefined),
        size,
        requestedAspectRatio: options?.aspectRatio,
        defaultSize: this.config.defaultSize,
        body: sanitizeBodyForLog(body),
      });
    }

    const endpointPath = '/v1/images/generations';

    const response = await safeFetch(`${this.getBaseUrl()}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        ...(debugBody ? { 'x-koma-debug-body': '1' } : undefined),
        ...(debugBody ? { 'x-koma-trace-operation': 'tti.start' } : undefined),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`创建任务失败: ${errorText}`);
    }

    const data: CreateResponse = await response.json();

    // 同步模式：响应中直接包含图片数据
    if (data.data?.[0]) {
      const output = this.createImmediateOutput(data.data);
      if (output) {
        return {
          mode: 'immediate',
          output,
        };
      }
    }

    // 异步模式：返回 taskId
    if (data.id) {
      return { mode: 'async', taskId: data.id };
    }

    throw new Error('API 返回了无法识别的响应格式');
  }

  /**
   * 轮询任务状态（异步模式）
   */
  async getTaskSnapshot(taskId: string): Promise<ProviderTaskSnapshot<ImageResult>> {
    const candidates = this.buildTaskSnapshotCandidates(taskId);
    let data: TaskResponse | null = null;
    let lastStatus = 0;
    let matchedUrl = '';

    for (const url of candidates) {
      logger.info('TTI snapshot request', {
        provider: this.config.provider,
        taskId,
        url,
      });

      const response = await safeFetch(url, {
        method: 'GET',
        headers: this.getAuthOnlyHeaders(),
      });

      lastStatus = response.status;
      if (!response.ok) {
        continue;
      }

      data = await response.json();
      matchedUrl = url;
      break;
    }

    if (!data) {
      logger.error('TTI snapshot request failed', {
        provider: this.config.provider,
        taskId,
        candidates,
        status: lastStatus,
      });
      return {
        state: 'failed',
        progress: 0,
        error: '查询失败',
      };
    }

    logger.info('TTI snapshot response', {
      provider: this.config.provider,
      taskId,
      url: matchedUrl,
      status: data.status,
      progress: data.progress,
    });

    const stateMap: Record<string, ProviderTaskSnapshot<ImageResult>['state']> = {
      queued: 'queued',
      in_progress: 'running',
      completed: 'succeeded',
      failed: 'failed',
    };

    const snapshot: ProviderTaskSnapshot<ImageResult> = {
      state: stateMap[data.status] || 'running',
      progress: data.progress || 0,
    };

    if (data.status === 'completed') {
      const items = data.result?.data || data.data;
      if (items?.[0]) {
        const output = this.createImmediateOutput(items);
        if (output) {
          snapshot.output = output;
        }
      }
    }

    if (data.status === 'failed' && data.error) {
      snapshot.error = data.error.message || '任务失败';
    }

    return snapshot;
  }
}
