/**
 * Remote URL normalization for image assets and sources.
 *
 * Motivation:
 * - Remote providers (especially ITV) typically cannot access local file paths.
 * - Some providers return base64/data-url outputs; after landing on disk we still need a remote URL
 *   for future referencing (tti refs / itv primary+refs).
 *
 * Design:
 * - Keep conversion logic centralized here.
 * - Keep resolver (mediaAssetResolver) pure: it resolves to ProviderAssetInput, it does not upload.
 */

import type { MediaAssetSource, ProviderAssetInput, StoredMediaAsset } from '../types';
import { isDataUri, isRemoteMediaUri } from '../types';
import { electronService } from './electronService';
import { createLogger } from '../store/logger';
import { uploadBytesToImageHostingWithRetry } from './imageHostingService';
import { base64ToBytes, stripDataHeader } from '../utils/encoding';
import { decodeKomaLocalToFsPath } from './mediaAssetResolver';
import { getProjectPath } from '../store/project/core';
import { safeFetch } from '../utils/safeFetch';

const logger = createLogger('MediaRemoteUrl');
const REMOTE_URL_CACHE_SCHEMA_VERSION = 1;
const REMOTE_URL_CACHE_PATH = 'metadata/media-remote-url-cache.json';
const REMOTE_URL_CHECK_TIMEOUT_MS = 5_000;

export type RemoteUrlPolicy = 'best-effort' | 'required';

export interface RemoteUrlUploadFailureOptions {
  /**
   * Keep the original source instead of throwing when a required image-hosting upload fails.
   * Default is false to preserve strict required behavior outside explicit fallback paths.
   */
  fallbackToSourceOnUploadFailure?: boolean;
}

interface RemoteUrlCacheEntry {
  sourceKey: string;
  sourceKind: 'local-file' | 'data-url' | 'provider-input' | 'asset' | 'unknown';
  localPath?: string;
  remoteUrl: string;
  filename?: string;
  byteLength?: number;
  mimeType?: string;
  updatedAt: number;
  lastVerifiedAt?: number;
}

interface RemoteUrlCacheFile {
  version: number;
  entries: Record<string, RemoteUrlCacheEntry>;
}

type RemoteUrlCacheLookupResult =
  | { status: 'hit'; remoteUrl: string }
  | { status: 'miss'; staleRemoteUrl?: string };

const remoteUrlInflightUploads = new Map<string, Promise<string | undefined>>();
const remoteUrlAccessibilityCache = new Map<string, Promise<boolean>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLocalSourcePath(source: string): string {
  return decodeKomaLocalToFsPath(source).replace(/\\/g, '/');
}

function hashStringForCacheKey(value: string): string {
  let left = 0xdeadbeef ^ value.length;
  let right = 0x41c6ce57 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    left = Math.imul(left ^ charCode, 2654435761);
    right = Math.imul(right ^ charCode, 1597334677);
  }

  left = Math.imul(left ^ (left >>> 16), 2246822507) ^ Math.imul(right ^ (right >>> 13), 3266489909);
  right = Math.imul(right ^ (right >>> 16), 2246822507) ^ Math.imul(left ^ (left >>> 13), 3266489909);

  return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

function createDataUrlCacheKey(source: string): string {
  return `data:${source.length}:${hashStringForCacheKey(source)}`;
}

function buildProviderInputCacheKey(source: ProviderAssetInput): string {
  return `${source.transport}:${source.value}`;
}

