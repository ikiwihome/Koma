/**
 * TaskRunner 单测
 *
 * 测试位于前端目录是因为只有 frontend 配置了 vitest；模块本身在 electron/。
 * 通过 vi.mock 把 TaskService 替换成内存假货，避免引入 better-sqlite3 native 依赖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 内存假任务表 + spy 通过 vi.hoisted 提到 mock 之前初始化
const { fakeStore, upsertSpy, getSpy, cancelSpy, listSpy } = vi.hoisted(() => {
  const fakeStore = new Map<string, any>();
  const upsertSpy = vi.fn((record: any) => {
    fakeStore.set(record.id, { ...record });
    return { ...record };
  });
  const getSpy = vi.fn((id: string) => fakeStore.get(id) ?? null);
  const cancelSpy = vi.fn((id: string, reason?: string) => {
    const existing = fakeStore.get(id);
    if (!existing) return false;
    if (['completed', 'failed', 'cancelled'].includes(existing.status)) return false;
    fakeStore.set(id, { ...existing, status: 'cancelled', error: reason ?? 'cancelled' });
    return true;
  });
  const listSpy = vi.fn((query: any = {}) => {
    let list = Array.from(fakeStore.values());
    if (query?.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      list = list.filter(r => statuses.includes(r.status));
    }
    if (query?.scope) list = list.filter(r => r.scope === query.scope);
    return list;
  });
  return { fakeStore, upsertSpy, getSpy, cancelSpy, listSpy };
});

vi.mock('../../../../electron/service/tasks/TaskService', () => ({
  taskService: {
    upsert: upsertSpy,
    get: getSpy,
    cancel: cancelSpy,
    list: listSpy,
  },
}));

// 在 mock 之后再 import 被测代码
import { TaskRunner, type TaskHandler } from '../../../../electron/service/tasks/TaskRunner';

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('TaskRunner', () => {
  let runner: TaskRunner;

  beforeEach(() => {
    fakeStore.clear();
    upsertSpy.mockClear();
    getSpy.mockClear();
    cancelSpy.mockClear();
    listSpy.mockClear();
    runner = new TaskRunner();
    runner.setDefaultConcurrency(2);
  });

  afterEach(() => {
    fakeStore.clear();
  });

  it('runs a handler from pending → running → completed and writes output', async () => {
    const handler: TaskHandler<{ x: number }, number> = {
      type: 'demo:double',
      async run(ctx) {
        ctx.onProgress(50);
        return ctx.input.x * 2;
      },
    };
    runner.registerHandler(handler);

    const submitted = await runner.submit({
      type: 'demo:double',
      scope: 'project:p1',
      input: { x: 21 },
    });

    expect(submitted.status).toBe('pending');

    await flushMicrotasks();
    await flushMicrotasks();

    const final = fakeStore.get(submitted.id);
    expect(final.status).toBe('completed');
    expect(final.progress).toBe(100);
    expect(final.payload.output).toBe(42);
  });

  it('marks task failed when handler throws', async () => {
    runner.registerHandler({
      type: 'demo:boom',
      async run() {
        throw new Error('boom');
      },
    });

    const submitted = await runner.submit({
      type: 'demo:boom',
      scope: 'project:p1',
      input: {},
    });

    await flushMicrotasks();
    await flushMicrotasks();

    const final = fakeStore.get(submitted.id);
    expect(final.status).toBe('failed');
    expect(final.error).toBe('boom');
  });

  it('cancels in-flight handler via AbortSignal', async () => {
    let abortObserved = false;
    runner.registerHandler({
      type: 'demo:slow',
      async run(ctx) {
        // 模拟长 polling：每 5ms tick 一次
        for (let i = 0; i < 100; i++) {
          if (ctx.signal.aborted) {
            abortObserved = true;
            throw new Error('aborted');
          }
          await new Promise(r => setTimeout(r, 5));
        }
        return 'done';
      },
    });

    const submitted = await runner.submit({
      type: 'demo:slow',
      scope: 'project:p1',
      input: {},
    });

    // 让 handler 启动起来
    await new Promise(r => setTimeout(r, 20));

    const cancelled = runner.cancel(submitted.id, 'user');
    expect(cancelled).toBe(true);

    await new Promise(r => setTimeout(r, 50));

    expect(abortObserved).toBe(true);
    const final = fakeStore.get(submitted.id);
    expect(final.status).toBe('cancelled');
  });

  it('respects per-type concurrency limit', async () => {
    let concurrent = 0;
    let peak = 0;
    runner.registerHandler({
      type: 'demo:limited',
      concurrency: 2,
      async run() {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise(r => setTimeout(r, 30));
        concurrent--;
      },
    });

    const subs = await Promise.all(
      [0, 1, 2, 3, 4].map(i =>
        runner.submit({ type: 'demo:limited', scope: 's', input: { i } })
      )
    );

    // 等所有任务跑完
    await new Promise(r => setTimeout(r, 200));

    expect(peak).toBeLessThanOrEqual(2);
    for (const sub of subs) {
      expect(fakeStore.get(sub.id).status).toBe('completed');
    }
  });

  it('cancel on a pending (queued) task removes it from queue', async () => {
    let runs = 0;
    runner.registerHandler({
      type: 'demo:single',
      concurrency: 1,
      async run() {
        runs++;
        await new Promise(r => setTimeout(r, 50));
      },
    });

    const a = await runner.submit({ type: 'demo:single', scope: 's', input: {} });
    const b = await runner.submit({ type: 'demo:single', scope: 's', input: {} });

    // a 立即开跑；b 在队列里等
    runner.cancel(b.id);

    await new Promise(r => setTimeout(r, 100));

    expect(runs).toBe(1);
    expect(fakeStore.get(a.id).status).toBe('completed');
    expect(fakeStore.get(b.id).status).toBe('cancelled');
  });

  it('resumeFromBoot re-enqueues pending tasks for registered handlers', async () => {
    runner.registerHandler({
      type: 'demo:resume',
      async run() {
        return 'ok';
      },
    });

    // 模拟 boot 时数据库里已有一条 pending（来自上次重启 reconcile 转的）
    fakeStore.set('boot-1', {
      id: 'boot-1',
      scope: 'project:p1',
      type: 'demo:resume',
      status: 'pending',
      progress: 0,
      targetKind: null,
      targetId: null,
      remoteTaskId: 'r1',
      attempt: 0,
      maxRetries: 3,
      error: null,
      payload: { input: {}, recoverable: true },
      createdAt: 1,
      updatedAt: 2,
      heartbeatAt: null,
      completedAt: null,
    });

    runner.resumeFromBoot();
    await flushMicrotasks();
    await flushMicrotasks();

    const final = fakeStore.get('boot-1');
    expect(final.status).toBe('completed');
  });
});
