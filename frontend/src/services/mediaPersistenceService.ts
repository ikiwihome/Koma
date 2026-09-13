import type {
  MediaKind,
  MediaOwnerRef,
  StoredMediaAsset,
} from '../types';
import {
  getMediaAssetSource,
  isBlobUri,
  isDataUri,
  isRemoteMediaUri,
} from '../types';
import { electronService, fsWriteFileBuffer } from './electronService';
import { getProjectPath } from '../store/project/core';
import { createLogger } from '../store/logger';

const logger = createLogger('MediaPersistence');

interface PersistMediaParams {
  projectId: string;
  kind: MediaKind;
  source: string | StoredMediaAsset;
  destPath?: string;
  ownerRef?: MediaOwnerRef;
  mimeType?: string;
  provider?: string;
  providerTaskId?: string;
  channelId?: string;
  modelId?: string;
  capability?: string;
  metadata?: Record<string, unknown>;
}

function getExtension(kind: MediaKind, mimeType?: string, source?: string): string {
  const lower = mimeType?.toLowerCase();
  if (lower === 'image/jpeg') return 'jpg';
  if (lower === 'image/png') return 'png';
  if (lower === 'image/webp') return 'webp';
  if (lower === 'video/mp4') return 'mp4';
  if (lower === 'video/quicktime') return 'mov';
  if (lower === 'audio/mpeg') return 'mp3';
  if (lower === 'audio/wav') return 'wav';

  const safeExtFromName = (name: string): string | undefined => {
    const base = name.split('?')[0].split('#')[0];
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const ext = base.slice(dot + 1).toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(ext)) return undefined;
    return ext;
  };

  const inferMimeFromDataUri = (dataUrl: string): string | undefined => {
    // Examples:
    // data:image/jpeg;base64,...
    // data:image/png,...
    const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
    return match?.[1]?.toLowerCase();
  };

  if (source) {
    if (isDataUri(source)) {
      const inferredMime = inferMimeFromDataUri(source);
      return getExtension(kind, inferredMime, undefined);
    }

    if (isRemoteMediaUri(source)) {
      try {
        const url = new URL(source);
        const ext = safeExtFromName(url.pathname.split('/').pop() || '');
        if (ext) return ext;
      } catch {
        // Fall through to string-based inference.
      }
    }

    const ext = safeExtFromName(source.split('/').pop() || source);
    if (ext) return ext;
  }

  switch (kind) {
    case 'image':
      return 'png';
    case 'video':
      return 'mp4';
    case 'audio':
      return 'mp3';
    default:
      return 'bin';
  }
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const idx = filePath.lastIndexOf('/');
  if (idx === -1) return;
  await electronService.fs.mkdir(filePath.slice(0, idx));
}

async function buildDefaultDestPath(
  projectId: string,
  kind: MediaKind,
  ownerRef?: MediaOwnerRef,
  source?: string,
  mimeType?: string
): Promise<string> {
  const projectPath = await getProjectPath(projectId);
  const extension = getExtension(kind, mimeType, source);

  if (ownerRef?.ownerType === 'shot-version' && ownerRef.versionId) {
    return `${projectPath}/shots/${ownerRef.ownerId}/versions/${ownerRef.versionId}/${ownerRef.slot}.${extension}`;
  }

  if (ownerRef) {
    const folder = ownerRef.ownerType === 'scene'
      ? 'scenes'
      : ownerRef.ownerType === 'prop'
        ? 'props'
        : ownerRef.ownerType === 'character'
          ? 'characters'
          : `${ownerRef.ownerType}s`;

    return `${projectPath}/assets/${folder}/${ownerRef.ownerId}/${ownerRef.slot}.${extension}`;
  }

  return `${projectPath}/assets/generated/${kind}/${Date.now()}.${extension}`;
}

function stripDataHeader(dataUrl: string): string {
  const index = dataUrl.indexOf(',');
  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl;
}

