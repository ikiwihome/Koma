/**
 * 资产 / 分镜批量生成的并发运行器：
 * - 限制并发上限（避免触发上游 TTI/ITV 渠道限流）
 * - 自动重试（默认仅对疑似瞬时错误重试，可自定义）
 * - 保留输入顺序的结果数组，便于 UI 一对一映射
 *
 * 没引入第三方 p-limit / p-retry：实现非常薄，自己 await 即可，少一个依赖少一份心智负担。
 */

export interface RunBatchOptions<T, R> {
  items: T[];
  /** 单时刻并发执行的 worker 数。默认 3。<=0 视为 1。 */
  concurrency?: number;
  /** 失败时的最大额外重试次数（不含首次）。默认 2 → 总共最多 3 次。 */
  maxRetries?: number;
  /** 重试间退避基数。第 N 次重试等待 base * 2^(N-1) ms。默认 800ms（→ 800/1600/3200…）。 */
  retryBaseDelayMs?: number;
  /**
   * 判断错误是否值得重试。返回 false 时立刻 fail，不再消耗重试名额。
   * 默认：只对网络 / 超时 / 5xx / 429 / 限流 关键词匹配的错误重试，4xx 验证错误不重试。
   */
  shouldRetry?: (error: unknown, nextAttempt: number, item: T) => boolean;
  /** 单 item 工作函数。`attempt` 从 1 开始。 */
  worker: (item: T, index: number, attempt: number) => Promise<R>;
  /** 一次 attempt 开始时回调（无论首次还是重试）。 */
  onAttemptStart?: (item: T, index: number, attempt: number) => void;
  /** 一次 attempt 结束（成功或失败）时回调，便于 UI 实时刷状态。 */
  onAttemptEnd?: (item: T, index: number, attempt: number, ok: boolean, error?: unknown) => void;
}

export interface BatchItemResult<T, R> {
  item: T;
  index: number;
  /** 最终成功的结果；失败为 undefined。 */
  result?: R;
  /** 最终错误；成功为 undefined。 */
  error?: unknown;
  /** 实际执行的 attempt 次数。 */
  attempts: number;
}

const DEFAULT_RETRY_PATTERN = /timeout|timed?\s*out|aborted|network|fetch|econn|socket|temporar|unavailable|rate.?limit|429|5\d\d/i;

function defaultShouldRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return true;
  return DEFAULT_RETRY_PATTERN.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBatchWithConcurrency<T, R>(
  opts: RunBatchOptions<T, R>,
): Promise<BatchItemResult<T, R>[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 3));
  const maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 2));
  const retryBaseDelayMs = Math.max(0, Math.floor(opts.retryBaseDelayMs ?? 800));
  const shouldRetry = opts.shouldRetry ?? ((err) => defaultShouldRetry(err));

  const results: BatchItemResult<T, R>[] = opts.items.map((item, index) => ({
    item,
    index,
    attempts: 0,
  }));

  let cursor = 0;

  async function workerLoop(): Promise<void> {
    while (true) {
      const myIndex = cursor;
      cursor += 1;
      if (myIndex >= opts.items.length) return;

      const item = opts.items[myIndex];
      let attempt = 0;
      let lastError: unknown;

      while (attempt <= maxRetries) {
        attempt += 1;
        opts.onAttemptStart?.(item, myIndex, attempt);
        try {
          const value = await opts.worker(item, myIndex, attempt);
          results[myIndex] = { item, index: myIndex, result: value, attempts: attempt };
          opts.onAttemptEnd?.(item, myIndex, attempt, true);
          break;
        } catch (err) {
          lastError = err;
          const isLastAttempt = attempt > maxRetries;
          const retryable = !isLastAttempt && shouldRetry(err, attempt + 1, item);
          opts.onAttemptEnd?.(item, myIndex, attempt, false, err);
          if (!retryable) {
            results[myIndex] = { item, index: myIndex, error: err, attempts: attempt };
            break;
          }
          // 退避后再发起下一次 attempt
          await delay(retryBaseDelayMs * Math.pow(2, attempt - 1));
        }
      }

      if (results[myIndex].attempts === 0) {
        // 防御：理论不会进入；只为类型与日志稳定
        results[myIndex] = { item, index: myIndex, error: lastError, attempts: attempt };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, opts.items.length) }, () => workerLoop());
  await Promise.all(workers);
  return results;
}
