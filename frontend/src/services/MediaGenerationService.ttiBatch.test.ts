import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../providers', () => ({
  getProjectITVProvider: vi.fn(),
  getProjectTTIProvider: vi.fn(),
  getProjectTTSProvider: vi.fn(),
}));

vi.mock('../store/globalStore', () => ({
  loadSettings: vi.fn(async () => {
    throw new Error('skip settings resolution in unit test');
  }),
}));

vi.mock('./mediaPersistenceService', () => ({
  persistMediaAsset: vi.fn(async ({ kind, destPath, source, metadata }: any) => ({
    kind,
    localPath: destPath,
    remoteUrl: typeof source === 'string' && /^https?:\/\//i.test(source) ? source : undefined,
    metadata,
    createdAt: 1,
  })),
}));

vi.mock('./mediaTaskBindingService', () => ({
  bindOwnerRefMedia: vi.fn(async () => {}),
}));

vi.mock('./mediaRemoteUrlService', () => ({
  ensureRemoteUrlForImageAsset: vi.fn(async ({ asset }: any) => asset),
}));

describe('MediaGenerationService.generateImages - TTI batch outputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes count=9 to provider.start and expands batchImages into 9 persisted assets', async () => {
    const { getProjectTTIProvider } = await import('../providers');
    const { persistMediaAsset } = await import('./mediaPersistenceService');
    const imageUrls = Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/face-${index + 1}.png`);
    const batchImages = imageUrls.map((url, index) => ({
      path: url,
      url,
      seed: 111 + index,
    }));
    const start = vi.fn(async () => ({
      mode: 'immediate',
      output: {
        path: imageUrls[0],
        url: imageUrls[0],
        metadata: {
          batchImages,
        },
      },
    }));

    (getProjectTTIProvider as any).mockResolvedValue({
      type: 'grok2api-imagine-tti',
      config: { provider: 'grok2api-imagine-tti' },
      validate: () => true,
      testConnection: async () => true,
      start,
    });

    const { MediaGenerationService } = await import('./MediaGenerationService');
    const svc = new MediaGenerationService();
    const destPath = vi.fn((index: number) => `/tmp/face-${index + 1}.png`);

    const assets = await svc.generateImages({
      projectId: 'project-1',
      ownerRef: {
        projectId: 'project-1',
        ownerType: 'character',
        ownerId: 'char-1',
        slot: 'costumePhoto',
      },
      request: {
        prompt: 'Generate face candidates',
        count: 9,
        options: {
          width: 1024,
          height: 1024,
        },
      },
      destPath,
      bindOwner: false,
      normalizeRemoteUrl: false,
    });

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Generate face candidates',
      count: 9,
    }));
    expect(destPath).toHaveBeenCalledTimes(9);
    expect(destPath).toHaveBeenNthCalledWith(1, 0, expect.objectContaining({ url: imageUrls[0] }));
    expect(destPath).toHaveBeenNthCalledWith(9, 8, expect.objectContaining({ url: imageUrls[8] }));
    expect(persistMediaAsset).toHaveBeenCalledTimes(9);
    expect((persistMediaAsset as any).mock.calls[0][0].destPath).toBe('/tmp/face-1.png');
    expect((persistMediaAsset as any).mock.calls[8][0].destPath).toBe('/tmp/face-9.png');
    expect(assets).toHaveLength(9);
    expect(assets[0]).toEqual(expect.objectContaining({
      localPath: '/tmp/face-1.png',
      remoteUrl: imageUrls[0],
    }));
    expect(assets[8]).toEqual(expect.objectContaining({
      localPath: '/tmp/face-9.png',
      remoteUrl: imageUrls[8],
    }));
    expect(assets[0].metadata).toEqual(expect.objectContaining({
      batchCount: 9,
      batchIndex: 0,
      seed: 111,
    }));
    expect(assets[8].metadata).toEqual(expect.objectContaining({
      batchCount: 9,
      batchIndex: 8,
      seed: 119,
    }));
  });
});
