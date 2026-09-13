/**
 * 后台任务管理器（前端薄壳）
 *
 * Phase 1 重构：存储已下沉到主进程 settings.db / tasks 表。
 * 这里仅维护内存索引 + 监听器，所有持久化通过 tasksIPC 转发到主进程。
 *
 * 兼容老调用方：API 形状（createTask / updateTask / addListener / getProjectTasks 等）保持不变。
 *
 * Scope 约定：项目任务 → 'project:<projectId>'。
 */
import { v4 as uuidv4 } from 'uuid';
import { electronService } from './electronService';
import { createLogger } from '../store/logger';
import { DEFAULT_POLLING_CONFIG } from '../providers/polling';
import {
  getOwnWebContentsId,
  getTaskRecord,
  isTasksIpcAvailable,
  listTaskRecords,
  upsertTaskRecord,
  deleteTaskRecord,
  subscribeTaskUpdates,
  type TaskRecord,
} from './tasksIPC';

const logger = createLogger('TaskManager');

// ========== 任务分类 ==========

export type TaskCategory = 'prompt' | 'analysis' | 'asset' | 'script' | 'export';

export type TaskSubType =
  | 'image' | 'video' | 'audio'
  | 'shot-analysis' | 'shot-generation'
  | 'script-analysis'
  | 'asset-generation' | 'character-extraction'
  | 'prompt-generation' | 'prompt-optimization';

export type TaskType = 'script-analysis' | 'asset-generation' | 'shot-generation' | 'shot-analysis'
  | 'prompt-generation:image' | 'prompt-generation:video'
  | 'prompt-optimization:image' | 'prompt-optimization:video'
  | 'audio-generation';

export type TaskStatus = 'pending' | 'running' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type TaskTargetType = 'episode' | 'character' | 'scene' | 'prop' | 'shot';

export interface TaskRecoveryOptions {
  staleTimeoutMs: number;
  now?: () => number;
}

export interface Task {
  id: string;
  projectId: string;
  sessionId?: string;
  category?: TaskCategory;
  subType?: TaskSubType;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  targetType: TaskTargetType;
  targetId: string;
  targetName?: string;
  recoverable?: boolean;
  lastHeartbeat?: number;
  attempt?: number;
  maxRetries?: number;
  remoteTaskId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskParams {
  projectId: string;
  type?: TaskType;
  category?: TaskCategory;
  subType?: TaskSubType;
  targetType: TaskTargetType;
  targetId: string;
  targetName?: string;
  recoverable?: boolean;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

type TaskListener = (task: Task) => void;

const SCOPE_PREFIX = 'project:';

const FALLBACK_TYPE: TaskType = 'shot-analysis';

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
]);

function projectScope(projectId: string): string {
  return `${SCOPE_PREFIX}${projectId}`;
}

// 旧版 TaskType → category/subType 映射
function mapLegacyTaskType(type: TaskType): { category: TaskCategory; subType: TaskSubType } {
  const mapping: Record<string, { category: TaskCategory; subType: TaskSubType }> = {
    'script-analysis': { category: 'script', subType: 'script-analysis' },
    'asset-generation': { category: 'asset', subType: 'asset-generation' },
    'shot-generation': { category: 'analysis', subType: 'shot-generation' },
    'shot-analysis': { category: 'analysis', subType: 'shot-analysis' },
    'prompt-generation:image': { category: 'prompt', subType: 'image' },
    'prompt-generation:video': { category: 'prompt', subType: 'video' },
    'prompt-optimization:image': { category: 'prompt', subType: 'prompt-optimization' },
    'prompt-optimization:video': { category: 'prompt', subType: 'prompt-optimization' },
    'audio-generation': { category: 'asset', subType: 'audio' },
  };
  return mapping[type] || { category: 'analysis', subType: 'shot-analysis' };
}

