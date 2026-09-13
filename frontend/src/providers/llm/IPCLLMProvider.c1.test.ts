/**
 * IPCLLMProvider.mapProvider 契约测试（Round3 C1 · 端到端放宽）
 * 验证：
 * 1. 别名归一化（claude → anthropic, gemini → google）
 * 2. openai-compatible 原样透传（不再被吞为 'openai'）
 * 3. 插件 provider string 原样透传
 * 4. 未知 provider 不抛错（Round2 的白名单校验已移除）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmQueryMock = vi.fn();
const llmQueryStreamMock = vi.fn();
const testLLMConnectionMock = vi.fn();

vi.mock('../../chat/ipc/chatIPC', () => ({
  llmQuery: (req: any) => llmQueryMock(req),
  llmQueryStream: (req: any, onChunk?: any) => llmQueryStreamMock(req, onChunk),
  isLLMIPCAvailable: () => true,
  testLLMConnection: (req: any) => testLLMConnectionMock(req),
}));

import { IPCLLMProvider } from './IPCLLMProvider';

beforeEach(() => {
  llmQueryMock.mockReset();
  llmQueryStreamMock.mockReset();
  testLLMConnectionMock.mockReset();
  llmQueryMock.mockResolvedValue({ content: 'ok' });
  llmQueryStreamMock.mockResolvedValue({ content: 'ok' });
  testLLMConnectionMock.mockResolvedValue({ success: true });
});

function makeProvider(providerName: string) {
  return new IPCLLMProvider({
    provider: providerName,
    apiKey: 'sk',
    modelName: 'mx',
  } as any);
}

describe('IPCLLMProvider.mapProvider · C1 放宽契约', () => {
  it('claude → anthropic 别名归一化', async () => {
    await makeProvider('claude').chat([] as any);
    expect(llmQueryMock.mock.calls[0][0].config.modelProvider).toBe('anthropic');
  });

  it('gemini → google 别名归一化', async () => {
    await makeProvider('gemini').chat([] as any);
    expect(llmQueryMock.mock.calls[0][0].config.modelProvider).toBe('google');
  });

  it('openai 原样透传', async () => {
    await makeProvider('openai').chat([] as any);
    expect(llmQueryMock.mock.calls[0][0].config.modelProvider).toBe('openai');
  });

  it('openai-compatible 原样透传（Round3 放宽：不再收敛为 openai）', async () => {
    await makeProvider('openai-compatible').chat([] as any);
    expect(llmQueryMock.mock.calls[0][0].config.modelProvider).toBe('openai-compatible');
  });

  it('plugin provider string 原样透传', async () => {
    await makeProvider('my-plugin-llm').chat([] as any);
    expect(llmQueryMock.mock.calls[0][0].config.modelProvider).toBe('my-plugin-llm');
  });

  it('未知 provider 不抛错（Round2 白名单已移除）', async () => {
    await expect(makeProvider('unknown-vendor').chat([] as any)).resolves.toBeDefined();
  });

  it('testConnection 走相同归一化', async () => {
    await makeProvider('claude').testConnection();
    expect(testLLMConnectionMock.mock.calls[0][0].modelProvider).toBe('anthropic');
  });

  it('validate: profileId 或 apiKey + modelName 有效', () => {
    expect(new IPCLLMProvider({ provider: 'openai', profileId: 'x', modelName: 'm' } as any).validate()).toBe(true);
    expect(new IPCLLMProvider({ provider: 'openai', apiKey: 'k', modelName: 'm' } as any).validate()).toBe(true);
    expect(new IPCLLMProvider({ provider: 'openai' } as any).validate()).toBe(false);
  });
});
