import { beforeEach, describe, expect, it, vi } from 'vitest';

const listChannelsMock = vi.fn();

vi.mock('../../services/channelConfigService', () => ({
  listChannels: (...args: unknown[]) => listChannelsMock(...args),
  listMediaDefaults: vi.fn(async () => ({})),
  getMediaDefault: vi.fn(async () => null),
  setMediaDefault: vi.fn(),
  deleteMediaDefault: vi.fn(async () => true),
  getChannel: vi.fn(async () => null),
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(async () => true),
  bulkImportChannels: vi.fn(),
  countChannels: vi.fn(async () => 0),
}));

vi.mock('../../services/electronService', () => ({
  electronService: { isElectron: () => true },
}));

describe('channelConfig legacy image-hosting compatibility', () => {
  beforeEach(() => {
    listChannelsMock.mockReset();
  });

  it('按能力查询时会识别缺少 category 的老图床渠道', async () => {
    listChannelsMock.mockResolvedValue([
      {
        id: 'hosting-legacy',
        name: 'SCDN 图床',
        providerType: 'scdn-image-hosting',
        providerConfig: { enabled: true },
        capabilities: ['image-hosting'],
        enabled: true,
        source: 'plugin',
        pluginId: 'com.koma.scdn-image-hosting',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { getChannelsByCapability } = await import('./channelConfig');
    const channels = await getChannelsByCapability('image-hosting');

    expect(channels).toHaveLength(1);
    expect(channels[0]?.id).toBe('hosting-legacy');
  });

  it('读取默认图床渠道时会兼容老配置格式', async () => {
    listChannelsMock.mockResolvedValue([
      {
        id: 'hosting-legacy',
        name: 'SCDN 图床',
        providerType: 'scdn-image-hosting',
        providerConfig: { enabled: true },
        capabilities: ['image-hosting'],
        enabled: true,
        source: 'plugin',
        pluginId: 'com.koma.scdn-image-hosting',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { getDefaultChannelConfig } = await import('./channelConfig');
    const channel = await getDefaultChannelConfig('image-hosting');

    expect(channel?.id).toBe('hosting-legacy');
  });
});
