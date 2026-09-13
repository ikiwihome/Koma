import { afterEach, describe, expect, it } from 'vitest';
import { diagnosticsListLogs, windowIsMaximized } from './electronService';

describe('electronService window state', () => {
  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('兼容主进程返回对象形式的窗口状态', async () => {
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      window: {
        isMaximized: async () => ({ isMaximized: true }),
      },
    };

    await expect(windowIsMaximized()).resolves.toBe(true);
  });

  it('在非 Electron 环境下返回 false', async () => {
    await expect(windowIsMaximized()).resolves.toBe(false);
  });
});

describe('electronService diagnostics', () => {
  afterEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('在非 Electron 环境下返回空日志摘要', async () => {
    await expect(diagnosticsListLogs()).resolves.toEqual({
      storageRoot: '',
      logsDir: '',
      electronLogsDir: '',
      files: [],
      totalSize: 0,
    });
  });

  it('通过 diagnostics 命名空间读取日志摘要', async () => {
    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      diagnostics: {
        listLogs: async () => ({
          storageRoot: '/tmp/koma',
          logsDir: '/tmp/koma/logs',
          electronLogsDir: '/tmp/koma/logs',
          files: [{ name: 'koma.log', relativePath: 'koma.log', size: 12, modifiedAt: 1, kind: 'main' }],
          totalSize: 12,
        }),
      },
    };

    await expect(diagnosticsListLogs()).resolves.toMatchObject({
      logsDir: '/tmp/koma/logs',
      totalSize: 12,
    });
  });
});
