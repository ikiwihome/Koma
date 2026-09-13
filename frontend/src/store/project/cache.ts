/**
 * 缓存管理
 */
import { electronService } from '../../services/electronService';
import { getProjectPath } from './core';

export interface CacheStats {
  thumbnails: { count: number; size: number };
  waveforms: { count: number; size: number };
  previews: { count: number; size: number };
  total: number;
}

export async function getCacheStats(projectId: string): Promise<CacheStats | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const stats: CacheStats = {
    thumbnails: { count: 0, size: 0 },
    waveforms: { count: 0, size: 0 },
    previews: { count: 0, size: 0 },
    total: 0,
  };

  const cacheDirs = ['thumbnails', 'waveforms', 'previews'] as const;

  for (const dir of cacheDirs) {
    try {
      const files = await electronService.fs.readdir(`${projectPath}/cache/${dir}`);
      for (const file of files) {
        const fileStat = await electronService.fs.stat(`${projectPath}/cache/${dir}/${file}`);
        if (fileStat) {
          stats[dir].count++;
          stats[dir].size += fileStat.size;
        }
      }
    } catch {
      // 目录不存在
    }
  }

  stats.total = stats.thumbnails.size + stats.waveforms.size + stats.previews.size;
  return stats;
}

export async function saveThumbnail(
  projectId: string,
  assetId: string,
  dataUrl: string
): Promise<string | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const thumbnailPath = `${projectPath}/cache/thumbnails/${assetId}.jpg`;

  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  await electronService.fs.writeFile(thumbnailPath, base64Data);

  return thumbnailPath;
}

export async function getThumbnail(
  projectId: string,
  assetId: string
): Promise<string | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const thumbnailPath = `${projectPath}/cache/thumbnails/${assetId}.jpg`;

  const exists = await electronService.fs.exists(thumbnailPath);
  return exists ? thumbnailPath : null;
}

export async function saveWaveform(
  projectId: string,
  assetId: string,
  waveformData: number[]
): Promise<string | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const waveformPath = `${projectPath}/cache/waveforms/${assetId}.json`;

  await electronService.fs.writeFile(waveformPath, JSON.stringify(waveformData));
  return waveformPath;
}

export async function getWaveform(
  projectId: string,
  assetId: string
): Promise<number[] | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const waveformPath = `${projectPath}/cache/waveforms/${assetId}.json`;

  try {
    const exists = await electronService.fs.exists(waveformPath);
    if (!exists) return null;
    const data = await electronService.fs.readFile(waveformPath);
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function savePreviewFrame(
  projectId: string,
  assetId: string,
  frameIndex: number,
  dataUrl: string
): Promise<string | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const previewPath = `${projectPath}/cache/previews/${assetId}_${frameIndex}.jpg`;

  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  await electronService.fs.writeFile(previewPath, base64Data);

  return previewPath;
}

export async function getPreviewFrame(
  projectId: string,
  assetId: string,
  frameIndex: number
): Promise<string | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  const projectPath = await getProjectPath(projectId);
  const previewPath = `${projectPath}/cache/previews/${assetId}_${frameIndex}.jpg`;

  const exists = await electronService.fs.exists(previewPath);
  return exists ? previewPath : null;
}

export async function clearCacheByType(
  projectId: string,
  type: 'thumbnails' | 'waveforms' | 'previews'
): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  const projectPath = await getProjectPath(projectId);
  await electronService.fs.remove(`${projectPath}/cache/${type}`);
  await electronService.fs.mkdir(`${projectPath}/cache/${type}`);
}

export async function clearCache(projectId: string): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  const projectPath = await getProjectPath(projectId);
  await electronService.fs.remove(`${projectPath}/cache`);
  await electronService.fs.mkdir(`${projectPath}/cache/thumbnails`);
  await electronService.fs.mkdir(`${projectPath}/cache/waveforms`);
  await electronService.fs.mkdir(`${projectPath}/cache/previews`);
}

export async function clearTemp(projectId: string): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  const projectPath = await getProjectPath(projectId);
  await electronService.fs.remove(`${projectPath}/temp`);
  await electronService.fs.mkdir(`${projectPath}/temp`);
}
