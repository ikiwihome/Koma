/**
 * 前端 registerDelegate 客户端测试：模拟 main 通过 onRequest 回调发请求，
 * 验证 fulfiller 被调用 + reply 用对的 requestId 上报。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerDelegate,
  __resetDelegateClientForTesting,
} from '../tasksDelegate';

type RequestCallback = (event: unknown, data: { requestId: string; type: string; args: unknown }) => void;

describe('tasksDelegate (renderer side)', () => {
  let listener: RequestCallback | null = null;
  const claimSpy = vi.fn();
  const replySpy = vi.fn();

  beforeEach(() => {
    listener = null;
    claimSpy.mockReset();
    replySpy.mockReset();
    claimSpy.mockResolvedValue({ ok: true });
    replySpy.mockResolvedValue({ ok: true });

    (window as any).electronAPI = {
      tasks: {
        delegate: {
          claim: claimSpy,
          reply: replySpy,
          onRequest: (cb: RequestCallback) => {
            listener = cb;
            return () => {
              listener = null;
            };
          },
        },
      },
    };

    __resetDelegateClientForTesting();
  });

  afterEach(() => {
    __resetDelegateClientForTesting();
    delete (window as any).electronAPI;
  });

  function deliverRequest(payload: { requestId: string; type: string; args: unknown }): void {
    if (!listener) throw new Error('no listener registered');
    listener({}, payload);
  }

  it('claims registered types after debounce + fulfills incoming requests', async () => {
    const fn = vi.fn(async (args: { x: number }) => args.x * 2);
    registerDelegate('demo:double', fn);

    // 等 50ms 防抖
    await new Promise(r => setTimeout(r, 80));
    expect(claimSpy).toHaveBeenCalledWith(['demo:double']);

    deliverRequest({ requestId: 'req-1', type: 'demo:double', args: { x: 21 } });
    // 等 microtask 走完 fulfiller + reply
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(fn).toHaveBeenCalledWith({ x: 21 });
    expect(replySpy).toHaveBeenCalledWith('req-1', { result: 42 });
  });

  it('replies with error when fulfiller throws', async () => {
    registerDelegate('demo:boom', () => {
      throw new Error('explode');
    });
    await new Promise(r => setTimeout(r, 80));

    deliverRequest({ requestId: 'req-2', type: 'demo:boom', args: {} });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(replySpy).toHaveBeenCalledWith('req-2', { error: 'explode' });
  });

  it('replies with error when no fulfiller for the requested type', async () => {
    registerDelegate('demo:exists', () => 'ok');
    await new Promise(r => setTimeout(r, 80));

    deliverRequest({ requestId: 'req-3', type: 'demo:absent', args: {} });
    await new Promise(r => setTimeout(r, 0));

    expect(replySpy).toHaveBeenCalledWith('req-3', expect.objectContaining({
      error: expect.stringContaining('no fulfiller'),
    }));
  });

  it('unregister stops receiving (re-register overrides)', async () => {
    const a = vi.fn(async () => 'a');
    const b = vi.fn(async () => 'b');
    const unregister = registerDelegate('demo:override', a);
    await new Promise(r => setTimeout(r, 80));

    // 覆盖：后注册者生效
    registerDelegate('demo:override', b);
    deliverRequest({ requestId: 'r1', type: 'demo:override', args: {} });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(b).toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();

    // unregister 第一个 — 第二个仍然在
    unregister();
    deliverRequest({ requestId: 'r2', type: 'demo:override', args: {} });
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(b).toHaveBeenCalledTimes(2);
  });
});
