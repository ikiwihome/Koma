/**
 * 剧集管理（通过 IPC 调后端 SQLite）
 */
import { v4 as uuidv4 } from 'uuid';
import { electronService, episodeApi } from '../../services/electronService';
import type { Episode } from '../../types';
import { getProjectPath } from './core';

export async function createEpisode(
  projectId: string,
  episode: Omit<Episode, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<Episode> {
  if (!electronService.isElectron()) {
    throw new Error('仅支持 Electron 环境');
  }

  const episodeId = uuidv4();
  const now = Date.now();

  const newEpisode: Episode = {
    id: episodeId,
    projectId,
    number: episode.number,
    title: episode.title,
    scriptText: episode.scriptText,
    status: episode.status || 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // 存入 SQLite
  await episodeApi.create({
    id: episodeId,
    project_id: projectId,
    episode_number: episode.number,
    title: episode.title,
    script_text: episode.scriptText,
    status: newEpisode.status,
    step_assets: newEpisode.stepProgress?.assets || 'pending',
    step_storyboard: newEpisode.stepProgress?.storyboard || 'pending',
    step_video: newEpisode.stepProgress?.video || 'pending',
    has_analysis: newEpisode.hasAnalysis ? 1 : 0,
    script_ready: newEpisode.scriptReady ? 1 : 0,
    created_at: now,
    updated_at: now,
  });

  // 仍然创建文件目录用于存放媒体文件
  const projectPath = await getProjectPath(projectId);
  const episodePath = `${projectPath}/episodes/${episodeId}`;
  await electronService.fs.mkdir(episodePath);
  await electronService.fs.mkdir(`${episodePath}/assets`);

  return newEpisode;
}

export async function loadEpisode(
  _projectId: string,
  episodeId: string
): Promise<Episode | null> {
  if (!electronService.isElectron()) return null;

  try {
    const row = await episodeApi.get(episodeId);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      number: row.episode_number,
      title: row.title || '',
      scriptText: row.script_text,
      status: row.status || 'draft',
      stepProgress: {
        assets: row.step_assets || 'pending',
        storyboard: row.step_storyboard || 'pending',
        video: row.step_video || 'pending',
      },
      hasAnalysis: Boolean(row.has_analysis),
      scriptReady: Boolean(row.script_ready),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export async function saveEpisode(
  projectId: string,
  episodeId: string,
  updates: Partial<Episode>
): Promise<Episode | null> {
  if (!electronService.isElectron()) return null;

  const episode = await loadEpisode(projectId, episodeId);
  if (!episode) return null;

  const updatedEpisode: Episode = {
    ...episode,
    ...updates,
    updatedAt: Date.now(),
  };

  await episodeApi.update(episodeId, {
    episode_number: updatedEpisode.number,
    title: updatedEpisode.title,
    script_text: updatedEpisode.scriptText,
    status: updatedEpisode.status,
    step_assets: updatedEpisode.stepProgress?.assets || 'pending',
    step_storyboard: updatedEpisode.stepProgress?.storyboard || 'pending',
    step_video: updatedEpisode.stepProgress?.video || 'pending',
    has_analysis: updatedEpisode.hasAnalysis ? 1 : 0,
    script_ready: updatedEpisode.scriptReady ? 1 : 0,
    updated_at: Date.now(),
  });

  return updatedEpisode;
}

export async function deleteEpisode(
  projectId: string,
  episodeId: string
): Promise<boolean> {
  if (!electronService.isElectron()) return false;

  try {
    await episodeApi.delete(episodeId);
    // 也删除文件目录
    const projectPath = await getProjectPath(projectId);
    try {
      await electronService.fs.remove(`${projectPath}/episodes/${episodeId}`);
    } catch {
      // 忽略
    }
    return true;
  } catch {
    return false;
  }
}

export async function listEpisodes(projectId: string): Promise<Episode[]> {
  if (!electronService.isElectron()) return [];

  try {
    const rows = await episodeApi.list(projectId);
    if (!Array.isArray(rows)) return [];

    const episodes: Episode[] = rows.map((row: any) => {
      return {
        id: row.id,
        projectId: row.project_id,
        number: row.episode_number,
        title: row.title || '',
        scriptText: row.script_text,
        status: row.status || 'draft',
        stepProgress: {
          assets: row.step_assets || 'pending',
          storyboard: row.step_storyboard || 'pending',
          video: row.step_video || 'pending',
        },
        hasAnalysis: Boolean(row.has_analysis),
        scriptReady: Boolean(row.script_ready),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }).filter(Boolean);

    return episodes.sort((a, b) => a.number - b.number);
  } catch {
    return [];
  }
}
