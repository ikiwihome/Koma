/**
 * delegateToRenderer — 主进程→渲染进程"代办"调用
 *
 * 用途：main-side TaskHandler 想要调一个只在 renderer 里实现的逻辑（比如 provider
 * 的 getSnapshot），用这里的 delegateToRenderer 去发请求，等 renderer 回 reply。
 *
 * 协议（通过 ipc.ts 注册）：
 *   tasks:delegate:claim   (renderer→main, args: { types: string[] })   认领可处理的类型
 *   tasks:delegate:request (main→renderer event, payload: { requestId, type, args })
 *   tasks:delegate:reply   (renderer→main, args: { requestId, result?, error? })
 *
 * 路由：用一个 type→webContentsId 的 map 记最后认领者；多个 renderer 时谁后认领
 * 谁接管。如果该 webContents 已死，请求立即 fail，调用方可自行重试。
 *
 * 不在这里管：handler 注册（在 TaskRunner）；广播（在 TaskService）。
 */
import { randomUUID } from 'crypto';
import { webContents, type WebContents } from 'electron';

export interface DelegateRequest<A = unknown> {
  type: string;
  args: A;
  /** 等待 renderer 回复的超时（毫秒），缺省 60s */
  timeoutMs?: number;
  /** 取消信号 — 收到 abort 后立即 reject 并不再等 reply */
  signal?: AbortSignal;
}

interface PendingRequest {
  /** 该请求挂在哪个 renderer 上，用于 webContents 销毁时定向 reject */
  webContentsId: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  cleanupSignal?: () => void;
}

const claimers = new Map<string, number>(); // type → webContentsId
const pending = new Map<string, PendingRequest>(); // requestId → handlers

const DEFAULT_TIMEOUT_MS = 60_000;

function getWebContentsById(id: number): WebContents | null {
  const wc = webContents.fromId(id);
  if (!wc) return null;
  if (wc.isDestroyed()) return null;
  return wc;
}

export function recordClaim(types: string[], webContentsId: number): void {
  for (const type of types) {
    claimers.set(type, webContentsId);
  }
}

export function clearClaimsByWebContents(webContentsId: number): void {
  for (const [type, id] of Array.from(claimers.entries())) {
    if (id === webContentsId) claimers.delete(type);
  }
  // 这个 webContents 上挂的 pending request 全部直接 fail，不再等超时。
  // 之前注释说"已发的让超时兜底" —— 默认 60s、analysis 任务 30 分钟，体感
  // 是任务长时间卡住后才被标 failed。pending 现在带 webContentsId，关闭窗口
  // 即可立刻清理对应的请求。
  for (const [requestId, p] of Array.from(pending.entries())) {
    if (p.webContentsId !== webContentsId) continue;
    pending.delete(requestId);
    if (p.timer) clearTimeout(p.timer);
    p.cleanupSignal?.();
    try {
      p.reject(new Error(`renderer for delegate request gone (wc ${webContentsId})`));
    } catch {
      // reject 异常吞掉，不影响其它请求清理
    }
  }
}

export function deliverReply(
  requestId: string,
  payload: { result?: unknown; error?: string }
): void {
  const entry = pending.get(requestId);
  if (!entry) return; // 已超时或 abort，丢弃
  pending.delete(requestId);
  if (entry.timer) clearTimeout(entry.timer);
  entry.cleanupSignal?.();
  if (payload.error) {
    entry.reject(new Error(payload.error));
  } else {
    entry.resolve(payload.result);
  }
}

/**
 * 给某个类型派一个请求到当前 claimer。
 * 返回 renderer 的 reply.result，或抛 Error。
 */
export async function delegateToRenderer<R = unknown, A = unknown>(
  request: DelegateRequest<A>
): Promise<R> {
  const claimerId = claimers.get(request.type);
  if (claimerId === undefined) {
    throw new Error(`no renderer claimed type "${request.type}"`);
  }
  const wc = getWebContentsById(claimerId);
  if (!wc) {
    claimers.delete(request.type);
    throw new Error(`claimer for "${request.type}" is gone`);
  }

  const requestId = randomUUID();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<R>((resolve, reject) => {
    const entry: PendingRequest = {
      webContentsId: claimerId,
      resolve: resolve as (value: unknown) => void,
      reject,
    };
    entry.timer = setTimeout(() => {
      pending.delete(requestId);
      entry.cleanupSignal?.();
      reject(new Error(`delegateToRenderer timeout (${timeoutMs}ms) for type "${request.type}"`));
    }, timeoutMs);

    if (request.signal) {
      const onAbort = () => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        if (entry.timer) clearTimeout(entry.timer);
        reject(new Error('aborted'));
      };
      // signal 已经 aborted 时不能走 onAbort —— 此刻 pending 还没 set，onAbort
      // 内部的 pending.has(requestId) 检查会早返回，reject 永远不被调用，Promise
      // 挂到 timeout 兜底（默认 60s，分析任务 30 min）才结束。直接 reject 即可。
      if (request.signal.aborted) {
        if (entry.timer) clearTimeout(entry.timer);
        reject(new Error('aborted'));
        return;
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
      entry.cleanupSignal = () => request.signal!.removeEventListener('abort', onAbort);
    }

    pending.set(requestId, entry);

    try {
      wc.send('tasks:delegate:request', {
        requestId,
        type: request.type,
        args: request.args,
      });
    } catch (err) {
      pending.delete(requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.cleanupSignal?.();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** 测试用：清空内部状态 */
export function __resetDelegateForTesting(): void {
  for (const entry of pending.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.cleanupSignal?.();
  }
  pending.clear();
  claimers.clear();
}

/** 诊断/测试：当前认领状态 */
export function __getClaimsForTesting(): Record<string, number> {
  return Object.fromEntries(claimers);
}

/** 诊断/测试：当前等待中的请求数 */
export function __getPendingCountForTesting(): number {
  return pending.size;
}
