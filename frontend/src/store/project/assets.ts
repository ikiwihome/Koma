/**
 * 素材管理（通过 IPC 调后端 SQLite）
 */
import { v4 as uuidv4 } from 'uuid';
import { electronService } from '../../services/electronService';
import type { Asset } from '../../types';
import { getProjectPath } from './core';

async function computeFileHash(filePath: string): Promise<string> {
  try {
    const content = await electronService.fs.readFile(filePath);
    const size = content.length;
    const head = content.slice(0, 1000);
    const tail = content.slice(-1000);
    return `${size}-${hashString(head + tail)}`;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export async function importAsset(
  projectId: string,
  sourcePath: string,
  type: 'image' | 'video' | 'audio'
): Promise<Asset | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const stat = await electronService.fs.stat(sourcePath);
  if (!stat) {
    return null;
  }

  const fileHash = await computeFileHash(sourcePath);

  const existingAssets = await loadAssets(projectId);
  const duplicate = existingAssets.find(a => a.md5 === fileHash);
  if (duplicate) {
    return duplicate;
  }

  const timestamp = Date.now();
  const originalName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || 'file';
  const destName = `${timestamp}_${originalName}`;
  const destPath = `${projectPath}/assets/${type}s/${destName}`;

  await electronService.fs.copy(sourcePath, destPath);

  const asset: Asset = {
    id: uuidv4(),
    name: originalName,
    type: type === 'image' ? 'image' : type === 'video' ? 'video' : 'audio',
    path: destPath,
    size: stat.size,
    createdAt: Date.now(),
    refCount: 0,
    md5: fileHash,
  };

  // 追加到数据库
  const assets = await loadAssets(projectId);
  assets.push(asset);
  await saveAssets(projectId, assets);

  return asset;
}

export async function loadAssets(projectId: string): Promise<Asset[]> {
  if (!electronService.isElectron()) {
    return [];
  }

  try {
    const rows = await electronService.asset.list(projectId);
    if (!Array.isArray(rows)) return [];
    return rows.map((r: any) => {
      return {
        id: r.id,
        name: r.name || '',
        type: r.kind,
        path: r.local_path || '',
        thumbnailPath: r.thumbnail_path || undefined,
        duration: typeof r.duration_ms === 'number' ? r.duration_ms / 1000 : undefined,
        size: r.file_size || 0,
        width: r.width || undefined,
        height: r.height || undefined,
        createdAt: r.created_at,
        md5: r.fingerprint || undefined,
        refCount: r.ref_count || 0,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function saveAssets(projectId: string, assets: Asset[]): Promise<void> {
  const db = electronService.asset;
  const existing = await db.list(projectId);
  const existingIds = new Set(existing.map((item: any) => item.id));
  const nextIds = new Set(assets.map(asset => asset.id));

  for (const item of existing) {
    if (!nextIds.has(item.id)) {
      await db.delete(item.id);
    }
  }

  for (const asset of assets) {
    const payload = {
      id: asset.id,
      project_id: projectId,
      kind: asset.type || 'image',
      name: asset.name,
      local_path: asset.path,
      thumbnail_path: asset.thumbnailPath,
      duration_ms: typeof asset.duration === 'number' ? Math.round(asset.duration * 1000) : undefined,
      file_size: asset.size,
      width: asset.width,
      height: asset.height,
      fingerprint: asset.md5,
      ref_count: asset.refCount || 0,
      created_at: asset.createdAt || Date.now(),
    };
    if (existingIds.has(asset.id)) {
      await db.update(asset.id, payload);
    } else {
      await db.create(payload);
    }
  }
}

export async function findDuplicateAsset(
  projectId: string,
  filePath: string
): Promise<Asset | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const assets = await loadAssets(projectId);
  const newHash = await computeFileHash(filePath);

  for (const asset of assets) {
    if (asset.md5 === newHash) {
      return asset;
    }
  }
  return null;
}

export async function incrementAssetRef(
  projectId: string,
  assetId: string
): Promise<void> {
  if (!electronService.isElectron()) return;

  const assets = await loadAssets(projectId);
  const asset = assets.find(a => a.id === assetId);
  if (asset) {
    asset.refCount = (asset.refCount || 0) + 1;
    await saveAssets(projectId, assets);
  }
}

export async function decrementAssetRef(
  projectId: string,
  assetId: string
): Promise<void> {
  if (!electronService.isElectron()) return;

  const assets = await loadAssets(projectId);
  const asset = assets.find(a => a.id === assetId);
  if (asset && asset.refCount > 0) {
    asset.refCount -= 1;
    await saveAssets(projectId, assets);
  }
}

export async function getUnusedAssets(projectId: string): Promise<Asset[]> {
  const assets = await loadAssets(projectId);
  return assets.filter(a => (a.refCount || 0) === 0);
}

export async function cleanUnusedAssets(projectId: string): Promise<number> {
  if (!electronService.isElectron()) return 0;

  const assets = await loadAssets(projectId);
  const unusedAssets = assets.filter(a => (a.refCount || 0) === 0);
  const usedAssets = assets.filter(a => (a.refCount || 0) > 0);

  for (const asset of unusedAssets) {
    try {
      await electronService.fs.remove(asset.path);
    } catch {
      // 忽略删除失败
    }
  }

  await saveAssets(projectId, usedAssets);

  return unusedAssets.length;
}
