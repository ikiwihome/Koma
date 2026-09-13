import { getProjectITVProvider, getProjectTTIProvider } from '../../providers';
import type { ProviderAssetInput } from '../../types';
import type { AttachmentFile } from './ChatComposer';
import { uploadBytesToImageHostingWithRetry } from '../../services/imageHostingService';
import { ensureRemoteUrlForImageSource } from '../../services/mediaRemoteUrlService';
import { resolveProviderAssetInput } from '../../services/mediaAssetResolver';
import { createLogger } from '../../store/logger';

const logger = createLogger('ChatMediaGeneration');

export type ChatMediaMode =
  | 'chat'
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'start-end-to-video'
  | 'reference-to-video';

/** 视频子模式（UI 层） */
export type VideoSubMode = 'text' | 'image' | 'first-last' | 'multi-ref';

/** 视频子模式 → 后端 capability */
export function videoSubModeToCapability(sub: VideoSubMode): Exclude<ChatMediaMode, 'chat' | 'text-to-image' | 'image-to-image'> {
  switch (sub) {
    case 'text': return 'text-to-video';
    case 'image': return 'image-to-video';
    case 'first-last': return 'start-end-to-video';
    case 'multi-ref': return 'reference-to-video';
  }
}

export interface ChatImageRef {
  id: string;
  label: string;
  /**
   * 用于前端展示的源地址。优先级：
   *  - 直接上传 → 图床返回的 https URL
   *  - 历史生成 → koma-local:// 本地协议（带 Authorization）
   * 引用给 provider 之前会先看 remoteUrl，没有才回退用 source 走图床上传。
   */
  source: string;
  /**
   * 远程可访问 URL（生成路径在落盘前从 provider 拿到的原始 URL）。
   * 作为参考图传给上游时优先使用，避免每次都重新上传图床。
   */
  remoteUrl?: string;
  mimeType?: string;
  origin: 'upload' | 'generated';
  /** 是否还未跟随消息送出（true=本次输入暂存，false=已经在对话历史里） */
  pending?: boolean;
}

export interface ChatGeneratedMediaResult {
  images: ChatImageRef[];
  video?: string;
}

/**
 * generateChatMedia 调用结果：
 * - immediate：provider 直接返回结果，无需轮询
 * - async：拿到 taskId，调用方负责后续轮询（chatTaskRecovery）
 *
 * 不论同步异步，都带 taskKind / taskCapability / modelSelectionKey 给恢复用。
 */
export type ChatMediaStartResult =
  | {
      mode: 'immediate';
      images: ChatImageRef[];
      video?: string;
      taskKind: 'image' | 'video';
      taskCapability: string;
    }
  | {
      mode: 'async';
      taskId: string;
      taskKind: 'image' | 'video';
      taskCapability: string;
      modelSelectionKey?: string;
    };

/** 用户在输入框上选择的生图/生视频参数 */
export interface ChatMediaParams {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
}

/**
 * 一条媒体生成消息的完整元信息，存于 ChatMessage.metadata.mediaResult
 * 用于：
 *   - 渲染媒体结果卡片（标题/网格/按钮）
 *   - "重新编辑" 把参数还原到输入框
 *   - "再次生成" 用相同参数再触发一次
 */
export interface MediaResultMeta {
  kind: 'media-result';
  mode: Exclude<ChatMediaMode, 'chat'>;
  prompt: string;
  modelLabel?: string;
  modelSelectionKey?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  generating?: boolean;
  error?: string;
  images?: ChatImageRef[];
  video?: string;
  /** 触发时使用的源参考图（用于"再次生成"复刻） */
  sourceImageRefs?: ChatImageRef[];

  /**
   * 远程异步任务 ID（provider.start 返回 mode='async' 时存）。
   * 重启后凭此调 taskHandlerRegistry.getSnapshot 恢复轮询。
   */
  taskId?: string;
  /** 任务媒体类型，决定调哪个 TaskHandler（'image' → tti，'video' → itv） */
  taskKind?: 'image' | 'video' | 'audio';
  /** 任务能力，传给 provider.getTaskSnapshot 时需要 */
  taskCapability?: string;

