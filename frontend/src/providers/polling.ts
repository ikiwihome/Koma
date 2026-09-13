/**
 * 轮询工具函数
 * 统一处理异步任务的轮询逻辑
 */
import type { ProgressInfo } from '../types';

// 轮询配置（定义在这里避免循环依赖）
export interface PollingConfig {
  interval: number;      // 轮询间隔（毫秒）
  maxDuration: number;   // 最大等待时间（毫秒）
  initialDelay?: number; // 首次查询延迟（毫秒）
}

// 轮询参数
export interface PollTaskParams<TProgress extends ProgressInfo> {
  submit: () => Promise<string>;
  check: (taskId: string) => Promise<TProgress>;
  polling: PollingConfig;
  onProgress?: (progress: TProgress) => void;
  signal?: AbortSignal;
}

// 延迟函数（修复 abort 监听器泄漏）
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // 提前检查是否已取消
    if (signal?.aborted) {
      reject(new Error('任务已取消'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      // 使用 { once: true } 防止监听器泄漏
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('任务已取消'));
      }, { once: true });
    }
  });
}

/**
 * 轮询任务直到完成或失败
 */
export async function pollTask<TProgress extends ProgressInfo>(
  params: PollTaskParams<TProgress>
): Promise<TProgress> {
  const { submit, check, polling, onProgress, signal } = params;

  // 提交任务
  const taskId = await submit();
  const startTime = Date.now();

  // 初始延迟
  if (polling.initialDelay && polling.initialDelay > 0) {
    await delay(polling.initialDelay, signal);
  }

  // 轮询循环
  while (Date.now() - startTime < polling.maxDuration) {
    if (signal?.aborted) {
      throw new Error('任务已取消');
    }

    const progress = await check(taskId);
    onProgress?.(progress);

    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }

    await delay(polling.interval, signal);
  }

  // 超时
  throw new Error(`任务超时 (${polling.maxDuration}ms)`);
}

/**
 * 简化版轮询（用于已有 taskId 的情况）
 */
export async function pollTaskById<TProgress extends ProgressInfo>(
  taskId: string,
  check: (taskId: string) => Promise<TProgress>,
  polling: PollingConfig,
  onProgress?: (progress: TProgress) => void,
  signal?: AbortSignal
): Promise<TProgress> {
  const startTime = Date.now();

  // 初始延迟
  if (polling.initialDelay && polling.initialDelay > 0) {
    await delay(polling.initialDelay, signal);
  }

  // 轮询循环
  while (Date.now() - startTime < polling.maxDuration) {
    if (signal?.aborted) {
      throw new Error('任务已取消');
    }

    const progress = await check(taskId);
    onProgress?.(progress);

    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }

    await delay(polling.interval, signal);
  }

  // 超时
  throw new Error(`任务超时 (${polling.maxDuration}ms)`);
}

// 默认轮询配置
export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  interval: 3000,       // 3秒
  maxDuration: 600000,  // 10分钟
  initialDelay: 2000,   // 2秒
};
