/**
 * channelConfigService · Secret Intent 契约测试
 * 验证：
 * 1. dtoToFrontend 不再回传 '$ENC$' 占位符；hasApiKey 作为 UI flag 保留
 * 2. frontendToInput 把空串 / '$ENC$' 解释为"不更新 apiKey"，有值则作为新 key
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcInvokeMock = vi.fn();
vi.mock('./electronService', () => ({
  electronService: {
    isElectron: () => true,
    ipc: { invoke: (channel: string, args?: unknown) => ipcInvokeMock(channel, args) },
  },
}));

import {
  createChannel,
  listChannels,
  updateChannel,
} from './channelConfigService';

beforeEach(() => {
  ipcInvokeMock.mockReset();
});

describe('channelConfigService · Secret Intent Pattern', () => {
  it('dtoToFrontend: hasApiKey=true 时前端 providerConfig.hasApiKey=true，不含 $ENC$ 占位符', async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      ok: true,
      data: [{
        id: 'c1',
        category: 'llm',
        providerType: 'openai',
        name: 'n',
        description: null,
        baseUrl: 'https://api.example.com',
        hasApiKey: true,
        providerConfig: { extra: 1 },
        models: [],
        capabilities: [],
        polling: null,
        extras: {},
        defaultModelId: null,
        source: 'builtin',
        pluginId: null,
        enabled: true,
        isDefault: false,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 2,
      }],
    });

    const [config] = await listChannels();
    const pc = config.providerConfig as Record<string, unknown>;
    expect(pc.hasApiKey).toBe(true);
    expect(pc.apiKey).toBeUndefined();        // 关键：不再回传 $ENC$
    expect(pc.extra).toBe(1);                  // 其它字段保留
    expect(pc.baseUrl).toBe('https://api.example.com');
  });

  it('dtoToFrontend: hasApiKey=false 时前端不携带 hasApiKey', async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      ok: true,
      data: [{
        id: 'c2', category: 'llm', providerType: 'openai', name: 'n',
        description: null, baseUrl: null, hasApiKey: false,
        providerConfig: {}, models: [], capabilities: [], polling: null, extras: {},
        defaultModelId: null, source: 'builtin', pluginId: null,
        enabled: true, isDefault: false, sortOrder: 0, createdAt: 1, updatedAt: 2,
      }],
    });
    const [config] = await listChannels();
    expect((config.providerConfig as any).hasApiKey).toBeUndefined();
  });

  it('frontendToInput: apiKey 空串 → 不更新（删除字段）', async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'new', category: 'llm', providerType: 'openai', name: 'n',
        description: null, baseUrl: null, hasApiKey: false,
        providerConfig: {}, models: [], capabilities: [], polling: null, extras: {},
        defaultModelId: null, source: 'builtin', pluginId: null,
        enabled: true, isDefault: false, sortOrder: 0, createdAt: 1, updatedAt: 2,
      },
    });

    await createChannel({
      category: 'llm',
      providerType: 'openai',
      name: 'n',
      providerConfig: { apiKey: '' }, // 空串
      models: [],
      enabled: true,
      source: 'builtin',
    } as any);

    const [, input] = ipcInvokeMock.mock.calls[0];
    expect(input.providerConfig.apiKey).toBeUndefined();
  });

  it('frontendToInput: apiKey="$ENC$" → 防御性删除，不当真密钥', async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'new', category: 'llm', providerType: 'openai', name: 'n',
        description: null, baseUrl: null, hasApiKey: false,
        providerConfig: {}, models: [], capabilities: [], polling: null, extras: {},
        defaultModelId: null, source: 'builtin', pluginId: null,
        enabled: true, isDefault: false, sortOrder: 0, createdAt: 1, updatedAt: 2,
      },
    });

    await createChannel({
      category: 'llm',
      providerType: 'openai',
      name: 'n',
      providerConfig: { apiKey: '$ENC$' },
      models: [],
      enabled: true,
      source: 'builtin',
    } as any);

    const [, input] = ipcInvokeMock.mock.calls[0];
    expect(input.providerConfig.apiKey).toBeUndefined();
  });

  it('frontendToInput: apiKey 真实字符串 → 透传到后端', async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'new', category: 'llm', providerType: 'openai', name: 'n',
        description: null, baseUrl: null, hasApiKey: true,
        providerConfig: {}, models: [], capabilities: [], polling: null, extras: {},
        defaultModelId: null, source: 'builtin', pluginId: null,
        enabled: true, isDefault: false, sortOrder: 0, createdAt: 1, updatedAt: 2,
      },
    });

    await createChannel({
      category: 'llm',
      providerType: 'openai',
      name: 'n',
      providerConfig: { apiKey: 'sk-real-key' },
      models: [],
      enabled: true,
      source: 'builtin',
    } as any);

    const [, input] = ipcInvokeMock.mock.calls[0];
    expect(input.providerConfig.apiKey).toBe('sk-real-key');
  });

  it('frontendToInput: hasApiKey UI flag 永远不落库', async () => {
    ipcInvokeMock.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'x', category: 'llm', providerType: 'openai', name: 'n',
        description: null, baseUrl: null, hasApiKey: true,
        providerConfig: {}, models: [], capabilities: [], polling: null, extras: {},
        defaultModelId: null, source: 'builtin', pluginId: null,
        enabled: true, isDefault: false, sortOrder: 0, createdAt: 1, updatedAt: 2,
      },
    });

    await updateChannel('x', {
      providerConfig: { apiKey: 'sk-new', hasApiKey: true, extra: 'x' } as any,
    });

    const [, args] = ipcInvokeMock.mock.calls[0];
    expect(args.patch.providerConfig.hasApiKey).toBeUndefined();
    expect(args.patch.providerConfig.apiKey).toBe('sk-new');
    expect(args.patch.providerConfig.extra).toBe('x');
  });
});
