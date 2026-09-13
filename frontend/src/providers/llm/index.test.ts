import { beforeEach, describe, expect, it, vi } from 'vitest';

const isLLMIPCAvailable = vi.fn();
const IPCLLMProvider = vi.fn();

vi.mock('./IPCLLMProvider', () => ({
  isLLMIPCAvailable,
  IPCLLMProvider,
}));

describe('createLLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('IPC 可用时只创建 IPCLLMProvider', async () => {
    isLLMIPCAvailable.mockReturnValue(true);
    const config = { provider: 'claude', apiKey: 'key', modelName: 'model' } as any;

    const { createLLMProvider } = await import('./index');
    createLLMProvider(config);

    expect(IPCLLMProvider).toHaveBeenCalledWith(config);
  });

  it('IPC 不可用时直接报错，不再直连 fallback', async () => {
    isLLMIPCAvailable.mockReturnValue(false);
    const config = { provider: 'claude', apiKey: 'key', modelName: 'model' } as any;

    const { createLLMProvider } = await import('./index');

    expect(() => createLLMProvider(config)).toThrow(/IPC/);
    expect(IPCLLMProvider).not.toHaveBeenCalled();
  });

  it('IPCLLMProvider 在存在 profileId 时不要求前端 apiKey', async () => {
    const { IPCLLMProvider } = await vi.importActual<typeof import('./IPCLLMProvider')>('./IPCLLMProvider');

    const provider = new IPCLLMProvider({
      provider: 'claude',
      profileId: 'llm-profile-1',
      modelName: 'claude-sonnet',
      apiKey: '',
    } as any);

    expect(provider.validate()).toBe(true);
  });
});
