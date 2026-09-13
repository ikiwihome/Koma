import { beforeEach, describe, expect, it, vi } from 'vitest';

const createProviderInstance = vi.fn();
const createSandboxedFetch = vi.fn(() => fetch);
const loadSettings = vi.fn();

vi.mock('../store/globalStore', () => ({
  loadSettings,
  getDefaultChannelConfig: vi.fn(),
  getChannelsByCapability: vi.fn(),
}));

vi.mock('./registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry')>();
  return {
    ...actual,
    createProviderInstance,
  };
});

vi.mock('../store/pluginStore', () => ({
  usePluginStore: {
    getState: () => ({
      getPlugin: () => ({
        id: 'plugin.tti',
        isEnabled: true,
      }),
    }),
  },
  waitForPluginStoreRehydration: vi.fn(async () => {}),
}));

vi.mock('../services/plugin/PluginSandbox', () => ({
  createSandboxedFetch,
}));

describe('providers plugin resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('插件渠道会通过统一解析入口创建 provider', async () => {
    (globalThis as any).window = { electronAPI: undefined };

    const pluginProvider = {
      validate: () => true,
      testConnection: async () => true,
      start: vi.fn(),
    };
    createProviderInstance.mockReturnValue(pluginProvider);
    loadSettings.mockResolvedValue({
      channelConfigs: [
        {
          id: 'plugin-tti',
          name: 'Plugin TTI',
          category: 'tti',
          providerType: 'plugin-tti-provider',
          providerConfig: { endpoint: 'https://plugin.example.com' },
          defaultModelId: 'plugin-image-pro',
          models: [
            {
              id: 'plugin-image-pro',
              label: 'Plugin Image Pro',
              capabilities: ['image.text-to-image'],
            },
          ],
          enabled: true,
          source: 'plugin',
          pluginId: 'plugin.tti',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      promptTemplates: {},
    });

    const { getProjectTTIProvider } = await import('./index');
    const provider = await getProjectTTIProvider('plugin-tti::plugin-image-pro', 'image.text-to-image');

    expect(createSandboxedFetch).toHaveBeenCalled();
    expect(createProviderInstance).toHaveBeenCalledWith(
      'tti',
      'plugin-tti-provider',
      { endpoint: 'https://plugin.example.com' },
      expect.objectContaining({
        pluginId: 'plugin.tti',
      }),
    );
    expect(provider).toBe(pluginProvider);
  });

  it('显式传入 settingsSnapshot 时不会再读取全局 settings', async () => {
    (globalThis as any).window = { electronAPI: undefined };

    const pluginProvider = {
      validate: () => true,
      testConnection: async () => true,
      start: vi.fn(),
    };
    const settingsSnapshot = {
      channelConfigs: [
        {
          id: 'plugin-tti',
          name: 'Plugin TTI',
          category: 'tti',
          providerType: 'plugin-tti-provider',
          providerConfig: { endpoint: 'https://plugin.example.com' },
          defaultModelId: 'plugin-image-pro',
          models: [
            {
              id: 'plugin-image-pro',
              label: 'Plugin Image Pro',
              capabilities: ['image.text-to-image'],
            },
          ],
          enabled: true,
          source: 'plugin',
          pluginId: 'plugin.tti',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      promptTemplates: {},
    };

    createProviderInstance.mockReturnValue(pluginProvider);
    loadSettings.mockImplementation(async () => {
      throw new Error('loadSettings should not be called when snapshot is provided');
    });

    const { getProjectTTIProvider } = await import('./index');
    const provider = await getProjectTTIProvider(
      'plugin-tti::plugin-image-pro',
      'image.text-to-image',
      settingsSnapshot as any,
    );

    expect(loadSettings).not.toHaveBeenCalled();
    expect(createProviderInstance).toHaveBeenCalledWith(
      'tti',
      'plugin-tti-provider',
      { endpoint: 'https://plugin.example.com' },
      expect.objectContaining({
        pluginId: 'plugin.tti',
      }),
    );
    expect(provider).toBe(pluginProvider);
  });
});
