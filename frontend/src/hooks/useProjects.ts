/**
 * 项目管理 Hook
 * 提供项目列表的加载、创建、更新、删除功能
 */
import { useState, useEffect, useCallback } from 'react';
import { electronService, ProjectMeta, isElectron } from '../services/electronService';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../store/logger';
import { createProjectStyleSnapshot, DEFAULT_THEME_PRESET_ID } from '../config/themePresets';

const logger = createLogger('useProjects');

export interface UseProjectsResult {
  projects: ProjectMeta[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createProject: (data: CreateProjectData) => Promise<ProjectMeta>;
  updateProject: (projectId: string, updates: Partial<ProjectMeta>) => Promise<ProjectMeta>;
  deleteProject: (projectId: string) => Promise<void>;
}

export interface CreateProjectData {
  title: string;
  mode: 'drama' | 'narration';
  aspectRatio?: '16:9' | '9:16';
  genre?: string;
  stylePresetId?: string;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    if (!isElectron()) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const list = await electronService.project.list();
      setProjects(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      logger.error('加载项目列表失败', err);
      setError(err instanceof Error ? err.message : '加载项目列表失败');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 创建项目
  const createProject = useCallback(async (data: CreateProjectData): Promise<ProjectMeta> => {
    const now = Date.now();
    const stylePresetId = data.stylePresetId || DEFAULT_THEME_PRESET_ID;
    const styleSnapshot = await createProjectStyleSnapshot(stylePresetId);
    const meta: ProjectMeta = {
      id: uuidv4(),
      title: data.title,
      genre: data.genre || (data.mode === 'drama' ? '剧情' : '解说'),
      mode: data.mode,
      aspectRatio: data.aspectRatio || '16:9',
      status: 'script',
      episodes: 1,
      createdAt: now,
      updatedAt: now,
      stylePresetId,
      styleSnapshot,
    };

    if (isElectron()) {
      const created = await electronService.project.create(meta);
      setProjects(prev => [created, ...prev]);
      return created;
    } else {
      // 浏览器模式：仅在内存中添加
      setProjects(prev => [meta, ...prev]);
      return meta;
    }
  }, []);

  // 更新项目
  const updateProject = useCallback(async (projectId: string, updates: Partial<ProjectMeta>): Promise<ProjectMeta> => {
    if (isElectron()) {
      const updated = await electronService.project.update(projectId, updates);
      setProjects(prev => prev.map(p => p.id === projectId ? updated : p));
      return updated;
    } else {
      const existing = projects.find(p => p.id === projectId);
      if (!existing) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const updated = { ...existing, ...updates, updatedAt: Date.now() };
      setProjects(prev => prev.map(p => p.id === projectId ? updated : p));
      return updated;
    }
  }, [projects]);

  // 删除项目
  const deleteProject = useCallback(async (projectId: string): Promise<void> => {
    if (isElectron()) {
      await electronService.project.remove(projectId);
    }
    setProjects(prev => prev.filter(p => p.id !== projectId));
  }, []);

  // 初始加载
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return {
    projects,
    loading,
    error,
    refresh: loadProjects,
    createProject,
    updateProject,
    deleteProject,
  };
}

export default useProjects;
