/**
 * 分镜版本管理（通过 IPC 调后端 SQLite）
 */
import { electronService, batchApi } from '../../services/electronService';
import type { ShotVersion, ShotMeta } from '../../types';
import { getProjectPath } from './core';
import { persistMediaAsset } from '../../services/mediaPersistenceService';
import {
  normalizeShotVersionMediaState,
  normalizeShotVersionsMediaState,
} from './mediaState';
import { createLogger } from '../logger';

const logger = createLogger('ProjectShots');

export async function saveShotVersion(
  projectId: string,
  shotId: string,
  version: Omit<ShotVersion, 'version' | 'createdAt'>
): Promise<ShotVersion> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const projectPath = await getProjectPath(projectId);
  const shotPath = `${projectPath}/shots/${shotId}`;
  await electronService.fs.mkdir(shotPath);

  let shotMeta: ShotMeta;
  try {
    const loaded = await batchApi.loadShotMeta(projectId, shotId);
    if (!loaded) throw new Error('missing');
    shotMeta = loaded;
  } catch {
    shotMeta = {
      id: shotId,
      prompt: version.prompt,
      seed: version.seed,
      model: version.model,
      currentVersion: 0,
      versions: [],
    };
  }

  const newVersion = shotMeta.currentVersion + 1;
  const versionPath = `${shotPath}/versions/v${newVersion}`;
  await electronService.fs.mkdir(versionPath);

  const normalizedInput = normalizeShotVersionMediaState({
    version: 0,
    ...version,
    createdAt: Date.now(),
  });

  const persistedMedia: NonNullable<ShotVersion['media']> = {};

  if (normalizedInput.media?.image) {
    persistedMedia.image = await persistMediaAsset({
      projectId,
      kind: 'image',
      source: normalizedInput.media.image,
      destPath: `${versionPath}/image.png`,
      ownerRef: {
        projectId,
        ownerType: 'shot-version',
        ownerId: shotId,
        slot: 'image',
        versionId: `v${newVersion}`,
      },
    });
  }

  if (normalizedInput.media?.video) {
    persistedMedia.video = await persistMediaAsset({
      projectId,
      kind: 'video',
      source: normalizedInput.media.video,
      destPath: `${versionPath}/video.mp4`,
      ownerRef: {
        projectId,
        ownerType: 'shot-version',
        ownerId: shotId,
        slot: 'video',
        versionId: `v${newVersion}`,
      },
    });
  }

  if (normalizedInput.media?.audio) {
    persistedMedia.audio = await persistMediaAsset({
      projectId,
      kind: 'audio',
      source: normalizedInput.media.audio,
      destPath: `${versionPath}/audio.mp3`,
      ownerRef: {
        projectId,
        ownerType: 'shot-version',
        ownerId: shotId,
        slot: 'audio',
        versionId: `v${newVersion}`,
      },
    });
  }

  const shotVersion = normalizeShotVersionMediaState({
    version: newVersion,
    media: persistedMedia,
    prompt: normalizedInput.prompt,
    seed: normalizedInput.seed,
    model: normalizedInput.model,
    createdAt: Date.now(),
  });

  shotMeta.currentVersion = newVersion;
  shotMeta.versions.push(shotVersion);
  shotMeta.prompt = version.prompt;
  shotMeta.seed = version.seed;
  shotMeta.model = version.model;

  // 保存到 SQLite
  await batchApi.saveShotMeta(projectId, shotId, shotMeta);

  return shotVersion;
}

export async function loadShotMeta(
  projectId: string,
  shotId: string
): Promise<ShotMeta | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  try {
    const parsed = await batchApi.loadShotMeta(projectId, shotId);
    if (!parsed) return null;
    return {
      ...parsed,
      versions: normalizeShotVersionsMediaState(parsed.versions || []),
    };
  } catch (err) {
    logger.warn('加载分镜元数据失败', { shotId, err });
    return null;
  }
}

export async function listShots(projectId: string): Promise<ShotMeta[]> {
  if (!electronService.isElectron()) {
    return [];
  }

  try {
    const metas = await batchApi.listShotMetas(projectId);
    if (!Array.isArray(metas)) return [];
    return metas.map((parsed: any) => ({
      ...parsed,
      versions: normalizeShotVersionsMediaState(parsed.versions || []),
    }));
  } catch (err) {
    logger.warn('列举分镜失败', { projectId, err });
    return [];
  }
}

export async function getShotVersionHistory(
  projectId: string,
  shotId: string
): Promise<import('../../types').ShotVersion[]> {
  if (!electronService.isElectron()) {
    return [];
  }

  const shotMeta = await loadShotMeta(projectId, shotId);
  if (!shotMeta) {
    return [];
  }

  return [...shotMeta.versions].sort((a, b) => b.version - a.version);
}
