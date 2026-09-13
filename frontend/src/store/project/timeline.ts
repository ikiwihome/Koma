/**
 * 时间线管理（通过 IPC 调后端 SQLite）
 */
import { electronService, batchApi } from '../../services/electronService';
import type { TimelineData } from '../../types/editor';
import { getProjectPath } from './core';
import { remapTimelineClipSourcesToLocal } from './mediaUrlRemap';
import { migrateTimelineData, prepareTimelineForSave } from '../../features/transition/core';

function shouldRethrowTimelineError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unsupported timeline version:');
}

export async function loadTimeline(projectId: string): Promise<TimelineData | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  try {
    const data = await batchApi.loadProjectTimeline(projectId);
    if (!data) return null;
    return migrateTimelineData(data);
  } catch (error) {
    if (shouldRethrowTimelineError(error)) {
      throw error;
    }
    return null;
  }
}

export async function saveTimeline(
  projectId: string,
  timeline: TimelineData
): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  const projectPath = await getProjectPath(projectId);
  const normalizedTimeline = prepareTimelineForSave(timeline);
  const { timeline: remapped } = await remapTimelineClipSourcesToLocal(projectPath, normalizedTimeline as any);
  await batchApi.saveProjectTimeline(projectId, remapped || normalizedTimeline);
}
