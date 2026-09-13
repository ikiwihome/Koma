/**
 * TaskRunner — 主进程任务执行器
 *
 * 职责：
 *  - 注册/查找 handler（按 type）
 *  - 接收 submit() 请求 → 创建任务行 → 入队 → 派遣给 handler
 *  - 状态机：pending → running → completed | failed | cancelled
 *  - 并发控制：per-type 可配置上限
 *  - 取消传播：AbortController.signal 注入 handler context
 *  - 启动恢复：可恢复的非终态任务（recoverable + remoteTaskId）重新入队
 *
 * 不负责：
 *  - 广播 —— 由 TaskService 的 listener 统一广播
 *  - 持久化 —— 通过 taskService.upsert 间接落库
 *
 * 设计决策：
 *  - handler 接口故意简单（input 进、output 出、可 onProgress / signal）
 *  - 进度节流落库：≥200ms 或 ≥1% 变化才写盘，避免每个 tick 触发广播风暴
 *  - 单任务失败不影响其它：handler throw 直接走 failed 分支
 */
import { randomUUID } from 'crypto';
import { taskService, type TaskMutationContext, type TaskRecord } from './TaskService';

export interface TaskHandlerContext<I> {
  /** 任务记录的 id（已写库，供 handler 反查） */
  taskId: string;
  /** 业务侧传进来的 input（不可变） */
  input: I;
  scope: string;
  targetKind?: string | null;
  targetId?: string | null;
  /** 由 cancel() 触发的中止信号 */
  signal: AbortSignal;
  /** 进度上报（0..1 或 0..100，由业务约定；这里只做记录） */
  onProgress: (progress: number) => void;
  /**
   * 业务侧自由附加 metadata（如 remoteTaskId）；merge 进 payload。
   */
  patch: (partial: Partial<TaskRecord> & { payload?: Record<string, unknown> }) => void;
}

export interface TaskHandler<I = unknown, O = unknown> {
  type: string;
  /** 该 type 的最大并发数；缺省走全局 default */
  concurrency?: number;
  /**
   * 任务是否在重启后可恢复。可恢复任务在 boot 时会被重新入队（受 maxRetries 限制）。
   * 默认 false：sync 任务（无 remoteTaskId）、异常工作流，不恢复。
   * true：远程异步任务（含 remoteTaskId），通过 polling 可继续追踪。
   */
  recoverable?: boolean;
  /**
   * 实际工作。可以是同步快活（fetch + parse），也可以是长 polling（while loop 内 await sleep + check signal）。
   * handler 内必须周期性 throwIfAborted 或 signal.aborted 判断，否则 cancel 无效。
   */
  run(ctx: TaskHandlerContext<I>): Promise<O>;
}

export interface SubmitInput<I = unknown> {
  type: string;
  scope: string;
  input: I;
  targetKind?: string | null;
  targetId?: string | null;
  /** 业务可选传 id；缺省自动生成 */
  taskId?: string;
  /** 落到 payload_json 的初始数据 */
  initialPayload?: Record<string, unknown>;
  maxRetries?: number;
}

const DEFAULT_CONCURRENCY = 4;
const PROGRESS_FLUSH_MS = 200;
const PROGRESS_MIN_DELTA = 1; // 1% 变化才落库

interface QueueItem {
  taskId: string;
  type: string;
}

interface RunningJob {
  taskId: string;
  abortController: AbortController;
}

export class TaskRunner {
  private handlers = new Map<string, TaskHandler>();
  private pendingQueues = new Map<string, QueueItem[]>(); // type → FIFO
  private activeByType = new Map<string, number>();        // type → in-flight count
  private running = new Map<string, RunningJob>();         // taskId → job
  private defaultConcurrency = DEFAULT_CONCURRENCY;

  setDefaultConcurrency(n: number): void {
    if (n > 0) this.defaultConcurrency = n;
  }

