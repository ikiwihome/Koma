/**
 * tasksDelegate — 渲染进程响应 main 的"代办"调用
 *
 * 用法：
 *   registerDelegate('tti:snapshot', async (args) => {
 *     // 调本地 provider 拿快照
 *     return snapshot;
 *   });
 *
 * 注册后，main 通过 delegateToRenderer({ type: 'tti:snapshot', ... }) 即可拿到结果。
 *
 * 协议：
 *   tasks:delegate:claim   (renderer→main): 申报本进程能处理哪些 type
 *   tasks:delegate:request (main→renderer event): { requestId, type, args }
 *   tasks:delegate:reply   (renderer→main): { requestId, result?, error? }
 *
 * 同一类型多处 registerDelegate：后注册者覆盖前者（与 main 端 last-claim-wins 一致）。
 */
import { createLogger } from '../store/logger';

const logger = createLogger('TasksDelegate');

type Fulfiller<A = unknown, R = unknown> = (args: A) => Promise<R> | R;

interface DelegateAPI {
  claim: (types: string[]) => Promise<{ ok: boolean }>;
  reply: (
    requestId: string,
    payload: { result?: unknown; error?: string }
  ) => Promise<{ ok: boolean }>;
  onRequest: (
    callback: (event: unknown, data: { requestId: string; type: string; args: unknown }) => void
  ) => () => void;
}

const fulfillers = new Map<string, Fulfiller>();
let listening = false;
let unsubscribe: (() => void) | null = null;
let pendingClaimDebounce: ReturnType<typeof setTimeout> | null = null;

function getApi(): DelegateAPI | null {
  const tasks = (window as any).electronAPI?.tasks;
  return tasks?.delegate ?? null;
}

function ensureListening(): void {
  if (listening) return;
  const api = getApi();
  if (!api) return;
  unsubscribe = api.onRequest(async (_event, data) => {
    const { requestId, type, args } = data ?? {};
    if (!requestId || !type) return;
    const fn = fulfillers.get(type);
    if (!fn) {
      await api.reply(requestId, { error: `no fulfiller registered for "${type}"` });
      return;
    }
    try {
      const result = await fn(args);
      await api.reply(requestId, { result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await api.reply(requestId, { error: message });
    }
  });
  listening = true;
}

function scheduleClaim(): void {
  // 多次 register 期间合并一次 claim 上报，避免抖动
  if (pendingClaimDebounce) clearTimeout(pendingClaimDebounce);
  pendingClaimDebounce = setTimeout(() => {
    pendingClaimDebounce = null;
    const api = getApi();
    if (!api) return;
    const types = Array.from(fulfillers.keys());
    if (types.length === 0) return;
    api.claim(types).catch(err => logger.warn('claim failed', err));
  }, 50);
}

/**
 * 注册一个类型的"代办处理函数"。返回 unregister 函数。
 * 重复注册同一类型 → 覆盖。
 */
export function registerDelegate<A = unknown, R = unknown>(
  type: string,
  fulfiller: Fulfiller<A, R>
): () => void {
  fulfillers.set(type, fulfiller as Fulfiller);
  ensureListening();
  scheduleClaim();
  return () => {
    if (fulfillers.get(type) === fulfiller) {
      fulfillers.delete(type);
    }
  };
}

/** 测试用：清空 + 解绑 */
export function __resetDelegateClientForTesting(): void {
  fulfillers.clear();
  if (unsubscribe) {
    try { unsubscribe(); } catch { /* noop */ }
    unsubscribe = null;
  }
  listening = false;
  if (pendingClaimDebounce) {
    clearTimeout(pendingClaimDebounce);
    pendingClaimDebounce = null;
  }
}
