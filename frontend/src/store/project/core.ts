/**
 * 项目核心管理
 * 项目创建、加载、保存、删除
 */
import { v4 as uuidv4 } from 'uuid';
import { electronService, type ProjectMeta as ElectronProjectMeta } from '../../services/electronService';
import { getStorageConfig, initStorageConfig } from '../storageConfig';
import { addRecentProject } from '../globalStore';
import type { MediaModelSelection, ProjectMeta } from '../../types';

// ========== 路径工具 ==========

export async function getProjectsRoot(): Promise<string> {
  const config = getStorageConfig() || (await initStorageConfig());
  return `${config.rootPath}/projects`;
}

export async function getProjectPath(projectId: string): Promise<string> {
  const root = await getProjectsRoot();
  return `${root}/${projectId}`;
}

function fromElectronProject(meta: ElectronProjectMeta): ProjectMeta {
  return {
    id: meta.id,
    title: meta.title,
    genre: meta.genre,
    mode: meta.mode,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    thumbnailPath: meta.thumbnail,
    aspectRatio: meta.aspectRatio,
    mediaSelections: meta.mediaSelections,
    stylePresetId: meta.stylePresetId,
    styleSnapshot: meta.styleSnapshot,
    theme: meta.theme,
    stylePrompt: meta.stylePrompt,
  };
}

function toElectronProject(meta: ProjectMeta): ElectronProjectMeta {
  return {
    id: meta.id,
    title: meta.title,
    genre: meta.genre,
    mode: meta.mode,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    thumbnail: meta.thumbnailPath,
    aspectRatio: meta.aspectRatio,
    mediaSelections: meta.mediaSelections,
    stylePresetId: meta.stylePresetId,
    styleSnapshot: meta.styleSnapshot,
    theme: meta.theme,
    stylePrompt: meta.stylePrompt,
  };
}

// ========== 项目管理 ==========

export async function createProject(
  title: string,
  genre: string,
  mode: 'drama' | 'narration',
  llmSelection?: MediaModelSelection,
  styleOptions?: { theme?: string; stylePrompt?: string }
): Promise<ProjectMeta> {
  const projectId = uuidv4();
  const now = Date.now();

  const project: ProjectMeta = {
    id: projectId,
    title,
    genre,
    mode,
    createdAt: now,
    updatedAt: now,
    mediaSelections: llmSelection ? { llm: llmSelection } : undefined,
    theme: styleOptions?.theme,
    stylePrompt: styleOptions?.stylePrompt,
  };

  if (electronService.isElectron()) {
    const created = await electronService.project.create(toElectronProject(project));
    const projectPath = await getProjectPath(created.id);

    await addRecentProject({
      id: created.id,
      title: created.title,
      path: projectPath,
      lastOpened: created.updatedAt,
    });

    return fromElectronProject(created);
  }

  return project;
}

export async function loadProject(projectId: string): Promise<ProjectMeta | null> {
  if (!electronService.isElectron()) {
    return null;
  }

  try {
    const project = await electronService.project.load(projectId);
    return project ? fromElectronProject(project) : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: ProjectMeta): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  project.updatedAt = Date.now();
  await electronService.project.update(project.id, toElectronProject(project));
}

export async function updateProjectLLMConfig(
  projectId: string,
  llmSelection: MediaModelSelection | null
): Promise<ProjectMeta | null> {
  const project = await loadProject(projectId);
  if (!project) return null;

  project.mediaSelections = {
    ...(project.mediaSelections || {}),
    ...(llmSelection ? { llm: llmSelection } : {}),
  };
  if (!llmSelection && project.mediaSelections) {
    delete project.mediaSelections.llm;
  }
  await saveProject(project);
  return project;
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!electronService.isElectron()) {
    return;
  }

  await electronService.project.remove(projectId);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  if (!electronService.isElectron()) {
    return [];
  }

  try {
    const projects = await electronService.project.list();
    return Array.isArray(projects) ? projects.map(fromElectronProject) : [];
  } catch {
    return [];
  }
}
