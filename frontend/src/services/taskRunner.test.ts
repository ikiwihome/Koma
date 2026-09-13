/**
 * taskRunner 框架测试
 *
 * 验证：
 * - execute 成功 → 任务标 completed + progress=100 + 调用 persist
 * - execute 抛错 → 任务标 failed + error，原异常 rethrow，并触发 onFailure
 * - persist 抛错 → 任务标 failed
 * - ctx.progress 映射到 0-90% 区间
 * - ctx.setRemoteTaskId / setMetadata 写到 task
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithTask } from './taskRunner';
import { TaskManager } from './TaskManager';
import type { Task } from './TaskManager';

// 不让 TaskManager 走真正持久化（测试环境无 electronService）— 直接 mock 关键 API
vi.mock('./TaskManager', () => {
  const tasks = new Map<string, Task>();
  let id = 0;
  return {
    TaskManager: {
      createTask: (params: any) => {
        const tid = `t${++id}`;
        const task: Task = {
          id: tid,
          projectId: params.projectId,
          type: params.type || 'script-analysis',
          category: params.category,
          subType: params.subType,
          targetType: params.targetType,
          targetId: params.targetId,
          targetName: params.targetName,
          status: 'pending',
          progress: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          metadata: params.metadata,
        };
        tasks.set(tid, task);
        return task;
      },
      updateTask: (taskId: string, updates: Partial<Task>) => {
        const t = tasks.get(taskId);
        if (!t) return null;
        const updated = { ...t, ...updates, updatedAt: Date.now() };
        tasks.set(taskId, updated);
        return updated;
      },
      getTask: (taskId: string) => tasks.get(taskId),
      // 暴露给测试用的内部访问
      _tasks: tasks,
      _reset: () => { tasks.clear(); id = 0; },
    },
  };
});

beforeEach(() => {
  (TaskManager as any)._reset();
});

const baseSpec = {
  projectId: 'p1',
  category: 'script' as const,
  subType: 'script-analysis' as const,
  targetType: 'episode' as const,
  targetId: 'e1',
  targetName: '第一集',
};

describe('runWithTask', () => {
  it('execute 成功：任务标 completed + progress=100', async () => {
    const persistSpy = vi.fn();
    const { result, taskId } = await runWithTask({
      ...baseSpec,
      execute: async (ctx) => {
        ctx.progress(50, '加载中');
        return 'ok';
      },
      persist: persistSpy,
    });
    expect(result).toBe('ok');
    expect(persistSpy).toHaveBeenCalledWith('ok');
    const task = TaskManager.getTask(taskId);
    expect(task?.status).toBe('completed');
    expect(task?.progress).toBe(100);
  });

  it('ctx.progress 映射到 [0, 90]：execute 内 progress(100) 时实际进度 90', async () => {
    let inFlightProgress = -1;
    const { taskId } = await runWithTask({
      ...baseSpec,
      execute: async (ctx) => {
        ctx.progress(100);
        // 通过 ctx.taskId 拿到中间状态
        const t = TaskManager.getTask(ctx.taskId);
        inFlightProgress = t?.progress ?? -1;
        return null;
      },
    });
    // 中间态：execute 内 progress(100) 映射为 90
    expect(inFlightProgress).toBe(90);
    // 完成后：100
    const task = TaskManager.getTask(taskId);
    expect(task?.progress).toBe(100);
  });

  it('execute 抛错：任务标 failed，原异常 rethrow，触发 onFailure', async () => {
    const onFailure = vi.fn();
    await expect(runWithTask({
      ...baseSpec,
      execute: async () => {
        throw new Error('boom');
      },
      onFailure,
    })).rejects.toThrow('boom');
    expect(onFailure).toHaveBeenCalledTimes(1);
    // 找到那个 failed 任务
    const failedTasks = Array.from((TaskManager as any)._tasks.values()) as Task[];
    expect(failedTasks).toHaveLength(1);
    expect(failedTasks[0].status).toBe('failed');
    expect(failedTasks[0].error).toBe('boom');
  });

  it('persist 抛错：任务标 failed', async () => {
    await expect(runWithTask({
      ...baseSpec,
      execute: async () => 'value',
      persist: async () => { throw new Error('persist failed'); },
    })).rejects.toThrow('persist failed');
    const failedTasks = Array.from((TaskManager as any)._tasks.values()) as Task[];
    expect(failedTasks[0].status).toBe('failed');
    expect(failedTasks[0].error).toBe('persist failed');
  });

  it('ctx.setRemoteTaskId / setMetadata 写到 task', async () => {
    const { taskId } = await runWithTask({
      ...baseSpec,
      execute: async (ctx) => {
        ctx.setRemoteTaskId('remote-xyz');
        ctx.setMetadata({ extraKey: 'value' });
        return null;
      },
    });
    const task = TaskManager.getTask(taskId);
    expect(task?.remoteTaskId).toBe('remote-xyz');
    expect((task?.metadata as any)?.extraKey).toBe('value');
  });

  it('onFailure 抛错时被吞掉，不影响 rethrow', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(runWithTask({
      ...baseSpec,
      execute: async () => { throw new Error('main error'); },
      onFailure: async () => { throw new Error('cleanup also failed'); },
    })).rejects.toThrow('main error'); // 抛的是主错误，不是 cleanup 错误
    consoleWarnSpy.mockRestore();
  });

  it('execute 完成前任务被外部 cancel：不再覆盖成 completed', async () => {
    // 用户中途按"取消任务" → tasksIPC.cancelTaskRecord 把任务翻成 'cancelled'
    // （runWithTask 不监听该信号，业务一般还会跑完）。但跑完后 runWithTask
    // 不该再把状态盖回 'completed' —— 否则任务列表里看到的是"已完成"，
    // 与用户的取消意图相反。
    const { taskId } = await runWithTask({
      ...baseSpec,
      execute: async (ctx) => {
        // 模拟外部把任务标 cancelled
        TaskManager.updateTask(ctx.taskId, { status: 'cancelled', error: 'user cancelled' });
        return 'output';
      },
    });
    const task = TaskManager.getTask(taskId);
    expect(task?.status).toBe('cancelled');
    expect(task?.error).toBe('user cancelled');
  });
});