// payload_json 里完整带住所有 Task 字段，column 只存索引/查询字段
function taskToRecord(task: Task): TaskRecord {
  const status = task.status;
  return {
    id: task.id,
    scope: projectScope(task.projectId),
    type: task.type || FALLBACK_TYPE,
    status,
    progress: typeof task.progress === 'number' ? task.progress : 0,
    targetKind: task.targetType,
    targetId: task.targetId,
    remoteTaskId: task.remoteTaskId ?? null,
    attempt: task.attempt ?? 0,
    maxRetries: task.maxRetries ?? 3,
    error: task.error ?? null,
    payload: { ...(task as unknown as Record<string, unknown>) },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    heartbeatAt: task.lastHeartbeat ?? null,
    completedAt: task.completedAt ?? null,
  };
}

function recordToTask(record: TaskRecord): Task | null {
  if (!record.scope.startsWith(SCOPE_PREFIX)) return null;
  const projectId = record.scope.slice(SCOPE_PREFIX.length);
  const payload = (record.payload || {}) as Partial<Task>;
  return {
    ...payload,
    id: record.id,
    projectId,
    type: (payload.type as TaskType) || (record.type as TaskType) || FALLBACK_TYPE,
    status: record.status as TaskStatus,
    progress: record.progress,
    targetType: ((payload.targetType ?? record.targetKind) as TaskTargetType) || 'shot',
    targetId: (payload.targetId ?? record.targetId ?? '') as string,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    error: record.error ?? undefined,
    remoteTaskId: record.remoteTaskId ?? undefined,
    attempt: record.attempt,
    maxRetries: record.maxRetries,
    completedAt: record.completedAt ?? undefined,
    lastHeartbeat: record.heartbeatAt ?? undefined,
  } as Task;
}

class TaskManagerClass {
  private tasks: Map<string, Task> = new Map();
  private listeners: Set<TaskListener> = new Set();
  private pollingInterval: NodeJS.Timeout | null = null;
  private initialized = false;
  private currentProjectId: string | null = null;
  private readonly sessionId = uuidv4();
  private unsubscribeRemote: (() => void) | null = null;
  private ownWebContentsId: number | null = null;

  /**
   * 初始化任务管理器
   * 从 SQLite 拉项目任务，订阅广播，启动轮询。
   */
  async initialize(projectId: string, options?: TaskRecoveryOptions): Promise<void> {
    if (this.initialized && this.currentProjectId === projectId) return;

    this.currentProjectId = projectId;
    this.tasks.clear();

    if (electronService.isElectron() && isTasksIpcAvailable()) {
      try {
        const records = await listTaskRecords({ scope: projectScope(projectId) });
        for (const record of records) {
          const task = recordToTask(record);
          if (task) this.tasks.set(task.id, task);
        }
        this.ownWebContentsId = await getOwnWebContentsId();
      } catch (err) {
        logger.error('Failed to load tasks from IPC', err);
      }
    }

    this.subscribeRemote();
    await this.reconcileInterruptedTasks(projectId);
    if (options) {
      await this.recoverTasks(projectId, options);
    }
    this.startPolling();
    this.initialized = true;
  }

  private subscribeRemote(): void {
    if (this.unsubscribeRemote) return;
    if (!electronService.isElectron() || !isTasksIpcAvailable()) return;
    this.unsubscribeRemote = subscribeTaskUpdates((record, kind, sourceId) => {
      const projectId = this.currentProjectId;
      if (!projectId || record.scope !== projectScope(projectId)) return;

      // 自写抑制：自身已经在 createTask/updateTask 路径里更新过 cache 并通知过 listeners
      if (
        this.ownWebContentsId !== null
        && sourceId !== undefined
        && sourceId === this.ownWebContentsId
      ) {
        return;
      }

      if (kind === 'delete') {
        const existed = this.tasks.get(record.id);
        if (existed) {
          this.tasks.delete(record.id);
          this.notifyListeners(existed);
        }
        return;
      }

      const task = recordToTask(record);
      if (!task) return;
      this.tasks.set(task.id, task);
      this.notifyListeners(task);
    });
  }