function requiresAuthenticatedDownload(source: string): boolean {
  try {
    const url = new URL(source);
    return /\/v1\/videos\/[^/]+\/content$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export async function persistMediaAsset({
  projectId,
  kind,
  source,
  destPath,
  ownerRef,
  mimeType,
  provider,
  providerTaskId,
  channelId,
  modelId,
  capability,
  metadata,
}: PersistMediaParams): Promise<StoredMediaAsset> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const assetSource = typeof source === 'string' ? source : getMediaAssetSource(source);
  if (!assetSource) {
    throw new Error('缺少可持久化的媒体来源');
  }

  let finalMimeType = mimeType || (typeof source === 'string' ? undefined : source.mimeType);
  let targetPath = destPath || await buildDefaultDestPath(projectId, kind, ownerRef, assetSource, finalMimeType);

  logger.info('媒体落盘开始', {
    projectId,
    kind,
    ownerRef,
    sourceKind: isRemoteMediaUri(assetSource)
      ? 'remote-url'
      : isDataUri(assetSource)
        ? 'data-url'
        : isBlobUri(assetSource)
          ? 'blob-url'
          : 'path',
    sourcePreview: isDataUri(assetSource) ? `${assetSource.slice(0, 120)}...(data-url ${assetSource.length} chars)` : assetSource,
    targetPath,
    provider,
    providerTaskId,
    channelId,
    modelId,
    capability,
  });

  await ensureParentDirectory(targetPath);

  try {
    if (isRemoteMediaUri(assetSource)) {
      const authDownload = Boolean(channelId) && requiresAuthenticatedDownload(assetSource);
      const result = await electronService.fs.downloadFile(assetSource, targetPath, authDownload ? { channelId } : undefined);
      logger.info('远程媒体下载完成', { targetPath, size: result?.size, success: result?.success, authDownload });
      if (result?.path) {
        targetPath = result.path;
      }
      if (result?.mimeType) {
        finalMimeType = result.mimeType;
      }
    } else if (isDataUri(assetSource)) {
      await electronService.fs.writeFile(targetPath, stripDataHeader(assetSource), true);
    } else if (isBlobUri(assetSource)) {
      const response = await fetch(assetSource);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await fsWriteFileBuffer(targetPath, bytes);
    } else {
      await electronService.fs.copy(assetSource, targetPath);
    }
  } catch (error) {
    logger.error('媒体落盘失败', {
      projectId,
      kind,
      ownerRef,
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
    if (isRemoteMediaUri(assetSource)) {
      logger.warn('远程媒体落盘失败，使用远程 URL 作为显示兜底', {
        projectId,
        kind,
        ownerRef,
        remoteUrl: assetSource,
      });
      return {
        kind,
        remoteUrl: assetSource,
        provider: provider || (typeof source === 'string' ? undefined : source.provider),
        providerTaskId: providerTaskId || (typeof source === 'string' ? undefined : source.providerTaskId),
        width: typeof source === 'string' ? undefined : source.width,
        height: typeof source === 'string' ? undefined : source.height,
        durationMs: typeof source === 'string' ? undefined : source.durationMs,
        fps: typeof source === 'string' ? undefined : source.fps,
        channelId: channelId || (typeof source === 'string' ? undefined : source.channelId),
        modelId: modelId || (typeof source === 'string' ? undefined : source.modelId),
        capability: capability || (typeof source === 'string' ? undefined : source.capability),
        mimeType: finalMimeType || (typeof source === 'string' ? undefined : source.mimeType),
        metadata: {
          ...(typeof source === 'string' ? undefined : source.metadata),
          ...metadata,
          localPersistFailed: true,
          localPersistError: error instanceof Error ? error.message : String(error),
          attemptedLocalPath: targetPath,
        },
        createdAt: Date.now(),
      };
    }
    throw error;
  }

  logger.info('媒体落盘完成', {
    projectId,
    kind,
    ownerRef,
    localPath: targetPath,
    remoteUrl: typeof source === 'string'
      ? (isRemoteMediaUri(source) ? source : undefined)
      : source.remoteUrl,
  });

  return {
    kind,
    localPath: targetPath,
    remoteUrl: typeof source === 'string'
      ? (isRemoteMediaUri(source) ? source : undefined)
      : source.remoteUrl,
    mimeType: finalMimeType || (typeof source === 'string' ? undefined : source.mimeType),
    provider: provider || (typeof source === 'string' ? undefined : source.provider),
    providerTaskId: providerTaskId || (typeof source === 'string' ? undefined : source.providerTaskId),
    width: typeof source === 'string' ? undefined : source.width,
    height: typeof source === 'string' ? undefined : source.height,
    durationMs: typeof source === 'string' ? undefined : source.durationMs,
    fps: typeof source === 'string' ? undefined : source.fps,
    channelId: channelId || (typeof source === 'string' ? undefined : source.channelId),
    modelId: modelId || (typeof source === 'string' ? undefined : source.modelId),
    capability: capability || (typeof source === 'string' ? undefined : source.capability),
    metadata: {
      ...(typeof source === 'string' ? undefined : source.metadata),
      ...metadata,
    },
    createdAt: Date.now(),
  };
}
