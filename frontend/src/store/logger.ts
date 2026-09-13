/**
 * 日志记录系统
 * 支持文件和控制台日志
 */
import { electronService } from '../services/electronService';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 配置
let minLevel: LogLevel = 'info';
let enableConsole = true;
let enableFile = true;

// 写入文件日志（追加模式）
async function writeToFile(entry: LogEntry): Promise<void> {
  if (!electronService.isElectron() || !enableFile) return;

  try {
    await electronService.diagnostics.appendRendererLog({
      ...entry,
      source: 'logger',
    });
  } catch (err) {
    console.error('写入日志文件失败:', err);
  }
}

// 核心日志函数
function log(level: LogLevel, category: string, message: string, data?: any): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    data,
  };

  // 控制台输出
  if (enableConsole) {
    const consoleMethod = level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : level === 'debug' ? console.debug
      : console.info;
    consoleMethod(`[${entry.timestamp}] [${category}] ${message}`, data ?? '');
  }

  // 文件输出
  writeToFile(entry);
}

// 创建分类日志器
export function createLogger(category: string) {
  return {
    debug: (message: string, data?: any) => log('debug', category, message, data),
    info: (message: string, data?: any) => log('info', category, message, data),
    warn: (message: string, data?: any) => log('warn', category, message, data),
    error: (message: string, data?: any) => log('error', category, message, data),
  };
}

// 配置日志系统
export function configureLogger(options: {
  minLevel?: LogLevel;
  enableConsole?: boolean;
  enableFile?: boolean;
  maxFileSize?: number;
  maxFiles?: number;
}) {
  if (options.minLevel !== undefined) minLevel = options.minLevel;
  if (options.enableConsole !== undefined) enableConsole = options.enableConsole;
  if (options.enableFile !== undefined) enableFile = options.enableFile;
  void options.maxFileSize;
  void options.maxFiles;
}

// 清理旧日志
export async function cleanOldLogs(daysToKeep: number = 7): Promise<number> {
  if (!electronService.isElectron()) return 0;
  void daysToKeep;
  const result = await electronService.diagnostics.clearRendererLogs();
  return result.removed;
}

// 获取日志文件列表
export async function getLogFiles(): Promise<{ name: string; size: number; date: string }[]> {
  if (!electronService.isElectron()) return [];

  try {
    const summary = await electronService.diagnostics.listLogs();
    return summary.files
      .filter(file => file.kind === 'renderer')
      .map(file => ({
        name: file.relativePath,
        size: file.size,
        date: new Date(file.modifiedAt).toISOString().split('T')[0],
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    console.error('获取日志列表失败:', err);
    return [];
  }
}

// 默认日志器
export const logger = createLogger('App');

export default {
  createLogger,
  configureLogger,
  cleanOldLogs,
  getLogFiles,
  logger,
};
