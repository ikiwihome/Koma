/**
 * 自动保存服务
 * 管理项目数据的自动保存和状态追踪
 */
import type { SaveStatus, ProjectSaveState } from '../types';
import { saveProject, saveCharacters, saveScenes, saveShots, saveProps } from './projectStore';
import { createLogger } from './logger';

const logger = createLogger('AutoSave');

// 保存状态管理
const saveStates: Map<string, ProjectSaveState> = new Map();
const saveTimers: Map<string, NodeJS.Timeout> = new Map();
const DEBOUNCE_DELAY = 1000; // 防抖延迟 1 秒

// 状态变更监听器
type SaveStateListener = (state: ProjectSaveState) => void;
const listeners: Set<SaveStateListener> = new Set();

/**
 * 订阅保存状态变更
 */
export function subscribeSaveState(listener: SaveStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 通知状态变更
 */
function notifyListeners(state: ProjectSaveState): void {
  listeners.forEach(listener => listener(state));
}

/**
 * 获取项目保存状态
 */
export function getSaveState(projectId: string): ProjectSaveState {
  return saveStates.get(projectId) || {
    projectId,
    status: 'saved',
  };
}

/**
 * 设置项目保存状态
 */
function setSaveState(projectId: string, status: SaveStatus, error?: string): void {
  const state: ProjectSaveState = {
    projectId,
    status,
    lastSavedAt: status === 'saved' ? Date.now() : saveStates.get(projectId)?.lastSavedAt,
    error,
  };
  saveStates.set(projectId, state);
  notifyListeners(state);
}

/**
 * 标记项目有未保存变更
 */
export function markDirty(projectId: string): void {
  const current = getSaveState(projectId);
  if (current.status !== 'saving') {
    setSaveState(projectId, 'dirty');
  }

  // 清除现有定时器
  const existingTimer = saveTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // 设置新的防抖定时器
  const timer = setTimeout(() => {
    triggerAutoSave(projectId);
  }, DEBOUNCE_DELAY);
  saveTimers.set(projectId, timer);
}

/**
 * 触发自动保存
 */
async function triggerAutoSave(projectId: string): Promise<void> {
  const current = getSaveState(projectId);
  if (current.status === 'saving') return;

  try {
    setSaveState(projectId, 'saving');
    await performSave(projectId);
    setSaveState(projectId, 'saved');
    logger.info(`项目 ${projectId} 自动保存成功`);
  } catch (err: any) {
    setSaveState(projectId, 'error', err.message);
    logger.error(`项目 ${projectId} 自动保存失败`, { error: err.message });
  }
}

/**
 * 手动保存项目
 */
export async function saveProjectNow(projectId: string): Promise<boolean> {
  // 清除防抖定时器
  const existingTimer = saveTimers.get(projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    saveTimers.delete(projectId);
  }

  try {
    setSaveState(projectId, 'saving');
    await performSave(projectId);
    setSaveState(projectId, 'saved');
    logger.info(`项目 ${projectId} 手动保存成功`);
    return true;
  } catch (err: any) {
    setSaveState(projectId, 'error', err.message);
    logger.error(`项目 ${projectId} 手动保存失败`, { error: err.message });
    return false;
  }
}

/**
 * 执行保存操作
 * 注意：这个函数需要访问项目数据，应该由调用方提供
 */
async function performSave(projectId: string): Promise<void> {
  // 获取待保存的数据（从全局状态或缓存）
  const pendingData = pendingProjectData.get(projectId);
  if (!pendingData) {
    logger.warn(`项目 ${projectId} 没有待保存数据`);
    return;
  }

  const { project, characters, scenes, shots, props } = pendingData;

  // 保存各部分数据
  if (project) {
    await saveProject(project);
  }
  if (characters) {
    await saveCharacters(projectId, characters);
  }
  if (scenes) {
    await saveScenes(projectId, scenes);
  }
  if (shots) {
    await saveShots(projectId, shots);
  }
  if (props) {
    await saveProps(projectId, props);
  }
}

// 待保存数据缓存
interface PendingProjectData {
  project?: any;
  characters?: any[];
  scenes?: any[];
  shots?: any[];
  props?: any[];
}

const pendingProjectData: Map<string, PendingProjectData> = new Map();

/**
 * 设置待保存数据
 */
export function setPendingData(
  projectId: string,
  data: Partial<PendingProjectData>
): void {
  const existing = pendingProjectData.get(projectId) || {};
  pendingProjectData.set(projectId, { ...existing, ...data });
  markDirty(projectId);
}

/**
 * 清除待保存数据
 */
export function clearPendingData(projectId: string): void {
  pendingProjectData.delete(projectId);
}

/**
 * 应用关闭前保存所有项目
 */
export async function saveAllBeforeExit(): Promise<void> {
  const dirtyProjects = Array.from(saveStates.entries())
    .filter(([_, state]) => state.status === 'dirty' || state.status === 'saving')
    .map(([id]) => id);

  if (dirtyProjects.length === 0) return;

  logger.info(`关闭前保存 ${dirtyProjects.length} 个项目`);

  await Promise.all(
    dirtyProjects.map(projectId => saveProjectNow(projectId))
  );
}

/**
 * 初始化保存钩子
 */
export function initSaveHooks(): void {
  // 监听页面关闭事件
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (e) => {
      const hasDirty = Array.from(saveStates.values()).some(
        state => state.status === 'dirty' || state.status === 'saving'
      );

      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '有未保存的更改，确定要离开吗？';
        // 尝试同步保存
        saveAllBeforeExit();
      }
    });

    // 监听键盘快捷键 Ctrl+S / Cmd+S
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // 保存当前项目（需要知道当前项目ID）
        const currentProjectId = getCurrentProjectId();
        if (currentProjectId) {
          saveProjectNow(currentProjectId);
        }
      }
    });
  }
}

// 当前项目ID获取函数（需要外部设置）
let getCurrentProjectIdFn: (() => string | null) | null = null;

export function setGetCurrentProjectId(fn: () => string | null): void {
  getCurrentProjectIdFn = fn;
}

function getCurrentProjectId(): string | null {
  return getCurrentProjectIdFn?.() || null;
}

/**
 * 清理项目相关的保存状态
 */
export function cleanupProjectSaveState(projectId: string): void {
  const timer = saveTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(projectId);
  }
  saveStates.delete(projectId);
  pendingProjectData.delete(projectId);
}