  private async reconcileInterruptedTasks(projectId: string): Promise<void> {
    const interruptedTasks = Array.from(this.tasks.values()).filter(task => {
      if (task.projectId !== projectId) return false;
      if (task.sessionId === this.sessionId) return false;
      return task.status === 'pending' || task.status === 'running' || task.status === 'processing';
    });

    for (const task of interruptedTasks) {
      this.updateTask(task.id, {
        status: 'failed',
        error: '任务在软件重启后中断',
      });
    }
  }

  createTask(params: CreateTaskParams): Task {
    const now = Date.now();

    let category = params.category;
    let subType = params.subType;
    let type = params.type;

    if (!category && !subType && type) {
      const mapped = mapLegacyTaskType(type);
      category = mapped.category;
      subType = mapped.subType;
    } else if (category && subType && !type) {
      type = `${category}-${subType}` as TaskType;
    }

    const task: Task = {
      id: uuidv4(),
      projectId: params.projectId,
      sessionId: this.sessionId,
      type: type || FALLBACK_TYPE,
      category,
      subType,
      status: 'pending',
      progress: 0,
      targetType: params.targetType,
      targetId: params.targetId,
      targetName: params.targetName,
      recoverable: params.recoverable ?? false,
      attempt: 0,
      maxRetries: params.maxRetries ?? 3,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
      lastHeartbeat: now,
    };

    this.tasks.set(task.id, task);
    void this.persist(task);
    this.notifyListeners(task);

    return task;
  }

  updateTask(taskId: string, updates: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      // 本地 cache 缺失（典型场景：用户切换项目后 dispose 清掉了当前 cache，但
      // service.runAnalysis / shotRender 等 Promise 仍在跑，仍要写进度/终态）。
      // 不能再静默返回 null，否则状态/结果丢失，主进程任务行永远停在 running，
      // 直到 delegateToRenderer 30 分钟超时才被标 failed。改走 IPC 兜底：异步
      // 拉 DB 现状 → 合并 → 持久化。返回值 null 仍兼容（无业务方依赖该返回）。
      void this.persistViaIpcOnly(taskId, updates);
      return null;
    }

    const now = Date.now();
    const updatedTask: Task = {
      ...task,
      ...updates,
      updatedAt: now,
      lastHeartbeat: now,
    };

    if (updates.status === 'running' && !task.startedAt) {
      updatedTask.startedAt = now;
    }
    if ((updates.status === 'completed' || updates.status === 'failed') && !task.completedAt) {
      updatedTask.completedAt = now;
    }

    this.tasks.set(taskId, updatedTask);
    void this.persist(updatedTask);
    this.notifyListeners(updatedTask);

