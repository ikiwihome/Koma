/**
 * 把"某个任务被 cancel"映射成 AbortSignal
 *
 * 用途：renderer 里跑的 sync 业务任务（ScriptAnalysis / ShotAnalysis 等），
 * 创建任务后调 createTaskCancellationSignal(taskId) 拿到一个 signal；
 * 业务在 LLM 调用前后或循环中调 signal.throwIfAborted() 即可响应取消。
 *
 * 信号源是主进程：
 *  1. UI 调 cancelTaskRecord(taskId) → IPC tasks:cancel
 *  2. 主进程把任务标 'cancelled' 并广播
 *  3. 本工具监听广播，看到自己 taskId 就 abort
 *
 * 终态（completed / failed / cancelled）也会自动 dispose 订阅，避免内存泄漏。
 */
import { subscribeTaskUpdates, type TaskRecord } from './tasksIPC';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export interface TaskCancellationHandle {
  signal: AbortSignal;
  /** 主动解除订阅；任务进入终态会自动调用 */
  dispose(): void;
}

export function createTaskCancellationSignal(taskId: string): TaskCancellationHandle {
  const controller = new AbortController();
  let unsub: (() => void) | null = null;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (unsub) {
      try { unsub(); } catch { /* noop */ }
      unsub = null;
    }
  };

  unsub = subscribeTaskUpdates((record: TaskRecord, kind) => {
    if (record.id !== taskId) return;
    if (kind === 'delete') {
      dispose();
      return;
    }
    if (record.status === 'cancelled' && !controller.signal.aborted) {
      controller.abort(new Error(record.error || 'cancelled'));
      dispose();
      return;
    }
    if (TERMINAL.has(record.status)) {
      // 已 completed/failed：不需要再监听
      dispose();
    }
  });

  return {
    signal: controller.signal,
    dispose,
  };
}
