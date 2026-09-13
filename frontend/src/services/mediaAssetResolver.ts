import type { ProviderAssetInput, StoredMediaAsset } from '../types';
import {
  getMediaAssetSource,
  isBlobUri,
  isDataUri,
  isRemoteMediaUri,
} from '../types';
import { electronService } from './electronService';
import { fromKomaLocalUrl } from '../utils/urlUtils';

export interface ResolveProviderAssetInputOptions {
  preferLocalFile?: boolean;
}

function inferMimeTypeFromSource(source: string, fallback = 'application/octet-stream'): string {
  if (source.startsWith('data:')) {
    const mime = source.slice(5, source.indexOf(';'));
    return mime || fallback;
  }

  const ext = source.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    default:
      return fallback;
  }
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  const binary = Array.from(bytes)
    .map(byte => String.fromCharCode(byte))
    .join('');
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// 把 electronService.fs.toLocalUrl 产出的 koma-local://files/<encoded path> 还原为真实
// 文件系统路径。其他形态的字符串原样返回。
export const decodeKomaLocalToFsPath = fromKomaLocalUrl;

export async function resolveProviderAssetInput(
  source: string | StoredMediaAsset | undefined,
  options?: ResolveProviderAssetInputOptions,
): Promise<ProviderAssetInput | undefined> {
  if (!source) {
    return undefined;
  }
  const candidates = typeof source === 'string'
    ? [source]
    : options?.preferLocalFile
      ? [
          getMediaAssetSource(source),
          source.remoteUrl && isRemoteMediaUri(source.remoteUrl) ? source.remoteUrl : undefined,
        ]
      : [
          source.remoteUrl && isRemoteMediaUri(source.remoteUrl) ? source.remoteUrl : undefined,
          getMediaAssetSource(source),
        ];

  const visited = new Set<string>();

  for (const resolved of candidates) {
    if (!resolved || visited.has(resolved)) {
      continue;
    }
    visited.add(resolved);

    if (isRemoteMediaUri(resolved)) {
      return {
        transport: 'remote-url',
        value: resolved,
        mimeType: typeof source === 'string' ? inferMimeTypeFromSource(resolved) : source?.mimeType,
      };
    }

    if (isDataUri(resolved)) {
      return {
        transport: 'data-url',
        value: resolved,
        mimeType: typeof source === 'string' ? inferMimeTypeFromSource(resolved) : source?.mimeType,
      };
    }

    if (isBlobUri(resolved)) {
      const response = await fetch(resolved);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mimeType = response.headers.get('content-type') || 'application/octet-stream';
      return {
        transport: 'data-url',
        value: toDataUrl(bytes, mimeType),
        mimeType,
      };
    }

    if (!electronService.isElectron()) {
      continue;
    }

    // 上游节点的产物经 buildMediaItem→toPreviewSource 包装为 `koma-local://...`，
    // 这里需要还原为真实路径才能落到 fs.exists / readFileAsBase64。
    const fsPath = decodeKomaLocalToFsPath(resolved);
    const exists = await electronService.fs.exists(fsPath);
    if (!exists) {
      continue;
    }

    const base64 = await electronService.fs.readFileAsBase64(fsPath);
    const mimeType = typeof source === 'string'
      ? inferMimeTypeFromSource(fsPath)
      : source?.mimeType || inferMimeTypeFromSource(fsPath);

    return {
      transport: 'data-url',
      value: `data:${mimeType};base64,${base64}`,
      mimeType,
    };
  }

  return undefined;
}

export async function resolveProviderAssetInputs(
  sources: Array<string | StoredMediaAsset | undefined>,
  options?: ResolveProviderAssetInputOptions,
): Promise<ProviderAssetInput[]> {
  const resolved = await Promise.all(sources.map(source => resolveProviderAssetInput(source, options)));
  return resolved.filter(Boolean) as ProviderAssetInput[];
}
