/**
 * 声明式任务调度框架
 *
 * 设计目的：消除业务代码到处手写 createTask/updateTask/markCompleted 的样板。
 * 业务方传一个 spec（任务标识 + execute 闭包 + 可选 persist 闭包），框架自动管理：
 *
 *   - 创建任务（TaskManager.createTask）+ 标记 running
 *   - 在 execute 内通过 TaskCtx.progress(percent, msg?) 推进
 *   - execute 返回值传给 persist（可选数据落盘）
 *   - 全程成功 → updateTask({ status: 'completed', progress: 100 })
 *   - 抛异常 → updateTask({ status: 'failed', error })，并把原异常 rethrow 让调用方决定
 *   - 失败时也会执行 onFailure 钩子（可选）方便清理
 *
 * 不替代 TaskManager 自身：所有任务持久化、恢复、监听仍走 TaskManager。
 * 本框架仅是"业务粒度的命令式包装"，让业务代码声明意图而不是写流程。
 *
 * 远程异步任务：execute 内可调 ctx.setRemoteTaskId(id) 让 TaskManager 记录
 * remoteTaskId 用于重启恢复（当 spec.recoverable=true 时生效）。
 */
import { TaskManager } from './TaskManager';
import type {
  Task,
  TaskCategory,
  TaskSubType,
  TaskTargetType,
  TaskType,
} from './TaskManager';
import { createLogger } from '../store/logger';

const logger = createLogger('TaskRunner');

/** 业务声明的任务规格 */
export interface TaskRunSpec<TResult, TPersisted = void> {
  // ===== 任务身份（用于 UI 显示与恢复）=====
  projectId: string;
  /** 任务大类（决定 UI 分组与图标） */
  category: TaskCategory;
  /** 任务子类型（UI 显示用） */
  subType: TaskSubType;
  /** 目标类型（episode / shot / character / scene / prop） */
  targetType: TaskTargetType;
  /** 目标 ID（用于去重 / 关联） */
  targetId: string;
  /** 显示名称（默认 = targetId） */
  targetName?: string;
  /** 兼容字段：旧版 TaskType；不传时 TaskManager 内部根据 category+subType 推导 */
  type?: TaskType;
  /**
   * 是否可恢复（启动时被 TaskManager 重新拉起）。默认 false。
   * 注意：仅对"远程异步任务"有意义 — 必须在 execute 内通过 ctx.setRemoteTaskId(id)
   * 注册远端任务 ID，TaskManager 才能在重启后通过 polling 继续追踪。
   * 本地 LLM 同步调用等任务即使设 true 也不会被恢复（无 remoteTaskId 时直接标 failed）。
   */
  recoverable?: boolean;
  /** 最大重试次数；仅当 recoverable=true 且 remoteTaskId 已设置时生效 */
  maxRetries?: number;
  /** 任意元数据，供 UI 或下游消费 */
  metadata?: Record<string, unknown>;

  // ===== 业务闭包 =====
  /**
   * 业务实际执行的逻辑。框架在调用前把任务标 running，调用后根据返回 / 抛错决定状态。
   * execute 内通过 ctx.progress() 推进。
   */
  execute: (ctx: TaskRunContext) => Promise<TResult>;

  /**
   * 可选：execute 成功后调用，把结果落盘到业务存储（DB / JSON 文件 / SQLite 等）。
   * 框架会把 persist 的耗时也算进任务总时长（先 90% 进 execute，最后 10% 进 persist）。
   * 如果 persist 抛错，整个任务标 failed。
   */
  persist?: (result: TResult) => Promise<TPersisted>;

  /**
   * 可选：失败时清理钩子（持久化失败、execute 抛错都会触发，幂等）。
   * 钩子内的错误会被吞掉（不会覆盖原始失败原因），但会打日志。
   */
  onFailure?: (error: unknown) => Promise<void> | void;

