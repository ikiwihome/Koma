/**
 * 统一错误处理模块
 * 提供一致的错误处理、日志记录和用户提示
 */

// 错误严重级别
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

// 错误上下文信息
export interface ErrorContext {
  module?: string;        // 模块名称
  action?: string;        // 操作名称
  severity?: ErrorSeverity;
  silent?: boolean;       // 是否静默（不显示用户提示）
  data?: unknown;         // 附加数据
}

// 错误处理结果
export interface ErrorResult {
  message: string;
  originalError: unknown;
  context?: ErrorContext;
  timestamp: number;
}

// 安全执行结果类型（判别联合）
export type SafeResult<T> =
  | { success: true; data: T }
  | { success: false; error: ErrorResult };

// 错误监听器类型
type ErrorListener = (result: ErrorResult) => void;

// 全局错误监听器列表
const errorListeners: ErrorListener[] = [];

/**
 * 注册错误监听器
 * 用于集成通知系统、错误上报等
 * @param listener - 监听回调
 * @returns 取消注册函数
 */
export function addErrorListener(listener: ErrorListener): () => void {
  errorListeners.push(listener);
  return () => {
    const index = errorListeners.indexOf(listener);
    if (index > -1) {
      errorListeners.splice(index, 1);
    }
  };
}

/**
 * 提取错误消息
 * @param error - 任意错误对象
 * @returns 可读的错误消息
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * 格式化错误上下文标签
 */
function formatContextLabel(context?: ErrorContext): string {
  if (!context) return 'Error';
  const parts: string[] = [];
  if (context.module) parts.push(context.module);
  if (context.action) parts.push(context.action);
  return parts.length > 0 ? parts.join(':') : 'Error';
}

/**
 * 统一错误处理函数
 *
 * @param error - 捕获的错误
 * @param context - 错误上下文（可以是字符串或对象）
 * @returns 错误处理结果
 *
 * @example
 * // 简单用法
 * handleError(error, 'UserService');
 *
 * // 完整用法
 * handleError(error, {
 *   module: 'TTIProvider',
 *   action: 'generateImage',
 *   severity: 'error',
 *   silent: false
 * });
 */
export function handleError(
  error: unknown,
  context?: string | ErrorContext
): ErrorResult {
  // 标准化上下文
  const ctx: ErrorContext = typeof context === 'string'
    ? { module: context }
    : context || {};

  const message = extractErrorMessage(error);
  const label = formatContextLabel(ctx);
  const severity = ctx.severity || 'error';

  // 控制台日志
  const logMessage = `[${label}] ${message}`;
  switch (severity) {
    case 'info':
      console.info(logMessage);
      break;
    case 'warning':
      console.warn(logMessage);
      break;
    case 'critical':
    case 'error':
    default:
      console.error(logMessage, ctx.data ? { data: ctx.data } : '');
  }

  // 构建结果
  const result: ErrorResult = {
    message,
    originalError: error,
    context: ctx,
    timestamp: Date.now(),
  };

  // 通知监听器
  for (const listener of errorListeners) {
    try {
      listener(result);
    } catch (listenerError) {
      console.error('[ErrorHandler] Listener error:', listenerError);
    }
  }

  return result;
}

/**
 * 静默错误处理（仅记录日志，不通知用户）
 * @param error - 捕获的错误
 * @param context - 错误上下文（可以是字符串或对象）
 * @returns 错误处理结果
 */
export function handleSilentError(
  error: unknown,
  context?: string | ErrorContext
): ErrorResult {
  const ctx: ErrorContext = typeof context === 'string'
    ? { module: context, silent: true }
    : { ...context, silent: true };
  return handleError(error, ctx);
}

/**
 * 创建带上下文的错误处理器
 * 用于在特定模块中复用
 * @param module - 模块名称
 * @returns 预设模块上下文的错误处理函数
 *
 * @example
 * const handleTTIError = createErrorHandler('TTIProvider');
 * // 使用
 * handleTTIError(error, 'generateImage');
 */
export function createErrorHandler(module: string) {
  return (error: unknown, action?: string, options?: Omit<ErrorContext, 'module' | 'action'>) => {
    return handleError(error, { module, action, ...options });
  };
}

/**
 * 安全执行异步函数
 * 自动捕获错误并处理
 * @param fn - 需要安全执行的异步函数
 * @param context - 错误上下文（可以是字符串或对象）
 * @returns 成功返回数据，失败返回错误结果
 *
 * @example
 * const result = await safeAsync(
 *   () => fetchData(),
 *   'DataService:fetch'
 * );
 * if (result.success) {
 *   // 使用 result.data
 * }
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  context?: string | ErrorContext
): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const errorResult = handleError(error, context);
    return { success: false, error: errorResult };
  }
}

/**
 * 安全执行同步函数
 * @param fn - 需要安全执行的同步函数
 * @param context - 错误上下文（可以是字符串或对象）
 * @returns 成功返回数据，失败返回错误结果
 */
export function safeSync<T>(
  fn: () => T,
  context?: string | ErrorContext
): SafeResult<T> {
  try {
    const data = fn();
    return { success: true, data };
  } catch (error) {
    const errorResult = handleError(error, context);
    return { success: false, error: errorResult };
  }
}

/**
 * 忽略特定错误的包装器
 * 用于替代 .catch(() => {})
 * @param context - 错误上下文（可以是字符串或对象）
 * @returns 可直接作为 Promise.catch 的回调
 *
 * @example
 * // 替代: audio.play().catch(() => {});
 * audio.play().catch(ignoreError('AudioPlayback'));
 */
export function ignoreError(context?: string | ErrorContext) {
  return (error: unknown) => {
    handleSilentError(error, context);
  };
}

/**
 * Promise 错误处理包装器
 * 用于替代空的 catch 块
 * @param context - 错误上下文（可以是字符串或对象）
 * @returns 可直接作为 Promise.catch 的回调
 *
 * @example
 * // 替代: somePromise.catch(() => {});
 * somePromise.catch(catchAndLog('ModuleName'));
 */
export function catchAndLog(context?: string | ErrorContext) {
  return (error: unknown) => {
    handleError(error, context);
  };
}

export default handleError;