function buildRemoteUrlSourceKey(source: MediaAssetSource | ProviderAssetInput): string {
  if (typeof source === 'object' && 'transport' in source && 'value' in source) {
    if (source.transport === 'remote-url') return `remote:${source.value}`;
    if (isDataUri(source.value)) return createDataUrlCacheKey(source.value);
    return buildProviderInputCacheKey(source);
  }

  if (typeof source === 'object') {
    if (source.localPath) {
      if (isRemoteMediaUri(source.localPath)) return `remote:${source.localPath}`;
      if (isDataUri(source.localPath)) return createDataUrlCacheKey(source.localPath);
      return `local:${normalizeLocalSourcePath(source.localPath)}`;
    }
    if (source.remoteUrl) return `remote:${source.remoteUrl}`;
    return `asset:${JSON.stringify(source)}`;
  }

  if (isRemoteMediaUri(source)) return `remote:${source}`;
  if (isDataUri(source)) return createDataUrlCacheKey(source);
  return `local:${normalizeLocalSourcePath(source)}`;
}

function inferSourceKind(source: MediaAssetSource | ProviderAssetInput): RemoteUrlCacheEntry['sourceKind'] {
  if (typeof source === 'object' && 'transport' in source && 'value' in source) {
    return 'provider-input';
  }
  if (typeof source === 'object') {
    return 'asset';
  }
  if (isDataUri(source)) {
    return 'data-url';
  }
  if (!isRemoteMediaUri(source)) {
    return 'local-file';
  }
  return 'unknown';
}

function normalizeCacheFile(value: unknown): RemoteUrlCacheFile {
  if (!isRecord(value) || !isRecord(value.entries)) {
    return { version: REMOTE_URL_CACHE_SCHEMA_VERSION, entries: {} };
  }

  const entries: RemoteUrlCacheFile['entries'] = {};
  for (const [key, rawEntry] of Object.entries(value.entries)) {
    if (!isRecord(rawEntry)) continue;
    const remoteUrl = typeof rawEntry.remoteUrl === 'string' ? rawEntry.remoteUrl.trim() : '';
    if (!remoteUrl || !isRemoteMediaUri(remoteUrl)) continue;

    entries[key] = {
      sourceKey: typeof rawEntry.sourceKey === 'string' ? rawEntry.sourceKey : key,
      sourceKind: (
        rawEntry.sourceKind === 'local-file'
        || rawEntry.sourceKind === 'data-url'
        || rawEntry.sourceKind === 'provider-input'
        || rawEntry.sourceKind === 'asset'
        || rawEntry.sourceKind === 'unknown'
      ) ? rawEntry.sourceKind : 'unknown',
      localPath: typeof rawEntry.localPath === 'string' ? rawEntry.localPath : undefined,
      remoteUrl,
      filename: typeof rawEntry.filename === 'string' ? rawEntry.filename : undefined,
      byteLength: typeof rawEntry.byteLength === 'number' ? rawEntry.byteLength : undefined,
      mimeType: typeof rawEntry.mimeType === 'string' ? rawEntry.mimeType : undefined,
      updatedAt: typeof rawEntry.updatedAt === 'number' ? rawEntry.updatedAt : Date.now(),
      lastVerifiedAt: typeof rawEntry.lastVerifiedAt === 'number' ? rawEntry.lastVerifiedAt : undefined,
    };
  }

  return { version: REMOTE_URL_CACHE_SCHEMA_VERSION, entries };
}

async function getRemoteUrlCachePath(projectId: string): Promise<string> {
  const projectPath = await getProjectPath(projectId);
  return `${projectPath}/${REMOTE_URL_CACHE_PATH}`;
}

async function readRemoteUrlCache(projectId: string): Promise<RemoteUrlCacheFile> {
  if (!electronService.isElectron()) {
    return { version: REMOTE_URL_CACHE_SCHEMA_VERSION, entries: {} };
  }

  try {
    const cachePath = await getRemoteUrlCachePath(projectId);
    const exists = await electronService.fs.exists(cachePath);
    if (!exists) {
      return { version: REMOTE_URL_CACHE_SCHEMA_VERSION, entries: {} };
    }
    return normalizeCacheFile(JSON.parse(await electronService.fs.readFile(cachePath)));
  } catch (error) {
    logger.warn('读取远程图片 URL 缓存失败，忽略缓存', {
      projectId,
      error: stringifyUploadError(error),
    });
    return { version: REMOTE_URL_CACHE_SCHEMA_VERSION, entries: {} };
  }
}