  /**
   * 是否禁用任务追踪（跳过创建 / 推进 TaskManager 任务）。
   * 用途：批量场景下父任务用 runWithTask 包裹，子任务传 disabled=true 避免任务面板被刷屏。
   * disabled=true 时 ctx.progress / setRemoteTaskId / setMetadata 都是 noop，execute 直接调用并返回结果。
   */
  disabled?: boolean;
}

/** execute 内可用的任务上下文 */
export interface TaskRunContext {
  /** 当前任务 ID（透传给 TaskManager 的） */
  readonly taskId: string;
  /**
   * 推进进度。percent 范围 [0, 100]；
   * 框架会自动把 90% 留给 execute、10% 留给 persist，所以传入 100 时实际任务总进度仍是 90%。
   */
  progress: (percent: number, message?: string) => void;
  /** 设置远程异步任务 ID（用于 polling 恢复） */
  setRemoteTaskId: (id: string) => void;
  /** 写入 metadata（合并到现有 metadata） */
  setMetadata: (patch: Record<string, unknown>) => void;
  /** 当前任务原始记录的快照（只读，主要给业务做条件分支） */
  readonly task: Task;
}

/** runWithTask 的最终返回值 */
export interface TaskRunResult<TResult, TPersisted = void> {
  /** 任务 ID */
  taskId: string;
  /** execute 的返回值 */
  result: TResult;
  /** persist 的返回值（如果 spec 提供 persist） */
  persisted: TPersisted;
}

/**
 * 声明式运行一个业务任务。
 *
 * @example
 * await runWithTask({
 *   projectId,
 *   category: 'script',
 *   subType: 'script-analysis',
 *   targetType: 'episode',
 *   targetId: episode.id,
 *   targetName: episode.title,
 *   execute: async (ctx) => {
 *     ctx.progress(20, '加载模板');
 *     const prompt = await resolvePromptTemplate('character_extraction', { script });
 *     ctx.progress(60, '调用 LLM');
 *     return await llmProvider.chat([{ role: 'user', content: prompt.prompt }]);
 *   },
 *   persist: async (response) => {
 *     await saveCharacters(projectId, parseCharacters(response));
 *   },
 * });
 */
