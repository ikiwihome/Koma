/**
 * 剧集解析结果存储（通过 IPC 调后端 SQLite）
 */
import { electronService, batchApi } from '../../services/electronService';
import type { EpisodeAnalysis, Shot } from '../../types';
import type { TimelineData } from '../../types/editor';
import { getProjectPath } from './core';
import { remapTimelineClipSourcesToLocal } from './mediaUrlRemap';
import { saveEpisode } from './episodes';
import { normalizeShotsMediaState } from './mediaState';
import { listShots } from './shots';
import { migrateTimelineData, prepareTimelineForSave } from '../../features/transition/core';
import { syncShotsSelectionFromVersionMetas } from '../../utils/shotVersionSelection';

function shouldRethrowTimelineError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unsupported timeline version:');
}

async function hydrateShotVersionSelections(projectId: string, shots: Shot[]): Promise<Shot[]> {
  if (!shots.length) return shots;
  try {
    const metas = await listShots(projectId);
    return syncShotsSelectionFromVersionMetas(shots, metas);
  } catch {
    return shots;
  }
}

export async function saveEpisodeAnalysis(
  projectId: string,
  episodeId: string,
  analysis: Omit<EpisodeAnalysis, 'episodeId' | 'createdAt' | 'updatedAt'>,
  options?: { resetStages?: boolean }
): Promise<EpisodeAnalysis> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const now = Date.now();

  const existing = await loadEpisodeAnalysis(projectId, episodeId);
  const completedStages = options?.resetStages
    ? (analysis.completedStages || [])
    : Array.from(new Set([
        ...(existing?.completedStages || []),
        ...(analysis.completedStages || []),
      ]));
  const result: EpisodeAnalysis = {
    episodeId,
    characterRefs: analysis.characterRefs ?? existing?.characterRefs ?? [],
    sceneRefs: analysis.sceneRefs ?? existing?.sceneRefs ?? [],
    propRefs: analysis.propRefs ?? existing?.propRefs ?? [],
    completedStages,
    shots: normalizeShotsMediaState(analysis.shots ?? existing?.shots ?? []),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await batchApi.saveAnalysis(projectId, episodeId, result);
  await saveEpisode(projectId, episodeId, { hasAnalysis: true });

  return result;
}

export async function loadEpisodeAnalysis(
  projectId: string,
  episodeId: string
): Promise<EpisodeAnalysis | null> {
  if (!electronService.isElectron()) return null;

  try {
    const parsed = await batchApi.loadAnalysis(projectId, episodeId);
    if (!parsed) return null;
    const shots = await hydrateShotVersionSelections(
      projectId,
      normalizeShotsMediaState(parsed.shots || []),
    );
    return {
      ...parsed,
      shots,
    };
  } catch {
    return null;
  }
}

export async function loadEpisodeShots(
  projectId: string,
  episodeId: string
): Promise<Shot[]> {
  const analysis = await loadEpisodeAnalysis(projectId, episodeId);
  return Array.isArray(analysis?.shots) ? analysis.shots.filter(Boolean) : [];
}