async function writeRemoteUrlCache(projectId: string, cache: RemoteUrlCacheFile): Promise<void> {
  if (!electronService.isElectron()) return;

  try {
    const cachePath = await getRemoteUrlCachePath(projectId);
    const parent = cachePath.slice(0, cachePath.lastIndexOf('/'));
    await electronService.fs.mkdir(parent);
    await electronService.fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
  } catch (error) {
    logger.warn('写入远程图片 URL 缓存失败', {
      projectId,
      error: stringifyUploadError(error),
    });
  }
}

function withTimeoutSignal<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(`远程图片 URL 检测超时（>${timeoutMs / 1000} 秒）`));
    }, timeoutMs);

    promise.then(
      value => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      error => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function checkRemoteUrlAccessible(remoteUrl: string): Promise<boolean> {
  if (!isRemoteMediaUri(remoteUrl)) return false;
  let inflight = remoteUrlAccessibilityCache.get(remoteUrl);
  if (!inflight) {
    inflight = (async () => {
      try {
        let response = await withTimeoutSignal(
          safeFetch(remoteUrl, { method: 'HEAD' }),
          REMOTE_URL_CHECK_TIMEOUT_MS,
        );
        if (response.status === 405 || response.status === 403) {
          response = await withTimeoutSignal(
            safeFetch(remoteUrl, { method: 'GET', headers: { Range: 'bytes=0-0' } }),
            REMOTE_URL_CHECK_TIMEOUT_MS,
          );
        }
        return response.ok || response.status === 206 || response.status === 304;
      } catch (error) {
        logger.warn('远程图片 URL 可访问性检测失败', {
          remoteUrl,
          error: stringifyUploadError(error),
        });
        return false;
      }
    })();
    remoteUrlAccessibilityCache.set(remoteUrl, inflight);
    void inflight.then(
      () => remoteUrlAccessibilityCache.delete(remoteUrl),
      () => remoteUrlAccessibilityCache.delete(remoteUrl),
    );
  }
  return inflight;
}

async function lookupCachedRemoteUrl(params: {
  projectId: string;
  sourceKey: string;
  policy: RemoteUrlPolicy;
}): Promise<RemoteUrlCacheLookupResult> {
  const cache = await readRemoteUrlCache(params.projectId);
  const entry = cache.entries[params.sourceKey];
  if (!entry?.remoteUrl || !isRemoteMediaUri(entry.remoteUrl)) {
    return { status: 'miss' };
  }

  const accessible = await checkRemoteUrlAccessible(entry.remoteUrl);
  if (accessible) {
    cache.entries[params.sourceKey] = {
      ...entry,
      lastVerifiedAt: Date.now(),
    };
    void writeRemoteUrlCache(params.projectId, cache);
    logger.info('复用图片远程 URL 缓存', {
      projectId: params.projectId,
      sourceKey: params.sourceKey,
      remoteUrl: entry.remoteUrl,
      policy: params.policy,
    });
    return { status: 'hit', remoteUrl: entry.remoteUrl };
  }

  delete cache.entries[params.sourceKey];
  await writeRemoteUrlCache(params.projectId, cache);
  logger.warn('图片远程 URL 缓存失效，准备重新上传', {
    projectId: params.projectId,
    sourceKey: params.sourceKey,
    remoteUrl: entry.remoteUrl,
    policy: params.policy,
  });
  return { status: 'miss', staleRemoteUrl: entry.remoteUrl };
}

async function rememberCachedRemoteUrl(params: {
  projectId: string;
  source: MediaAssetSource | ProviderAssetInput;
  sourceKey: string;
  remoteUrl: string;
  filename?: string;
  byteLength?: number;
  mimeType?: string;
}): Promise<void> {
  if (!isRemoteMediaUri(params.remoteUrl)) return;

  const cache = await readRemoteUrlCache(params.projectId);
  const source = params.source;
  cache.entries[params.sourceKey] = {
    sourceKey: params.sourceKey,
    sourceKind: inferSourceKind(source),
    localPath: typeof source === 'object' && !('transport' in source)
      ? source.localPath
      : typeof source === 'string' && !isDataUri(source) && !isRemoteMediaUri(source)
        ? normalizeLocalSourcePath(source)
        : undefined,
    remoteUrl: params.remoteUrl,
    filename: params.filename,
    byteLength: params.byteLength,
    mimeType: params.mimeType,
    updatedAt: Date.now(),
    lastVerifiedAt: Date.now(),
  };
  await writeRemoteUrlCache(params.projectId, cache);
}

/**
 * MIME → 文件后缀。图床实际接受任何类型，但下游 provider / CDN 常按扩展名判 mime，
 * 因此视频音频要保留真实后缀（mp4 / mp3 / webm 等），不能统一 .png。
 */
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
};

function extensionFromMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSION_MAP[normalized];
}

function mimeTypeFromDataUrl(dataUrl: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1];
}

function defaultFilenameForMime(mimeType: string | undefined): string {
  const ext = extensionFromMimeType(mimeType);
  if (!ext) return 'asset.bin';
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'weba' || ext === 'aac' || ext === 'm4a' || ext === 'flac') {
    return `audio.${ext}`;
  }
  if (ext === 'mp4' || ext === 'mov' || ext === 'webm' || ext === 'mkv' || ext === 'avi') {
    return `video.${ext}`;
  }
  return `image.${ext}`;
}

function safeFilenameFromPath(path: string, mimeType?: string): string {
  const fallback = defaultFilenameForMime(mimeType);
  if (path.startsWith('data:')) return defaultFilenameForMime(mimeType || mimeTypeFromDataUrl(path));
  const name = path.split(/[/\\]/).pop() || fallback;
  // Avoid accidentally persisting huge data-url strings as a "filename".
  if (name.startsWith('data:')) return fallback;
  return name.length > 200 ? fallback : name;
}

function appendIndexToFilename(filename: string, index: number): string {
  const safe = filename || 'asset.bin';
  const dot = safe.lastIndexOf('.');
  if (dot <= 0) {
    return `${safe}-${index + 1}`;
  }
  return `${safe.slice(0, dot)}-${index + 1}${safe.slice(dot)}`;
}

function inferFilenameHintFromSource(
  source: MediaAssetSource | ProviderAssetInput | undefined,
): string {
  if (!source) {
    return 'asset.bin';
  }
  if (typeof source === 'object' && 'transport' in source && 'value' in source) {
    return safeFilenameFromPath(source.value, source.mimeType);
  }
  if (typeof source === 'object') {
    const stored = source as StoredMediaAsset;
    return safeFilenameFromPath(
      String(stored.localPath || stored.remoteUrl || ''),
      stored.mimeType,
    );
  }
  if (isDataUri(source)) {
    return safeFilenameFromPath(source, mimeTypeFromDataUrl(source));
  }
  return safeFilenameFromPath(source);
}

function stringifyUploadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function uploadImageBytesToRemoteUrl(
  bytes: Uint8Array,
  filename: string,
  policy: RemoteUrlPolicy,
  options?: RemoteUrlUploadFailureOptions
): Promise<string | undefined> {
  logger.info('开始上传媒体到图床', {
    filename,
    bytes: bytes.byteLength,
    policy,
  });
  let result: Awaited<ReturnType<typeof uploadBytesToImageHostingWithRetry>>;
  try {
    result = await uploadBytesToImageHostingWithRetry(bytes, { filename });
  } catch (error: unknown) {
    if (policy === 'required' && options?.fallbackToSourceOnUploadFailure) {
      logger.warn('图床 required 上传失败，已按方案 B fallback 到 data-url', {
        filename,
        policy,
        error: stringifyUploadError(error),
      });
      return undefined;
    }
    throw error;
  }

  if (result.success && result.url) {
    logger.info('媒体上传到图床成功', {
      filename,
      policy,
      remoteUrl: result.url,
    });
    return result.url;
  }

  if (policy === 'required') {
    if (options?.fallbackToSourceOnUploadFailure) {
      logger.warn('图床 required 上传失败，已按方案 B fallback 到 data-url', {
        filename,
        policy,
        error: result.error || '图床上传失败',
      });
      return undefined;
    }
    throw new Error(result.error || '图床上传失败');
  }

  logger.warn('图床上传失败 (best-effort)', { error: result.error });
  return undefined;
}

async function readBytesFromLocalFile(path: string): Promise<Uint8Array> {
  if (!electronService.isElectron()) {
    throw new Error('不支持的环境（需要 Electron）');
  }

  // 上游产物可能是 `koma-local://...` 显示 URL，先还原为真实文件系统路径。
  const fsPath = decodeKomaLocalToFsPath(path);

  const exists = await electronService.fs.exists(fsPath);
  if (!exists) {
    throw new Error(`本地文件不存在: ${fsPath}`);
  }

  const base64 = await electronService.fs.readFileAsBase64(fsPath);
  return base64ToBytes(base64);
}

async function readBytesFromDataUrl(dataUrl: string): Promise<Uint8Array> {
  const { base64 } = stripDataHeader(dataUrl);
  return base64ToBytes(base64);
}

/**
 * Ensure a StoredMediaAsset has a remoteUrl if possible.
 * Only applies to image assets.
 */
export async function ensureRemoteUrlForImageAsset(params: {
  projectId: string;
  asset: StoredMediaAsset;
  policy: RemoteUrlPolicy;
  filenameHint?: string;
} & RemoteUrlUploadFailureOptions): Promise<StoredMediaAsset> {
  const { asset, policy, filenameHint, fallbackToSourceOnUploadFailure } = params;

  if (asset.kind !== 'image') return asset;

  // If someone stored a remote URL in localPath, normalize it (no upload needed).
  if (asset.localPath && isRemoteMediaUri(asset.localPath)) {
    return {
      ...asset,
      remoteUrl: asset.localPath,
    };
  }

  if (asset.remoteUrl && isRemoteMediaUri(asset.remoteUrl) && !asset.localPath) {
    return asset;
  }

  const source = asset.localPath;
  if (!source) {
    if (policy === 'required') {
      throw new Error('缺少可上传的图片来源（localPath 为空）');
    }
    return asset;
  }

  const filename = filenameHint || safeFilenameFromPath(source, asset.mimeType);
  const sourceKey = buildRemoteUrlSourceKey(asset);
  const cached = await lookupCachedRemoteUrl({
    projectId: params.projectId,
    sourceKey,
    policy,
  });
  if (cached.status === 'hit') {
    return {
      ...asset,
      remoteUrl: cached.remoteUrl,
    };
  }

  const staleRemoteUrlFromCache = cached.status === 'miss' ? cached.staleRemoteUrl : undefined;
  if (
    asset.remoteUrl
    && isRemoteMediaUri(asset.remoteUrl)
    && asset.remoteUrl !== staleRemoteUrlFromCache
  ) {
    const accessible = await checkRemoteUrlAccessible(asset.remoteUrl);
    if (accessible) {
      await rememberCachedRemoteUrl({
        projectId: params.projectId,
        source: asset,
        sourceKey,
        remoteUrl: asset.remoteUrl,
        filename,
        mimeType: asset.mimeType,
      });
      return asset;
    }
    logger.warn('图片资产 remoteUrl 不可访问，准备重新上传', {
      projectId: params.projectId,
      remoteUrl: asset.remoteUrl,
      localPath: asset.localPath,
      policy,
    });
  }

  let bytes: Uint8Array;
  if (isDataUri(source)) {
    bytes = await readBytesFromDataUrl(source);
  } else {
    bytes = await readBytesFromLocalFile(source);
  }

  const uploadKey = `${params.projectId}:${sourceKey}`;
  let uploadPromise = remoteUrlInflightUploads.get(uploadKey);
  if (!uploadPromise) {
    uploadPromise = uploadImageBytesToRemoteUrl(bytes, filename, policy, {
      fallbackToSourceOnUploadFailure,
    });
    remoteUrlInflightUploads.set(uploadKey, uploadPromise);
    void uploadPromise.then(
      () => remoteUrlInflightUploads.delete(uploadKey),
      () => remoteUrlInflightUploads.delete(uploadKey),
    );
  } else {
    logger.info('复用进行中的图片上传任务', {
      projectId: params.projectId,
      sourceKey,
      filename,
      policy,
    });
  }
  const remoteUrl = await uploadPromise;
  if (remoteUrl) {
    await rememberCachedRemoteUrl({
      projectId: params.projectId,
      source: asset,
      sourceKey,
      remoteUrl,
      filename,
      byteLength: bytes.byteLength,
      mimeType: asset.mimeType,
    });
  }
  if (!remoteUrl) return asset;

  return {
    ...asset,
    remoteUrl,
  };
}

