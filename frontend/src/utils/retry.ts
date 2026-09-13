/**
 * 重试与超时工具
 *
 * 设计目的：消除 services 层中"for attempt 1..N + Math.pow(2, attempt - 1) + setTimeout"
 * 散落实现，建立统一可观测、可取消、可分类（shouldRetry）的重试基元。
 *
 * 不负责"切换不同 Provider"——那是 Fallback Chain 职责。
 *
 * 典型用法：
 *   const result = await withRetry(
 *     async (attempt) => {
 *       const r = await withTimeout(uploader.upload(bytes), 60_000, '上传超时');
 *       if (!r.success) throw new Error(r.error);
 *       return r;
 *     },
 *     {
 *       maxAttempts: 3,
 *       initialDelayMs: 1000,
 *       backoffMultiplier: 2,
 *       onRetry: (err, attempt, delay) => logger.warn(`第 ${attempt} 次失败，${delay}ms 后重试`, err),
 *       signal: abortController.signal,
 *     },
 *   );
 */

export interface RetryPolicy {
  /** 总尝试次数（含首次）。1 表示不重试，仅尝试一次。 */
  maxAttempts: number;
  /** 首次失败到第二次尝试之间的延迟（毫秒）。默认 1000。 */
  initialDelayMs?: number;
  /** 退避倍率。第 N 次重试前的延迟 = initialDelayMs * multiplier^(N-1)，封顶 maxDelayMs。默认 2。 */
  backoffMultiplier?: number;
  /** 单次延迟封顶（毫秒）。默认 30_000。 */
  maxDelayMs?: number;
  /**
   * 决定某个错误是否应触发重试。返回 false 时立即抛出该错误。
   * 默认对所有错误都重试。常见用法：跳过用户取消（AbortError）或权限错误。
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /**
   * 在每次延迟前调用，用于日志记录。delayMs 是即将等待的毫秒数。
   * 不会在最后一次失败（即用尽 maxAttempts 时）调用。
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** 取消信号；触发后 withRetry 立即拒绝并把当前等待中的延迟也清掉。 */
  signal?: AbortSignal;
}

class AbortError extends Error {
  readonly name = 'AbortError';
  constructor(message = '操作已取消') {
    super(message);
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && (
        (error as { name?: string }).name === 'AbortError'
        || (error as { code?: string }).code === 'ABORT_ERR'
      ),
  );
}

/**
 * 在指定毫秒数内等待，可被 AbortSignal 中断。
 * 中断时拒绝（reject AbortError），不会泄漏 setTimeout。
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new AbortError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new AbortError());
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 给一个 Promise 套上超时。超时后拒绝（不会取消原 promise，调用方需自行处理资源释放）。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string = `操作超时（>${timeoutMs}ms）`,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 计算第 N 次重试前的等待时间。
 * attempt 从 1 开始：attempt=1 表示首次尝试已失败、即将进行第二次尝试。
 */
export function computeBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  backoffMultiplier: number,
  maxDelayMs: number,
): number {
  const raw = initialDelayMs * Math.pow(backoffMultiplier, Math.max(0, attempt - 1));
  return Math.min(raw, maxDelayMs);
}

/**
 * 用统一策略执行带重试的异步任务。
 *
 * - 首次尝试：attempt=1 调用 task(1)
 * - 失败后：调用 onRetry，等待 backoff 后再次调用 task(2)，依此类推
 * - 任意阶段 signal.aborted 立即抛 AbortError
 * - shouldRetry 返回 false 时立即抛该错误，不再重试
 * - 用尽 maxAttempts 后抛最后一次失败的错误
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
): Promise<T> {
  const {
    maxAttempts,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30_000,
    shouldRetry = () => true,
    onRetry,
    signal,
  } = policy;

  if (maxAttempts < 1) {
    throw new Error(`withRetry: maxAttempts must be >= 1, got ${maxAttempts}`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new AbortError();
    try {
      return await task(attempt);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      const isLastAttempt = attempt >= maxAttempts;
      if (isLastAttempt) break;
      if (!shouldRetry(error, attempt)) break;

      const wait = computeBackoffDelay(attempt, initialDelayMs, backoffMultiplier, maxDelayMs);
      onRetry?.(error, attempt, wait);
      await delay(wait, signal);
    }
  }

  throw lastError;
}
