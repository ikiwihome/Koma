import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmQuery = vi.fn();
const llmQueryStream = vi.fn();
const testLLMConnection = vi.fn();

vi.mock('../../chat/ipc/chatIPC', () => ({
  llmQuery,
  llmQueryStream,
  testLLMConnection,
  isLLMIPCAvailable: () => true,
}));

describe('IPCLLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateText 会把 profileId 一起带到 llmQuery', async () => {
    llmQuery.mockResolvedValue({ content: 'ok' });
    const { IPCLLMProvider } = await import('./IPCLLMProvider');
    const provider = new IPCLLMProvider({
      provider: 'claude',
      profileId: 'channel-1',
      modelName: 'claude-sonnet',
      apiKey: '',
    } as any);

    await provider.generateText('hello');

    expect(llmQuery).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        profileId: 'channel-1',
      }),
    }));
  });

  it('generateText 在提供 onChunk 时会自动走 llmQueryStream', async () => {
    llmQueryStream.mockImplementation(async (_request, onChunk) => {
      onChunk?.('增量', '增量');
      return { content: '增量' };
    });

    const { IPCLLMProvider } = await import('./IPCLLMProvider');
    const provider = new IPCLLMProvider({
      provider: 'openai',
      profileId: 'channel-1',
      modelName: 'gpt-4o-mini',
      apiKey: '',
    } as any);
    const onChunk = vi.fn();

    const result = await provider.generateText('hello', undefined, { onChunk });

    expect(result).toBe('增量');
    expect(llmQueryStream).toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith('增量', '增量');
  });

  it('chat 在 stream 模式下会把 onChunk 透传到 llmQueryStream', async () => {
    llmQueryStream.mockImplementation(async (_request, onChunk) => {
      onChunk?.('片段', '片段');
      return { content: '片段' };
    });

    const { IPCLLMProvider } = await import('./IPCLLMProvider');
    const provider = new IPCLLMProvider({
      provider: 'openai',
      profileId: 'channel-1',
      modelName: 'gpt-4o-mini',
      apiKey: '',
    } as any);
    const onChunk = vi.fn();

    const result = await provider.chat([
      { role: 'user', content: 'hello' },
    ], { stream: true }, onChunk);

    expect(result).toBe('片段');
    expect(llmQueryStream).toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith('片段', '片段');
  });
});
