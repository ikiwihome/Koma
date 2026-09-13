/**
 * delegate round-trip 测试：
 *  - 主进程 delegate.ts 的 delegateToRenderer / recordClaim / deliverReply 逻辑
 *  - 前端 tasksDelegate 的 registerDelegate / 接收 request / 回 reply 逻辑
 *
 * 不真起 Electron — mock electron.webContents 让 send 落到我们手里，
 * 然后把那个 payload 喂给前端 onRequest listener，模拟 IPC 走通。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ========== 主进程侧 mock ==========
//
// vi.hoisted 让 mock 在 import 之前可用
const { fakeWebContents, sendSpy, getById } = vi.hoisted(() => {
  const sendSpy = vi.fn();
  const fakeWebContents = {
    id: 1,
    isDestroyed: () => false,
    send: sendSpy,
  };
  const getById = vi.fn((id: number) => (id === fakeWebContents.id ? fakeWebContents : null));
  return { fakeWebContents, sendSpy, getById };
});

vi.mock('electron', () => ({
  webContents: {
    fromId: getById,
  },
  ipcMain: { handle: vi.fn() },
}));

// 在 mock 之后再 import
import {
  delegateToRenderer,
  recordClaim,
  deliverReply,
  clearClaimsByWebContents,
  __resetDelegateForTesting,
  __getPendingCountForTesting,
} from '../../../../electron/service/tasks/delegate';

describe('delegateToRenderer (main side)', () => {
  beforeEach(() => {
    sendSpy.mockClear();
    __resetDelegateForTesting();
  });

  afterEach(() => {
    __resetDelegateForTesting();
  });

  it('sends request to claimer and resolves with reply.result', async () => {
    recordClaim(['tti:snapshot'], fakeWebContents.id);

    const promise = delegateToRenderer<{ ok: true }>({
      type: 'tti:snapshot',
      args: { remoteTaskId: 'r1' },
    });

    // 取出 main 发出去的 requestId
    expect(sendSpy).toHaveBeenCalledWith(
      'tasks:delegate:request',
      expect.objectContaining({ type: 'tti:snapshot', args: { remoteTaskId: 'r1' } })
    );
    const requestId = sendSpy.mock.calls[0][1].requestId;

    deliverReply(requestId, { result: { ok: true } });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(__getPendingCountForTesting()).toBe(0);
  });

  it('rejects with reply.error', async () => {
    recordClaim(['tti:snapshot'], fakeWebContents.id);
    const promise = delegateToRenderer({
      type: 'tti:snapshot',
      args: {},
    });
    const requestId = sendSpy.mock.calls[0][1].requestId;
    deliverReply(requestId, { error: 'provider down' });
    await expect(promise).rejects.toThrow('provider down');
  });

  it('throws when no claimer', async () => {
    await expect(
      delegateToRenderer({ type: 'unclaimed', args: {} })
    ).rejects.toThrow('no renderer claimed');
  });

  it('rejects on timeout', async () => {
    recordClaim(['tti:snapshot'], fakeWebContents.id);
    const promise = delegateToRenderer({
      type: 'tti:snapshot',
      args: {},
      timeoutMs: 30,
    });
    await expect(promise).rejects.toThrow(/timeout/);
  });

  it('rejects when AbortSignal aborted', async () => {
    recordClaim(['tti:snapshot'], fakeWebContents.id);
    const ac = new AbortController();
    const promise = delegateToRenderer({
      type: 'tti:snapshot',
      args: {},
      signal: ac.signal,
    });
    ac.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  it('rejects pending requests when the target webContents is destroyed', async () => {
    // 之前的实现把 pending request 留给超时兜底（默认 60s，analysis 任务 30 分钟）。
    // 关闭对应 renderer 窗口后任务应当立刻被标 failed，而不是静默挂着。
    recordClaim(['tti:snapshot'], fakeWebContents.id);
    const promise = delegateToRenderer({
      type: 'tti:snapshot',
      args: {},
      timeoutMs: 60_000,
    });
    expect(__getPendingCountForTesting()).toBe(1);

    // 模拟 renderer 销毁
    clearClaimsByWebContents(fakeWebContents.id);

    await expect(promise).rejects.toThrow(/renderer for delegate request gone/);
    expect(__getPendingCountForTesting()).toBe(0);
  });

  it('rejects synchronously when AbortSignal is already aborted at call time', async () => {
    // 之前的实现：在调用前已 aborted 时进入 onAbort 路径，但 pending 还没 set，
    // onAbort 早返回，reject 永远不被调用 —— Promise 挂到 timeout 才结束。
    recordClaim(['tti:snapshot'], fakeWebContents.id);
    const ac = new AbortController();
    ac.abort();
    const promise = delegateToRenderer({
      type: 'tti:snapshot',
      args: {},
      signal: ac.signal,
      timeoutMs: 60_000,
    });
    await expect(promise).rejects.toThrow('aborted');
    // 立即清理：不应留下 pending 也不应触发任何 send
    expect(sendSpy).not.toHaveBeenCalled();
    expect(__getPendingCountForTesting()).toBe(0);
  });
});