  /** ReAct 意图路由产生的"思考"——为什么走当前 mode */
  thought?: string;
}

export const ASPECT_RATIO_OPTIONS = ['1:1', '21:9', '16:9', '3:2', '4:3', '3:4', '2:3', '9:16'] as const;
export const VIDEO_DURATION_OPTIONS = [5, 8, 10, 12] as const;
export const IMAGE_RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const;
export const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function detectChatMediaMode(text: string, attachments: AttachmentFile[] = []): ChatMediaMode {
  const lower = text.toLowerCase();
  const hasImageInput = attachments.some(a => a.type === 'image') || extractChatImageMentionLabels(text).length > 0;
  if (/图生视频|生视频|视频|动态|video|i2v/.test(lower) && hasImageInput) return 'image-to-video';
  if (/图生图|参考生图|垫图|改图|重绘|image-to-image|i2i/.test(lower) && hasImageInput) return 'image-to-image';
  if (/文生图|生图|生成图|画一张|出图|图片|image/.test(lower)) return hasImageInput ? 'image-to-image' : 'text-to-image';
  return 'chat';
}

export function extractChatImageMentionLabels(text: string): string[] {
  return Array.from(text.matchAll(/@图片(\d+)/g)).map(match => `图片${match[1]}`);
}

export function resolveChatImageReferences(params: {
  text: string;
  attachments: AttachmentFile[];
  imageRefs: ChatImageRef[];
  attachmentDataUrls: string[];
}): string[] {
  const mentioned = extractChatImageMentionLabels(params.text);
  const mentionedSources = mentioned
    .map(label => params.imageRefs.find(ref => ref.label === label)?.source)
    .filter(Boolean) as string[];
  if (mentionedSources.length > 0) return mentionedSources;
  return params.attachmentDataUrls;
}