    return updatedTask;
  }

  /**
   * 本地 cache 没有该任务时的兜底持久化路径：从主进程拉最新 record，合并 updates
   * 后再 upsert 回去。这样即便 TaskManager 已被 dispose（项目切换），后台仍在跑的
   * service 还能可靠地把进度/终态写到主进程任务表，触发广播让 UI 同步。
   *
   * 不写本地 cache、不通知本地 listeners：cache 都没了，本地也没人订阅；其它
   * renderer / tasksStore 走 tasks:updated 广播自然能感知。
   */
  private async persistViaIpcOnly(
    taskId: string,
    updates: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>,
  ): Promise<void> {
    if (!electronService.isElectron() || !isTasksIpcAvailable()) return;
    try {
      const record = await getTaskRecord(taskId);
      if (!record) return;
      const existing = recordToTask(record);
      if (!existing) return;
      // 已终态的任务不再被晚到的 service 写入覆盖。典型场景：用户取消任务后
      // service.runAnalysis 仍然跑完了所有阶段、最后写 'completed'，会盖掉
      // 'cancelled'。fallback 直接走 IPC 不经过 runWithTask 的 updateIfNotTerminal
      // 兜底，所以这里再守一道。
      if (TERMINAL_TASK_STATUSES.has(existing.status)) return;
      const now = Date.now();
      const merged: Task = {
        ...existing,
        ...updates,
        updatedAt: now,
        lastHeartbeat: now,
      };
      if (updates.status === 'running' && !existing.startedAt) {
        merged.startedAt = now;
      }
      if (
        (updates.status === 'completed' || updates.status === 'failed')
        && !existing.completedAt
      ) {
        merged.completedAt = now;
      }
      await upsertTaskRecord(taskToRecord(merged));
    } catch (err) {
      logger.error('Failed to persist task via IPC fallback', err);
    }
  }

  recordHeartbeat(taskId: string): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const updatedTask: Task = {
      ...task,
      lastHeartbeat: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }

  async recoverTasks(projectId: string, options: TaskRecoveryOptions): Promise<void> {
    const now = options.now ? options.now() : Date.now();
    const staleTasks = Array.from(this.tasks.values()).filter(t => {
      if (t.projectId !== projectId) return false;
      if (t.status !== 'running' && t.status !== 'processing') return false;
      const lastActive = t.lastHeartbeat || t.updatedAt;
      return (now - lastActive) > options.staleTimeoutMs;
    });

    for (const task of staleTasks) {
      const canResume = task.recoverable
        && !!task.remoteTaskId
        && (task.attempt || 0) < (task.maxRetries || 3);

      if (canResume) {
        this.updateTask(task.id, {
          status: 'pending',
          attempt: (task.attempt || 0) + 1,
          error: undefined,
        });
      } else {
        this.updateTask(task.id, {
          status: 'failed',
          error: task.remoteTaskId
            ? '任务在软件重启后中断（已超出重试上限）'
            : '任务在软件重启后中断（无法自动恢复，请重新触发）',
        });
      }
    }
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    this.tasks.delete(taskId);
    if (electronService.isElectron() && isTasksIpcAvailable()) {
      void deleteTaskRecord(taskId).catch(err =>
        logger.warn('Failed to remove task via IPC', err)
      );
    }
    this.notifyListeners(task);
    return true;
  }

  clearFinishedTasks(projectId: string): number {
    let removed = 0;
    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.projectId !== projectId) continue;
      if (task.status === 'completed' || task.status === 'failed') {
        this.tasks.delete(id);
        if (electronService.isElectron() && isTasksIpcAvailable()) {
          void deleteTaskRecord(id).catch(() => undefined);
        }
        removed++;
        this.notifyListeners(task);
      }
    }
    return removed;
  }

  getProjectTasks(projectId: string): Task[] {
    return Array.from(this.tasks.values())
      .filter(t => t.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getRunningTasks(projectId: string): Task[] {
    return this.getProjectTasks(projectId)
      .filter(t => t.status === 'pending' || t.status === 'running');
  }

  addListener(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(task: Task): void {
    this.listeners.forEach(listener => {
      try {
        listener(task);
      } catch (err) {
        logger.error('Task listener error', err);
      }
    });
  }

  private async persist(task: Task): Promise<void> {
    if (!electronService.isElectron() || !isTasksIpcAvailable()) return;
    try {
      await upsertTaskRecord(taskToRecord(task));
    } catch (err) {
      logger.error('Failed to persist task via IPC', err);
    }
  }

  private startPolling(): void {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks();
    }, DEFAULT_POLLING_CONFIG.interval);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async pollRunningTasks(): Promise<void> {
    // 具体业务方挂监听器自行接管
  }

  dispose(): void {
    this.stopPolling();
    if (this.unsubscribeRemote) {
      try { this.unsubscribeRemote(); } catch { /* noop */ }
      this.unsubscribeRemote = null;
    }
    this.tasks.clear();
    this.listeners.clear();
    this.initialized = false;
    this.currentProjectId = null;
  }
}

export const TaskManager = new TaskManagerClass();
export default TaskManager;
