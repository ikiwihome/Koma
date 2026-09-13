/**
 * 最近项目管理
 * 存储：主进程 app_settings_kv 表（key = 'recent-projects', value = RecentProject[]）
 * 非 Electron 环境降级到 localStorage。
 */
import { electronService } from '../../services/electronService';
import type { RecentProject } from '../../types';
import { STORAGE_KEYS } from '../../constants/storageKeys';

const KV_KEY = 'recent-projects';

type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

async function kvGet<T>(key: string): Promise<T | null> {
  const res = (await electronService.ipc.invoke('app-kv:get', { key })) as IpcResult<{ value: T | null; updatedAt: number | null }>;
  if (!res || typeof res !== 'object' || !('ok' in res) || res.ok === false) {
    return null;
  }
  return res.data?.value ?? null;
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  const res = (await electronService.ipc.invoke('app-kv:set', { key, value })) as IpcResult<unknown>;
  if (!res || typeof res !== 'object' || !('ok' in res) || res.ok === false) {
    throw new Error(`app-kv:set failed for ${key}`);
  }
}

export async function loadRecentProjects(): Promise<RecentProject[]> {
  if (!electronService.isElectron()) {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.RECENT_PROJECTS);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // ignore
    }
    return [];
  }

  try {
    const list = await kvGet<RecentProject[]>(KV_KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveRecentProjects(projects: RecentProject[]): Promise<void> {
  const trimmed = projects.slice(0, 20);

  if (!electronService.isElectron()) {
    localStorage.setItem(STORAGE_KEYS.RECENT_PROJECTS, JSON.stringify(trimmed));
    return;
  }

  await kvSet(KV_KEY, trimmed);
}

export async function addRecentProject(project: RecentProject): Promise<void> {
  const projects = await loadRecentProjects();
  const filtered = projects.filter((p) => p.id !== project.id);
  filtered.unshift({ ...project, lastOpened: Date.now() });
  await saveRecentProjects(filtered);
}

export async function removeRecentProject(projectId: string): Promise<void> {
  const projects = await loadRecentProjects();
  const filtered = projects.filter((p) => p.id !== projectId);
  await saveRecentProjects(filtered);
}