async function uploadSourceWithCache(params: {
  projectId: string;
  source: MediaAssetSource | ProviderAssetInput;
  bytes: Uint8Array;
  filename: string;
  policy: RemoteUrlPolicy;
  fallbackToSourceOnUploadFailure?: boolean;
  mimeType?: string;
}): Promise<string | undefined> {
  const sourceKey = buildRemoteUrlSourceKey(params.source);
  const cached = await lookupCachedRemoteUrl({
    projectId: params.projectId,
    sourceKey,
    policy: params.policy,
  });
  if (cached.status === 'hit') {
    return cached.remoteUrl;
  }

  const uploadKey = `${params.projectId}:${sourceKey}`;
  let uploadPromise = remoteUrlInflightUploads.get(uploadKey);
  if (!uploadPromise) {
    uploadPromise = uploadImageBytesToRemoteUrl(params.bytes, params.filename, params.policy, {
      fallbackToSourceOnUploadFailure: params.fallbackToSourceOnUploadFailure,
    });
    remoteUrlInflightUploads.set(uploadKey, uploadPromise);
    void uploadPromise.then(
      () => remoteUrlInflightUploads.delete(uploadKey),
      () => remoteUrlInflightUploads.delete(uploadKey),
    );
  } else {
    logger.info('复用进行中的图片上传任务', {
      projectId: params.projectId,
      sourceKey,
      filename: params.filename,
      policy: params.policy,
    });
  }

  const remoteUrl = await uploadPromise;
  if (remoteUrl) {
    await rememberCachedRemoteUrl({
      projectId: params.projectId,
      source: params.source,
      sourceKey,
      remoteUrl,
      filename: params.filename,
      byteLength: params.bytes.byteLength,
      mimeType: params.mimeType,
    });
  }
  return remoteUrl;
}

/**
 * Ensure a media source is remote-url compatible for remote providers.
 *
 * For strings: returns a remote URL string if possible.
 * For ProviderAssetInput: upgrades data-url to remote-url if policy requires.
 * For StoredMediaAsset: fills remoteUrl (and returns the updated asset).
 */