export async function runWithTask<TResult, TPersisted = void>(
  spec: TaskRunSpec<TResult, TPersisted>,
): Promise<TaskRunResult<TResult, TPersisted>> {
  // 禁用模式：直接调用 execute，不创建 task；ctx 上的 progress/setRemoteTaskId 等都是 noop
  // 用途：批量子任务避免任务面板被刷屏；外层批量已经有 runWithTask 包装时，子任务传 disabled=true
  if (spec.disabled) {
    const noopCtx: TaskRunContext = {
      taskId: '',
      task: undefined as unknown as Task,
      progress: () => {},
      setRemoteTaskId: () => {},
      setMetadata: () => {},
    };
    const result = await spec.execute(noopCtx);
    let persisted: TPersisted = undefined as TPersisted;
    if (spec.persist) persisted = await spec.persist(result);
    return { taskId: '', result, persisted };
  }

  // 1. 创建任务 + 标记 running
  const task = TaskManager.createTask({
    projectId: spec.projectId,
    type: spec.type,
    category: spec.category,
    subType: spec.subType,
    targetType: spec.targetType,
    targetId: spec.targetId,
    targetName: spec.targetName,
    recoverable: spec.recoverable,
    maxRetries: spec.maxRetries,
    metadata: spec.metadata,
  });
  TaskManager.updateTask(task.id, { status: 'running', progress: 0 });

  // 2. 准备 ctx：execute 中调用 progress() 时映射到 [0, 90]，留 10% 给 persist
  const ctx: TaskRunContext = {
    taskId: task.id,
    task,
    progress: (percent: number, message?: string) => {
      const clamped = Math.max(0, Math.min(100, percent));
      const mapped = Math.round((clamped / 100) * 90);
      const messagePatch = message ? { metadata: { ...(task.metadata || {}), lastMessage: message } } : {};
      TaskManager.updateTask(task.id, {
        progress: mapped,
        ...(messagePatch as Partial<Task>),
      });
    },
    setRemoteTaskId: (id: string) => {
      TaskManager.updateTask(task.id, { remoteTaskId: id });
    },
    setMetadata: (patch: Record<string, unknown>) => {
      TaskManager.updateTask(task.id, {
        metadata: { ...(task.metadata || {}), ...patch },
      });
    },
  };

  // 已写入终态后不再覆盖；用户中途 cancelTaskRecord 会把任务翻成 'cancelled'，本路径
  // 业务还在跑（runWithTask 不监听取消信号），跑完后写 'completed' 会盖掉 cancelled。
  // 同样 'failed' 也不该被后续 'completed' 盖。
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const updateIfNotTerminal = (
    patch: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>,
  ): void => {
    const current = TaskManager.getTask(task.id);
    if (current && TERMINAL.has(current.status)) return;
    TaskManager.updateTask(task.id, patch);
  };

  try {
    // 3. 执行业务闭包
    const result = await spec.execute(ctx);
    updateIfNotTerminal({ progress: 90 });

    // 4. 可选落盘
    let persisted: TPersisted = undefined as TPersisted;
    if (spec.persist) {
      persisted = await spec.persist(result);
    }

    // 5. 标记完成
    updateIfNotTerminal({
      status: 'completed',
      progress: 100,
      completedAt: Date.now(),
    });
    return { taskId: task.id, result, persisted };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    updateIfNotTerminal({
      status: 'failed',
      error: errorMessage,
      completedAt: Date.now(),
    });
    if (spec.onFailure) {
      try {
        await spec.onFailure(err);
      } catch (cleanupErr) {
        logger.warn('onFailure cleanup threw, ignoring', { taskId: task.id, cleanupErr });
      }
    }
    throw err; // 把原异常抛回给调用方
  }
}

/**
 * 一些常见任务的便捷工厂。各业务模块可继续扩展。
 */
export const TaskRunPresets = {
  /** 推文文案生成 */
  tweetScriptGeneration(args: {
    projectId: string;
    episodeId: string;
    episodeName?: string;
  }): Pick<TaskRunSpec<unknown>, 'projectId' | 'category' | 'subType' | 'targetType' | 'targetId' | 'targetName' | 'type'> {
    return {
      projectId: args.projectId,
      category: 'script',
      subType: 'script-analysis',
      targetType: 'episode',
      targetId: args.episodeId,
      targetName: args.episodeName,
      type: 'script-analysis',
    };
  },

  /** 实体提取（角色 / 场景 / 道具单次） */
  entityExtraction(args: {
    projectId: string;
    episodeId: string;
    episodeName?: string;
    entityKind: 'character' | 'scene' | 'prop';
  }): Pick<TaskRunSpec<unknown>, 'projectId' | 'category' | 'subType' | 'targetType' | 'targetId' | 'targetName' | 'type' | 'metadata'> {
    return {
      projectId: args.projectId,
      category: 'asset',
      subType: 'character-extraction',
      targetType: 'episode',
      targetId: args.episodeId,
      targetName: args.episodeName,
      type: 'asset-generation',
      metadata: { entityKind: args.entityKind },
    };
  },

  /** 分镜提示词推理（图片 / 视频） */
  shotPromptInference(args: {
    projectId: string;
    shotId: string;
    shotName?: string;
    promptKind: 'image' | 'video';
  }): Pick<TaskRunSpec<unknown>, 'projectId' | 'category' | 'subType' | 'targetType' | 'targetId' | 'targetName' | 'type'> {
    return {
      projectId: args.projectId,
      category: 'prompt',
      subType: args.promptKind,
      targetType: 'shot',
      targetId: args.shotId,
      targetName: args.shotName,
      type: args.promptKind === 'image'
        ? 'prompt-generation:image'
        : 'prompt-generation:video',
    };
  },
};

export default runWithTask;