export async function saveEpisodeShots(
  projectId: string,
  episodeId: string,
  shots: Shot[]
): Promise<void> {
  if (!electronService.isElectron()) return;

  const now = Date.now();

  let analysis = await loadEpisodeAnalysis(projectId, episodeId);
  if (!analysis) {
    analysis = {
      episodeId,
      characterRefs: [],
      sceneRefs: [],
      propRefs: [],
      completedStages: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  analysis.shots = normalizeShotsMediaState(shots);
  analysis.updatedAt = now;

  // 从 shots 中自动提取资产引用
  const charSet = new Set(analysis.characterRefs || []);
  const sceneSet = new Set(analysis.sceneRefs || []);
  const propSet = new Set(analysis.propRefs || []);
  for (const shot of shots) {
    for (const id of shot.characters || []) { if (id) charSet.add(id); }
    for (const id of shot.scenes || []) { if (id) sceneSet.add(id); }
    for (const id of shot.props || []) { if (id) propSet.add(id); }
  }
  analysis.characterRefs = [...charSet];
  analysis.sceneRefs = [...sceneSet];
  analysis.propRefs = [...propSet];

  await batchApi.saveAnalysis(projectId, episodeId, analysis);
  await saveEpisode(projectId, episodeId, { hasAnalysis: true });
}

export async function loadEpisodeTimeline(
  projectId: string,
  episodeId: string
): Promise<TimelineData | null> {
  if (!electronService.isElectron()) return null;

  try {
    const data = await batchApi.loadEpisodeTimeline(projectId, episodeId);
    if (!data) return null;
    return migrateTimelineData(data);
  } catch (error) {
    if (shouldRethrowTimelineError(error)) {
      throw error;
    }
    return null;
  }
}

export async function saveEpisodeTimeline(
  projectId: string,
  episodeId: string,
  data: Omit<TimelineData, 'updatedAt'>
): Promise<void> {
  if (!electronService.isElectron()) return;

  const projectPath = await getProjectPath(projectId);

  const timelineData = prepareTimelineForSave({
    ...data,
    updatedAt: Date.now(),
  });

  const { timeline: remapped } = await remapTimelineClipSourcesToLocal(projectPath, timelineData as any);
  await batchApi.saveEpisodeTimeline(projectId, episodeId, remapped || timelineData);
}

export async function updateShot(
  projectId: string,
  episodeId: string,
  shotId: string,
  updates: Partial<Shot>
): Promise<Shot | null> {
  const shots = await loadEpisodeShots(projectId, episodeId);
  const index = shots.findIndex(s => s.id === shotId);
  if (index === -1) return null;

  const updatedShot = { ...shots[index], ...updates };
  shots[index] = updatedShot;
  await saveEpisodeShots(projectId, episodeId, shots);

  return updatedShot;
}

export async function removeAssetFromAnalysis(
  projectId: string,
  episodeId: string,
  assetId: string,
  assetType: 'character' | 'scene' | 'prop'
): Promise<void> {
  if (!electronService.isElectron()) return;

  const analysis = await loadEpisodeAnalysis(projectId, episodeId);
  if (!analysis) return;

  const refsKey = assetType === 'character' ? 'characterRefs'
    : assetType === 'scene' ? 'sceneRefs'
    : 'propRefs';
  const shotKey = assetType === 'character' ? 'characters'
    : assetType === 'scene' ? 'scenes'
    : 'props';

  const refs = analysis[refsKey];
  const safeRefs = Array.isArray(refs) ? refs : [];
  const hadRef = safeRefs.includes(assetId);
  const filteredRefs = safeRefs.filter((id: string) => id !== assetId);

  let shotsModified = false;
  const safeShots = Array.isArray(analysis.shots) ? analysis.shots : [];
  const updatedShots = safeShots.map(shot => {
    const arr = (shot as unknown as Record<string, unknown>)[shotKey];
    if (!Array.isArray(arr)) return shot;
    if (arr.includes(assetId)) {
      shotsModified = true;
      return { ...shot, [shotKey]: arr.filter((id: string) => id !== assetId) };
    }
    return shot;
  });

  if (!hadRef && !shotsModified) return;

  const updated = {
    ...analysis,
    [refsKey]: filteredRefs,
    shots: updatedShots,
    updatedAt: Date.now(),
  };

  await batchApi.saveAnalysis(projectId, episodeId, updated);
}

export async function deleteEpisodeAnalysis(
  projectId: string,
  episodeId: string
): Promise<boolean> {
  if (!electronService.isElectron()) return false;

  try {
    // 清除分析数据
    await batchApi.saveAnalysis(projectId, episodeId, null);
    await saveEpisode(projectId, episodeId, { hasAnalysis: false });
    return true;
  } catch {
    return false;
  }
}
