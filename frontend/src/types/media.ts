export type MediaKind = 'image' | 'video' | 'audio';

/**
 * 媒体输入源（服务层接收的“松散”形态）。
 *
 * - string: 本地路径 / 远程 URL / data: / blob:
 * - StoredMediaAsset: 已结构化的项目资产
 */
export type MediaAssetSource = string | StoredMediaAsset;

export interface ProviderAssetInput {
  transport: 'remote-url' | 'data-url';
  value: string;
  mimeType?: string;
}

/**
 * 结构化媒体资产。
 */
export interface StoredMediaAsset {
  kind: MediaKind;
  localPath?: string;
  remoteUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fps?: number;
  provider?: string;
  providerTaskId?: string;
  channelId?: string;
  modelId?: string;
  capability?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface MediaOwnerRef {
  projectId: string;
  ownerType: 'character' | 'scene' | 'prop' | 'shot' | 'shot-version';
  ownerId: string;
  slot:
    | 'costumePhoto'
    | 'previewImage'
    | 'previewVideo'
    | 'referenceImage'
    | 'image'
    | 'video'
    | 'audio'
    | 'gridImage';
  episodeId?: string;
  versionId?: string;
}

export type ProviderStartResult<T> =
  | { mode: 'immediate'; output: T }
  | { mode: 'async'; taskId: string };

export interface ProviderTaskSnapshot<T> {
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  progress?: number;
  output?: T;
  error?: string;
}

/**
 * 统一 request-based 媒体输入契约。
 *
 * - Provider 边界使用 ProviderAssetInput
 * - Service/workflow 边界可以用 MediaAssetSource（见泛型默认参数）
 */
export interface TTIRequest<TAsset = ProviderAssetInput, TOptions = Record<string, unknown>> {
  prompt: string;
  references?: TAsset[];
  options?: TOptions;
  count?: number;
}

export type VideoGenerationCapability =
  | 'video.text-to-video'
  | 'video.image-to-video'
  | 'video.reference-to-video'
  | 'video.start-end-to-video';

export interface ITVRequest<TAsset = ProviderAssetInput, TOptions = Record<string, unknown>> {
  capability: VideoGenerationCapability;
  prompt: string;
  primaryImage?: TAsset;
  additionalReferences?: TAsset[];
  referenceImages?: TAsset[];
  startFrame?: TAsset;
  endFrame?: TAsset;
  options?: TOptions;
  /**
   * Provider 之间通用的扩展元数据。compileVideoRequestPromptReferences 在 promptProtocol
   * = 'koma-jimeng' 时会写入 metadata.komaJimengAssets = { image_urls, video_urls, audio_urls }，
   * Provider 自行读取并塞到上游请求体的对应字段。
   */
  metadata?: Record<string, unknown>;
}

export interface TTSRequest<TOptions = Record<string, unknown>> {
  text: string;
  voiceId: string;
  options?: TOptions;
}

export interface CharacterMediaSlots {
  costumePhoto?: StoredMediaAsset;
  previewVideo?: StoredMediaAsset;
}

export interface SceneMediaSlots {
  previewImage?: StoredMediaAsset;
}

export interface PropMediaSlots {
  previewImage?: StoredMediaAsset;
  previewVideo?: StoredMediaAsset;
}

export interface ShotMediaState {
  references?: StoredMediaAsset[];
  images?: StoredMediaAsset[];
  videos?: StoredMediaAsset[];
  audios?: StoredMediaAsset[]; // 配音输出（多次生成保留历史，currentAudioIndex 指向当前选中）
  gridImage?: StoredMediaAsset; // 九宫格模式生成的 3×3 网格图
  selectedReferenceIndex?: number;
  currentImageIndex?: number;
  currentVideoIndex?: number;
  currentAudioIndex?: number;
}

export interface ShotVersionMediaState {
  image?: StoredMediaAsset;
  video?: StoredMediaAsset;
  audio?: StoredMediaAsset;
}

export function isTextToVideoRequest<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>
): request is ITVRequest<TAsset, TOptions> & { capability: 'video.text-to-video' } {
  return request.capability === 'video.text-to-video';
}

export function isImageToVideoRequest<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>
): request is ITVRequest<TAsset, TOptions> & {
  capability: 'video.image-to-video';
  primaryImage: TAsset;
} {
  return request.capability === 'video.image-to-video';
}

export function isReferenceToVideoRequest<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>
): request is ITVRequest<TAsset, TOptions> & {
  capability: 'video.reference-to-video';
  referenceImages: TAsset[];
} {
  return request.capability === 'video.reference-to-video';
}

export function isStartEndToVideoRequest<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>
): request is ITVRequest<TAsset, TOptions> & {
  capability: 'video.start-end-to-video';
  startFrame: TAsset;
  endFrame: TAsset;
} {
  return request.capability === 'video.start-end-to-video';
}

export function getITVRequestReferenceAssets<TAsset, TOptions>(
  request: ITVRequest<TAsset, TOptions>
): TAsset[] {
  if (isReferenceToVideoRequest(request)) {
    return request.referenceImages;
  }
  if (isImageToVideoRequest(request)) {
    return [
      request.primaryImage,
      ...(request.additionalReferences || []),
    ];
  }
  if (isStartEndToVideoRequest(request)) {
    return [request.startFrame, request.endFrame];
  }
  return [];
}

export function isRemoteMediaUri(value?: string): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}

export function isDataUri(value?: string): boolean {
  return Boolean(value && value.startsWith('data:'));
}

export function isBlobUri(value?: string): boolean {
  return Boolean(value && value.startsWith('blob:'));
}

export function getMediaAssetDisplaySource(asset?: StoredMediaAsset): string | undefined {
  if (!asset) return undefined;
  // Electron should prefer local files to avoid CORS and to keep ffmpeg/canvas pipelines working.
  // Browser mode cannot access localPath, so prefer remoteUrl there.
  const isElectronEnv = typeof window !== 'undefined'
    && Boolean((window as Window & { electronAPI?: unknown }).electronAPI);
  const localMissing = Boolean(asset.localPath && asset.metadata?.localPersistFailed);
  if (isElectronEnv && localMissing) {
    return asset.remoteUrl || asset.localPath;
  }
  return isElectronEnv
    ? (asset.localPath || asset.remoteUrl)
    : (asset.remoteUrl || asset.localPath);
}

export function getMediaAssetEditingSource(asset?: StoredMediaAsset): string | undefined {
  return asset?.localPath || asset?.remoteUrl;
}

export function getMediaAssetSource(asset?: StoredMediaAsset): string | undefined {
  return getMediaAssetEditingSource(asset);
}
