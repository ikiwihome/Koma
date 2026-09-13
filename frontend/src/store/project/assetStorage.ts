/**
 * 角色/场景/道具资产存储（通过 IPC 调后端 SQLite）
 */
import { electronService, batchApi } from '../../services/electronService';
import type { Prop } from '../../types';
import { getProjectPath } from './core';
import { loadShotMeta } from './shots';
import { normalizePropsMediaState } from './mediaState';

// ========== 角色资产（文件操作保留，元数据通过 IPC） ==========

export async function saveCharacterCostumePhoto(
  projectId: string,
  characterId: string,
  imagePath: string
): Promise<string> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const projectPath = await getProjectPath(projectId);
  const assetDir = `${projectPath}/assets/characters/${characterId}`;
  await electronService.fs.mkdir(assetDir);

  const destPath = `${assetDir}/costume.png`;
  await electronService.fs.copy(imagePath, destPath);

  return destPath;
}

export async function saveCharacterPreviewVideo(
  projectId: string,
  characterId: string,
  videoPath: string
): Promise<string> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const projectPath = await getProjectPath(projectId);
  const assetDir = `${projectPath}/assets/characters/${characterId}`;
  await electronService.fs.mkdir(assetDir);

  const destPath = `${assetDir}/preview.mp4`;
  await electronService.fs.copy(videoPath, destPath);

  return destPath;
}

// ========== 场景资产 ==========

export async function saveSceneImage(
  projectId: string,
  sceneId: string,
  imagePath: string
): Promise<string> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const projectPath = await getProjectPath(projectId);
  const assetDir = `${projectPath}/assets/scenes/${sceneId}`;
  await electronService.fs.mkdir(assetDir);

  const destPath = `${assetDir}/preview.png`;
  await electronService.fs.copy(imagePath, destPath);

  return destPath;
}

// ========== 道具资产 ==========

export async function savePropImage(
  projectId: string,
  propId: string,
  imagePath: string
): Promise<string> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const projectPath = await getProjectPath(projectId);
  const assetDir = `${projectPath}/assets/props/${propId}`;
  await electronService.fs.mkdir(assetDir);

  const destPath = `${assetDir}/reference.png`;
  await electronService.fs.copy(imagePath, destPath);

  return destPath;
}

export async function loadProps(projectId: string): Promise<Prop[]> {
  if (!electronService.isElectron()) return [];
  try {
    const raw = await batchApi.loadAllProps(projectId);
    return Array.isArray(raw) ? normalizePropsMediaState(raw.filter(Boolean)) : [];
  } catch {
    return [];
  }
}

export async function saveProps(projectId: string, props: Prop[]): Promise<void> {
  if (!electronService.isElectron()) return;
  await batchApi.saveAllProps(projectId, normalizePropsMediaState(props));
}

// ========== 分镜版本切换（通过 IPC） ==========

export async function switchShotVersion(
  projectId: string,
  shotId: string,
  version: number
): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  const shotMeta = await loadShotMeta(projectId, shotId);
  if (!shotMeta) {
    return;
  }

  const targetVersion = shotMeta.versions.find((v) => v.version === version);
  if (!targetVersion) {
    throw new Error(`版本 ${version} 不存在`);
  }

  shotMeta.currentVersion = version;
  await batchApi.saveShotMeta(projectId, shotId, shotMeta);
}

export async function deleteShotVersion(
  projectId: string,
  shotId: string,
  version: number
): Promise<boolean> {
  if (!electronService.isElectron()) {
    return false;
  }

  const shotMeta = await loadShotMeta(projectId, shotId);
  if (!shotMeta) {
    return false;
  }

  if (shotMeta.versions.length <= 1) {
    throw new Error('至少需要保留一个版本');
  }

  const versionIndex = shotMeta.versions.findIndex((v) => v.version === version);
  if (versionIndex === -1) {
    throw new Error(`版本 ${version} 不存在`);
  }

  // 删除版本文件
  const projectPath = await getProjectPath(projectId);
  const versionPath = `${projectPath}/shots/${shotId}/versions/v${version}`;
  try {
    await electronService.fs.remove(versionPath);
  } catch {
    // 忽略删除失败
  }

  shotMeta.versions.splice(versionIndex, 1);

  if (shotMeta.currentVersion === version) {
    const latestVersion = Math.max(...shotMeta.versions.map((v) => v.version));
    shotMeta.currentVersion = latestVersion;
  }

  await batchApi.saveShotMeta(projectId, shotId, shotMeta);

  return true;
}
