import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('chatIPC llm client', () => {
  beforeEach(() => {
    delete (window as typeof window & { electronAPI?: unknown }).electronAPI;
  });

  it('testLLMConnection 调用 preload 中的 llm.testConnection', async () => {
    const testConnection = vi.fn(async () => ({ success: true }));

    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      llm: {
        query: vi.fn(),
        testConnection,
      },
    };

    const { testLLMConnection } = await import('./chatIPC');
    const payload = {
      provider: 'claude',
      apiKey: 'key',
      modelName: 'model',
    };

    await expect(testLLMConnection(payload as any)).resolves.toEqual({ success: true });
    expect(testConnection).toHaveBeenCalledWith(payload);
  });

  it('testLLMConnection 支持 profileId 形式的后端配置引用', async () => {
    const testConnection = vi.fn(async () => ({ success: true }));

    (window as typeof window & { electronAPI?: unknown }).electronAPI = {
      llm: {
        query: vi.fn(),
        testConnection,
      },
    };

    const { testLLMConnection } = await import('./chatIPC');
    const payload = {
      profileId: 'channel-1',
      modelProvider: 'anthropic',
      modelName: 'claude-sonnet',
    };

    await expect(testLLMConnection(payload as any)).resolves.toEqual({ success: true });
    expect(testConnection).toHaveBeenCalledWith(payload);
  });
});
