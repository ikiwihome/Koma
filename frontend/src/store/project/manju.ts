/**
 * Manju-DSL 集成（通过 IPC 调后端 SQLite）
 *
 * 注：当前 Manju-DSL 不处理 timeline payload（应用内 timeline 数据模型已迁移到
 * types/editor.ts，与原 protocol 中的 Timeline 字段不兼容）。如需 round-trip
 * 应基于 types/editor.ts 的 Track/Clip 在 manju-dsl 中重写转换。
 *
 * 当前行为：检测到 timeline 时仅 warn 提示用户被丢弃，不参与导入导出。
 */
import { electronService, batchApi, type ProjectMeta as ElectronProjectMeta } from '../../services/electronService';
import type { ProjectMeta, Character, Scene, Shot } from '../../types';
import type { TimelineData } from '../../types/editor';
import {
  exportToManjuDSL,
  importFromManjuDSL,
  validateManjuProject,
  type ManjuProject,
} from '../../manju-dsl/protocol';
import { addRecentProject } from '../globalStore';
import { loadProject, getProjectPath } from './core';
import { loadTimeline } from './timeline';

function warnDroppedTimelineBoundary() {
  console.warn('[manju] Timeline round-trip is not supported for TimelineData-based transition projects yet. Timeline payload will be omitted.');
}

export function saveProjectAsManju(
  project: ProjectMeta,
  characters: Character[],
  scenes: Scene[],
  shots: Shot[],
  timeline?: TimelineData
): ManjuProject {
  if (timeline) {
    warnDroppedTimelineBoundary();
  }
  return exportToManjuDSL(project, characters, scenes, shots);
}

export function loadProjectFromManju(manjuData: ManjuProject) {
  if (!validateManjuProject(manjuData)) {
    throw new Error('无效的 Manju-DSL 数据格式');
  }
  return importFromManjuDSL(manjuData);
}

export async function exportProjectToManjuFile(
  projectId: string,
  characters: Character[],
  scenes: Scene[],
  shots: Shot[]
): Promise<string | null> {
  if (!electronService.isElectron()) return null;

  const project = await loadProject(projectId);
  if (!project) throw new Error('项目不存在');

  const timeline = await loadTimeline(projectId);
  if (timeline) {
    warnDroppedTimelineBoundary();
  }
  const manjuData = exportToManjuDSL(project, characters, scenes, shots);

  const projectPath = await getProjectPath(projectId);
  const exportPath = `${projectPath}/exports/${project.title}.manju.json`;
  await electronService.fs.writeFile(exportPath, JSON.stringify(manjuData, null, 2));

  return exportPath;
}

export async function importProjectFromManjuFile(filePath: string): Promise<ProjectMeta | null> {
  if (!electronService.isElectron()) return null;

  const content = await electronService.fs.readFile(filePath);
  const manjuData = JSON.parse(content);

  if (!validateManjuProject(manjuData)) {
    throw new Error('无效的 Manju-DSL 文件');
  }

  const imported = importFromManjuDSL(manjuData);
  let projectId = imported.project.id;
  const originalProjectPath = await getProjectPath(projectId);
  const exists = await electronService.fs.exists(originalProjectPath);
  if (exists) {
    projectId = `${projectId}_imported_${Date.now()}`;
    imported.project.id = projectId;
  }

  await electronService.project.create({
    id: projectId,
    title: imported.project.title,
    genre: imported.project.genre,
    mode: imported.project.mode,
    createdAt: imported.project.createdAt,
    updatedAt: imported.project.updatedAt,
  } satisfies ElectronProjectMeta);

  if (imported.timeline) {
    warnDroppedTimelineBoundary();
  }

  // 保存实体数据到 SQLite（通过 IPC）
  await batchApi.saveAllCharacters(projectId, imported.characters);
  await batchApi.saveAllScenes(projectId, imported.scenes);
  await batchApi.saveAllShots(projectId, imported.shots);

  const projectPath = await getProjectPath(projectId);

  await addRecentProject({
    id: projectId,
    title: imported.project.title,
    path: projectPath,
    lastOpened: Date.now(),
  });

  return imported.project;
}