export async function ensureRemoteUrlForImageSource(params: {
  projectId: string;
  source: MediaAssetSource | ProviderAssetInput | undefined;
  policy: RemoteUrlPolicy;
  filenameHint?: string;
} & RemoteUrlUploadFailureOptions): Promise<MediaAssetSource | ProviderAssetInput | undefined> {
  const { source, policy, filenameHint, fallbackToSourceOnUploadFailure } = params;
  if (!source) return undefined;

  // Provider boundary input
  if (typeof source === 'object' && 'transport' in source && 'value' in source) {
    if (source.transport === 'remote-url') {
      return source;
    }
    // data-url -> remote-url
    const filename = filenameHint
      || defaultFilenameForMime(source.mimeType || mimeTypeFromDataUrl(source.value));
    const sourceKey = buildRemoteUrlSourceKey(source);
    const cached = await lookupCachedRemoteUrl({
      projectId: params.projectId,
      sourceKey,
      policy,
    });
    if (cached.status === 'hit') {
      return {
        transport: 'remote-url',
        value: cached.remoteUrl,
        mimeType: source.mimeType,
      };
    }

    const bytes = await readBytesFromDataUrl(source.value);
    const remoteUrl = await uploadSourceWithCache({
      projectId: params.projectId,
      source,
      bytes,
      filename,
      policy,
      fallbackToSourceOnUploadFailure,
      mimeType: source.mimeType,
    });
    if (!remoteUrl) return source;
    return {
      transport: 'remote-url',
      value: remoteUrl,
      mimeType: source.mimeType,
    };
  }

  // StoredMediaAsset
  if (typeof source === 'object') {
    return ensureRemoteUrlForImageAsset({
      projectId: params.projectId,
      asset: source as StoredMediaAsset,
      policy,
      filenameHint,
      fallbackToSourceOnUploadFailure,
    });
  }

  // string source
  if (isRemoteMediaUri(source)) {
    return source;
  }

  const filename = filenameHint
    || safeFilenameFromPath(source, isDataUri(source) ? mimeTypeFromDataUrl(source) : undefined);
  const sourceKey = buildRemoteUrlSourceKey(source);
  const cached = await lookupCachedRemoteUrl({
    projectId: params.projectId,
    sourceKey,
    policy,
  });
  if (cached.status === 'hit') {
    return cached.remoteUrl;
  }

  const bytes = isDataUri(source)
    ? await readBytesFromDataUrl(source)
    : await readBytesFromLocalFile(source);

  const remoteUrl = await uploadSourceWithCache({
    projectId: params.projectId,
    source,
    bytes,
    filename,
    policy,
    fallbackToSourceOnUploadFailure,
  });
  return remoteUrl || source;
}

export async function ensureRemoteUrlForImageSources(params: {
  projectId: string;
  sources: Array<MediaAssetSource | ProviderAssetInput | undefined>;
  policy: RemoteUrlPolicy;
  filenameHint?: string;
} & RemoteUrlUploadFailureOptions): Promise<Array<MediaAssetSource | ProviderAssetInput | undefined>> {
  const { sources, ...rest } = params;
  const results: Array<MediaAssetSource | ProviderAssetInput | undefined> = Array.from({ length: sources.length });
  const firstIndexBySourceKey = new Map<string, number>();

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source) {
      results[index] = undefined;
      continue;
    }
    const sourceKey = buildRemoteUrlSourceKey(source);
    const firstIndex = firstIndexBySourceKey.get(sourceKey);
    if (firstIndex != null) {
      const firstResult = results[firstIndex];
      logger.info('跳过重复媒体远程地址归一化', {
        index,
        firstIndex,
        policy: rest.policy,
        sourceKey,
      });
      results[index] = firstResult;
      continue;
    }
    firstIndexBySourceKey.set(sourceKey, index);

    const indexedFilenameHint = appendIndexToFilename(
      rest.filenameHint || inferFilenameHintFromSource(source),
      index,
    );
    logger.info('准备归一化媒体远程地址', {
      index,
      policy: rest.policy,
      filenameHint: indexedFilenameHint,
    });
    const normalized = await ensureRemoteUrlForImageSource({
      ...rest,
      source,
      filenameHint: indexedFilenameHint,
    });
    results[index] = normalized;
  }

  return results;
}