  registerHandler(handler: TaskHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`handler already registered for type "${handler.type}"`);
    }
    this.handlers.set(handler.type, handler);
  }

  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * 提交新任务：写库 + 入队。
   * 返回新建任务的 record。
   */
  async submit<I>(input: SubmitInput<I>, context: TaskMutationContext = {}): Promise<TaskRecord> {
    const handler = this.handlers.get(input.type);
    if (!handler) {
      throw new Error(`no handler registered for type "${input.type}"`);
    }

    const now = Date.now();
    const taskId = input.taskId ?? randomUUID();

    const record: TaskRecord = {
      id: taskId,
      scope: input.scope,
      type: input.type,
      status: 'pending',
      progress: 0,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
      remoteTaskId: null,
      attempt: 0,
      maxRetries: input.maxRetries ?? 3,
      error: null,
      payload: {
        ...(input.initialPayload ?? {}),
        input: input.input,
        recoverable: !!handler.recoverable,
      },
      createdAt: now,
      updatedAt: now,
      heartbeatAt: null,
      completedAt: null,
    };

    const saved = taskService.upsert(record, context);
    this.enqueue(saved);
    return saved;
  }

  /**
   * 取消任务：
   *  - 在 running 中：调 AbortController.abort，handler 收到 signal 后中断
   *  - 在 pending 中：直接从队列移除并标 cancelled
   *  - 已终态：no-op
   */
  cancel(taskId: string, reason?: string, context: TaskMutationContext = {}): boolean {
    const job = this.running.get(taskId);
    if (job) {
      job.abortController.abort(new Error(reason ?? 'cancelled'));
      // handler 的 finally 会触发 finalize；此处仅返回是否能取消
      return true;
    }
    // 在 pending queue 中
    const record = taskService.get(taskId);
    if (!record) return false;
    if (record.status !== 'pending') return false;

    this.removeFromQueue(record.type, taskId);
    return taskService.cancel(taskId, reason ?? 'cancelled', context);
  }

  /**
   * 启动时调一次：
   *  - 把 stale running/processing 任务按 recoverable 决定 fail 或重排
   *  - taskService.reconcileOnBoot 已经按 payload.recoverable 把可恢复的转 pending；
   *    这里把 pending 状态的可恢复任务真正入队继续跑。
   */
  resumeFromBoot(): void {
    const records = taskService.list({ status: 'pending' });
    for (const record of records) {
      if (!this.handlers.has(record.type)) continue;
      this.enqueue(record);
    }
  }

  /**
   * 当前在跑的任务 ids（测试/诊断用）
   */
  getRunningIds(): string[] {
    return Array.from(this.running.keys());
  }

  // ========== 内部：队列 / 派遣 ==========

  private enqueue(record: TaskRecord): void {
    const list = this.pendingQueues.get(record.type) ?? [];
    list.push({ taskId: record.id, type: record.type });
    this.pendingQueues.set(record.type, list);
    this.tryDispatch(record.type);
  }

  private removeFromQueue(type: string, taskId: string): void {
    const list = this.pendingQueues.get(type);
    if (!list) return;
    const idx = list.findIndex(item => item.taskId === taskId);
    if (idx >= 0) list.splice(idx, 1);
  }

  private getConcurrency(type: string): number {
    const handler = this.handlers.get(type);
    return handler?.concurrency ?? this.defaultConcurrency;
  }

  private tryDispatch(type: string): void {
    const limit = this.getConcurrency(type);
    while ((this.activeByType.get(type) ?? 0) < limit) {
      const list = this.pendingQueues.get(type);
      if (!list || list.length === 0) return;
      const item = list.shift()!;
      this.dispatch(item).catch(() => undefined);
    }
  }

  private async dispatch(item: QueueItem): Promise<void> {
    const handler = this.handlers.get(item.type);
    if (!handler) {
      // handler 在排队期间被卸载，标失败
      taskService.upsert({
        ...(taskService.get(item.taskId) as TaskRecord),
        status: 'failed',
        error: `handler not registered: ${item.type}`,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      return;
    }

    const initial = taskService.get(item.taskId);
    if (!initial) return;
    if (initial.status !== 'pending') return; // 可能已被 cancel

    this.activeByType.set(item.type, (this.activeByType.get(item.type) ?? 0) + 1);

    const abortController = new AbortController();
    this.running.set(item.taskId, { taskId: item.taskId, abortController });

    // 转 running 状态
    const startedAt = Date.now();
    let current: TaskRecord = {
      ...initial,
      status: 'running',
      progress: 0,
      attempt: (initial.attempt ?? 0) + 1,
      updatedAt: startedAt,
      heartbeatAt: startedAt,
    };
    current = taskService.upsert(current);

    // 节流进度
    let lastFlushedProgress = 0;
    let lastFlushAt = 0;
    const flushProgress = (progress: number, force = false): void => {
      const now = Date.now();
      const delta = Math.abs(progress - lastFlushedProgress);
      if (!force && delta < PROGRESS_MIN_DELTA && now - lastFlushAt < PROGRESS_FLUSH_MS) {
        return;
      }
      lastFlushedProgress = progress;
      lastFlushAt = now;
      current = taskService.upsert({
        ...current,
        progress,
        updatedAt: now,
        heartbeatAt: now,
      });
    };

    const ctx: TaskHandlerContext<unknown> = {
      taskId: item.taskId,
      input: (current.payload as { input?: unknown })?.input,
      scope: current.scope,
      targetKind: current.targetKind ?? null,
      targetId: current.targetId ?? null,
      signal: abortController.signal,
      onProgress: (p: number) => {
        if (typeof p !== 'number' || !Number.isFinite(p)) return;
        flushProgress(Math.max(0, Math.min(100, p)));
      },
      patch: (partial) => {
        const merged: TaskRecord = {
          ...current,
          ...partial,
          payload: {
            ...(current.payload as Record<string, unknown>),
            ...(partial.payload as Record<string, unknown> | undefined),
          },
          updatedAt: Date.now(),
        };
        current = taskService.upsert(merged);
      },
    };

    try {
      const output = await handler.run(ctx);
      flushProgress(100, true);
      const completedAt = Date.now();
      // handler 期间外部 writer（如 renderer 的 TaskManager.updateTask 通过 IPC 写入）
      // 可能更新过 payload；从 DB 重新拉一遍，避免 stale current 把它们覆盖。
      const fresh = taskService.get(item.taskId) ?? current;
      taskService.upsert({
        ...fresh,
        status: 'completed',
        progress: 100,
        updatedAt: completedAt,
        completedAt,
        payload: {
          ...((fresh.payload as Record<string, unknown>) ?? {}),
          output,
        },
      });
    } catch (err) {
      const completedAt = Date.now();
      const aborted = abortController.signal.aborted;
      const message = err instanceof Error ? err.message : String(err);
      const fresh = taskService.get(item.taskId) ?? current;
      taskService.upsert({
        ...fresh,
        status: aborted ? 'cancelled' : 'failed',
        error: message || (aborted ? 'cancelled' : 'failed'),
        updatedAt: completedAt,
        completedAt,
      });
    } finally {
      this.running.delete(item.taskId);
      this.activeByType.set(item.type, Math.max(0, (this.activeByType.get(item.type) ?? 1) - 1));
      // 队列还有等待项就继续派发
      this.tryDispatch(item.type);
    }
  }
}

export const taskRunner = new TaskRunner();