export function stripChatImageMentions(text: string): string {
  return text.replace(/@图片\d+/g, '').replace(/\s+/g, ' ').trim();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToProviderInput(dataUrl: string): ProviderAssetInput {
  const mimeType = dataUrl.match(/^data:([^;,]+)/)?.[1];
  return { transport: 'data-url', value: dataUrl, mimeType };
}

function sourceToProviderInput(source: string): ProviderAssetInput {
  if (/^https?:\/\//i.test(source)) {
    return { transport: 'remote-url', value: source };
  }
  return dataUrlToProviderInput(source);
}

/**
 * Chat 参考图 → ProviderAssetInput。
 *  - preferLocal=true（provider 已声明 supportsLocalReferences）：
 *      koma-local:// 直接读盘转 data-url，绕开图床上传。https/data: 直接透传。
 *  - preferLocal=false（视频路径或未审计的 provider）：
 *      仍要求公网 URL，本地资产必须先上传图床。
 */
async function resolveChatReferenceForProvider(opts: {
  cand: { remoteUrl?: string; source: string };
  preferLocal: boolean;
}): Promise<ProviderAssetInput> {
  const { cand, preferLocal } = opts;

  if (preferLocal) {
    const resolved = await resolveProviderAssetInput(cand.source, { preferLocalFile: true });
    if (resolved) return resolved;
    if (cand.remoteUrl && /^https?:\/\//i.test(cand.remoteUrl)) {
      return { transport: 'remote-url', value: cand.remoteUrl };
    }
    throw new Error(`无法解析参考图：${cand.source.slice(0, 80)}`);
  }

  if (cand.remoteUrl && /^https?:\/\//i.test(cand.remoteUrl)) {
    return { transport: 'remote-url', value: cand.remoteUrl };
  }
  if (/^https?:\/\//i.test(cand.source)) {
    return { transport: 'remote-url', value: cand.source };
  }
  const normalized = await ensureRemoteUrlForImageSource({
    projectId: '__chat__',
    source: cand.source,
    policy: 'required',
  });
  if (typeof normalized === 'string' && /^https?:\/\//i.test(normalized)) {
    return { transport: 'remote-url', value: normalized };
  }
  throw new Error('上传参考图到图床失败：上游 API 需要可访问的远程 URL，请检查图床插件配置');
}

export async function imageAttachmentsToDataUrls(attachments: AttachmentFile[]): Promise<string[]> {
  return Promise.all(
    attachments
      .filter(a => a.type === 'image')
      .map(a => fileToDataUrl(a.file)),
  );
}

/**
 * 将图片附件上传到图床插件，返回远程 URL 列表（保持入参顺序）。
 * 未配置图床或上传失败时抛出错误，由调用方决定如何提示用户。
 */
export async function uploadAttachmentImagesToHosting(
  attachments: AttachmentFile[],
): Promise<string[]> {
  const imageAttachments = attachments.filter(a => a.type === 'image');
  if (imageAttachments.length === 0) return [];

  const urls: string[] = [];
  for (const attachment of imageAttachments) {
    const buf = await attachment.file.arrayBuffer();
    const result = await uploadBytesToImageHostingWithRetry(
      new Uint8Array(buf),
      { filename: attachment.file.name },
    );
    if (!result.success || !result.url) {
      throw new Error(result.error || `图片 ${attachment.file.name} 上传到图床失败`);
    }
    urls.push(result.url);
  }
  return urls;
}

/**
 * 从 TTI Provider 的 ImageResult 中拆出全部图源（含 metadata.batchImages 多张）。
 * 与分镜路径 (MediaGenerationService.getImmediateImageOutputs) 对齐，避免多图被截断成单图。
 */
export function getImageOutputSources(output: any): string[] {
  const batchImages = output?.metadata?.batchImages;
  if (Array.isArray(batchImages) && batchImages.length > 0) {
    return batchImages.map((item) => item.url || item.path).filter(Boolean);
  }
  return [output?.url || output?.path].filter(Boolean);
}

export function getChatMediaDisplaySource(source: string | undefined): string | undefined {
  return source;
}

export function createChatImageRefs(params: {
  sources: string[];
  origin: ChatImageRef['origin'];
  existingCount: number;
  mimeTypes?: Array<string | undefined>;
  /** 与 sources 一一对应的远程地址；缺省表示该位置没有远程 URL（落盘后会丢） */
  remoteUrls?: Array<string | undefined>;
}): ChatImageRef[] {
  return params.sources.map((source, index) => {
    const number = params.existingCount + index + 1;
    return {
      id: `chat-image-${Date.now()}-${number}-${Math.random().toString(36).slice(2, 8)}`,
      label: `图片${number}`,
      source,
      remoteUrl: params.remoteUrls?.[index],
      mimeType: params.mimeTypes?.[index],
      origin: params.origin,
    };
  });
}

/**
 * 启动一次媒体生成 — 不阻塞 polling。
 * - immediate：直接返回 images/video
 * - async：返回 taskId，调用方通过 chatTaskRecovery.pollChatMediaTask 轮询
 *
 * 旧的 generateChatMedia 函数（带 120 次硬编码 polling）已被替换；如有外部
 * 兼容需求，可在调用层 await polling 自行包装。
 */
export async function startChatMedia(params: {
  text: string;
  mode: Exclude<ChatMediaMode, 'chat'>;
  attachments: AttachmentFile[];
  imageRefs: ChatImageRef[];
  /**
   * 调用方已算好的"本次精确携带的图"（按顺序：pending + @ 引用 合并去重）。
   * 传了优先用；不传才回落 resolveChatImageReferences（仅看 @）。
   * 这是为了让 pending 但未 @ 的上传图也能进 provider request（reference-to-video 必需）。
   */
  refsToSend?: ChatImageRef[];
  ttiSelection?: string;
  itvSelection?: string;
  existingImageCount: number;
  mediaParams?: ChatMediaParams;
}): Promise<ChatMediaStartResult> {
  const attachmentDataUrls = await imageAttachmentsToDataUrls(params.attachments);
  const prompt = stripChatImageMentions(params.text);

  // 取参考图：优先使用 ref.remoteUrl（生成时拿到的远程 URL），没有再用 ref.source。
  // ref.source 可能是 koma-local://（历史生成，落盘了）或 https://（直接上传）或 data:（即时上传）。
  type RefCandidate = { remoteUrl?: string; source: string };
  const rawCandidates: RefCandidate[] = (params.refsToSend && params.refsToSend.length > 0)
    ? params.refsToSend.map(r => ({ remoteUrl: r.remoteUrl, source: r.source }))
    : resolveChatImageReferences({
        text: params.text,
        attachments: params.attachments,
        imageRefs: params.imageRefs,
        attachmentDataUrls,
      }).map(s => {
        // 通过 source 反查 ChatImageRef 拿 remoteUrl
        const ref = params.imageRefs.find(r => r.source === s);
        return { remoteUrl: ref?.remoteUrl, source: s };
      });

  const rawReferenceSources = rawCandidates.map(c => c.source);

  // ─── 图片生成 ─────────────────────────────────────
  // TTI 路径：先取 provider，按 provider.supportsLocalReferences 决定要不要上传图床。
  // OpenAI/Grok2/Gemini 这三家都直接吃 data-url，避免每次生图都重复走图床（也绕开 koma-local
  // 那条 IPC 二进制下载链路上的潜在故障）。
  if (params.mode === 'text-to-image' || params.mode === 'image-to-image') {
    const provider = await getProjectTTIProvider(params.ttiSelection, 'image.text-to-image');
    if (!provider) throw new Error('未配置 TTI 生图服务');
    const preferLocal = Boolean((provider as { supportsLocalReferences?: boolean }).supportsLocalReferences);

    const referenceInputs: ProviderAssetInput[] = [];
    for (const cand of rawCandidates) {
      const input = await resolveChatReferenceForProvider({ cand, preferLocal });
      referenceInputs.push(input);
    }

    if (params.mode === 'image-to-image' && referenceInputs.length === 0) {
      throw new Error('图生图需要上传图片或使用 @图片 引用历史图片');
    }

    logger.info('startChatMedia TTI 入口', {
      mode: params.mode,
      promptPreview: prompt.slice(0, 80),
      refsToSendCount: params.refsToSend?.length ?? 0,
      rawReferenceSourcesPreview: rawReferenceSources.map(s => s.slice(0, 80)),
      referenceInputsPreview: referenceInputs.map(r => `${r.transport}:${r.value.slice(0, 80)}`),
      preferLocal,
      ttiSelection: params.ttiSelection,
      mediaParams: params.mediaParams,
    });

    const ttiOptions: Record<string, unknown> = {};
    if (params.mediaParams?.aspectRatio) ttiOptions.aspectRatio = params.mediaParams.aspectRatio;
    if (params.mediaParams?.resolution) ttiOptions.imageSize = params.mediaParams.resolution;
    const requestedCount = Math.min(Math.max(params.mediaParams?.count ?? 1, 1), 9);
    const started = await provider.start({
      prompt,
      references: referenceInputs,
      count: requestedCount,
      options: Object.keys(ttiOptions).length > 0 ? ttiOptions as any : undefined,
    });
    if (started.mode === 'immediate') {
      const sources = getImageOutputSources(started.output);
      // provider 直接返回的 sources 通常是远程 URL —— 在这里就把它当 remoteUrl 存上，
      // 之后 ChatPage 落盘时会把 source 改成 koma-local://，但 remoteUrl 保留供下次引用直接用。
      const images = createChatImageRefs({
        sources,
        origin: 'generated',
        existingCount: params.existingImageCount,
        remoteUrls: sources.map(s => (/^https?:\/\//i.test(s) ? s : undefined)),
      });
      return {
        mode: 'immediate',
        images,
        taskKind: 'image',
        taskCapability: 'image.text-to-image',
      };
    }
    return {
      mode: 'async',
      taskId: started.taskId,
      taskKind: 'image',
      taskCapability: 'image.text-to-image',
      modelSelectionKey: params.ttiSelection,
    };
  }

  // ─── 视频生成 ─────────────────────────────────────
  // ITV provider 还没声明 supportsLocalReferences，保守地仍要求公网 URL：本地素材先走图床。
  const referenceSources: string[] = [];
  for (const cand of rawCandidates) {
    if (cand.remoteUrl && /^https?:\/\//i.test(cand.remoteUrl)) {
      referenceSources.push(cand.remoteUrl);
      continue;
    }
    if (/^https?:\/\//i.test(cand.source)) {
      referenceSources.push(cand.source);
      continue;
    }
    const normalized = await ensureRemoteUrlForImageSource({
      projectId: '__chat__',
      source: cand.source,
      policy: 'required',
    });
    if (typeof normalized === 'string' && /^https?:\/\//i.test(normalized)) {
      referenceSources.push(normalized);
    } else {
      throw new Error('上传参考图到图床失败：上游 API 需要可访问的远程 URL，请检查图床插件配置');
    }
  }

  logger.info('startChatMedia ITV 入口', {
    mode: params.mode,
    promptPreview: prompt.slice(0, 80),
    refsToSendCount: params.refsToSend?.length ?? 0,
    rawReferenceSourcesPreview: rawReferenceSources.map(s => s.slice(0, 80)),
    referenceSourcesPreview: referenceSources.map(s => s.slice(0, 80)),
    itvSelection: params.itvSelection,
    mediaParams: params.mediaParams,
  });

  // 入参校验
  if (params.mode === 'image-to-video' && referenceSources.length === 0) {
    throw new Error('图生视频需要至少 1 张参考图');
  }
  if (params.mode === 'start-end-to-video' && referenceSources.length < 2) {
    throw new Error('首尾帧视频需要按顺序提供 2 张参考图（首帧、尾帧）');
  }
  if (params.mode === 'reference-to-video' && referenceSources.length === 0) {
    throw new Error('多参考视频至少需要 1 张参考图');
  }

  const capabilityFor = `video.${params.mode}` as
    | 'video.text-to-video' | 'video.image-to-video'
    | 'video.start-end-to-video' | 'video.reference-to-video';
  const provider = await getProjectITVProvider(params.itvSelection, capabilityFor);
  if (!provider) throw new Error('未配置 ITV 视频生成服务（或当前模型不支持该子模式）');

  const itvOptions: Record<string, unknown> = {
    duration: params.mediaParams?.duration ?? 5,
  };
  if (params.mediaParams?.aspectRatio) itvOptions.aspectRatio = params.mediaParams.aspectRatio;

  let request: any;
  if (params.mode === 'text-to-video') {
    request = { capability: 'video.text-to-video', prompt, options: itvOptions };
  } else if (params.mode === 'image-to-video') {
    const [primary, ...rest] = referenceSources;
    request = {
      capability: 'video.image-to-video', prompt,
      primaryImage: sourceToProviderInput(primary),
      additionalReferences: rest.map(sourceToProviderInput),
      options: itvOptions,
    };
  } else if (params.mode === 'start-end-to-video') {
    const [start, end] = referenceSources;
    request = {
      capability: 'video.start-end-to-video', prompt,
      startFrame: sourceToProviderInput(start),
      endFrame: sourceToProviderInput(end),
      options: itvOptions,
    };
  } else {
    request = {
      capability: 'video.reference-to-video', prompt,
      referenceImages: referenceSources.map(sourceToProviderInput),
      options: itvOptions,
    };
  }

  // 诊断：把交给 ITV provider 的最终 request 打出来（裁剪长字段），定位"首帧没传 / 比例没生效"
  logger.info('ITV provider.start 调用前', {
    capability: capabilityFor,
    itvSelection: params.itvSelection,
    options: itvOptions,
    primaryImagePreview: (request.primaryImage?.value ?? '').slice(0, 80),
    additionalReferencesCount: request.additionalReferences?.length ?? 0,
    referenceImagesCount: request.referenceImages?.length ?? 0,
    startFramePreview: (request.startFrame?.value ?? '').slice(0, 80),
    endFramePreview: (request.endFrame?.value ?? '').slice(0, 80),
  });
  const started = await provider.start(request);
  if (started.mode === 'immediate') {
    return {
      mode: 'immediate',
      images: [],
      video: started.output.source,
      taskKind: 'video',
      taskCapability: capabilityFor,
    };
  }

  if (!provider.getTaskSnapshot) {
    throw new Error('当前 ITV 渠道返回异步任务，但不支持任务查询');
  }
  return {
    mode: 'async',
    taskId: started.taskId,
    taskKind: 'video',
    taskCapability: capabilityFor,
    modelSelectionKey: params.itvSelection,
  };
}
