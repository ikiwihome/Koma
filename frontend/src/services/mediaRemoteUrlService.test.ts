import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./imageHostingService', () => {
  return {
    uploadBytesToImageHostingWithRetry: vi.fn(),
  };
});

vi.mock('./electronService', () => {
  const files = new Map<string, string>();
  const binaryFiles = new Map<string, string>();
  const exists = vi.fn(async (path: string) => files.has(path) || binaryFiles.has(path));
  const readFile = vi.fn(async (path: string) => files.get(path) || '');
  const readFileAsBase64 = vi.fn(async (path: string) => binaryFiles.get(path) || 'AA==');
  const writeFile = vi.fn(async (path: string, data: string) => {
    files.set(path, data);
  });
  const mkdir = vi.fn(async () => undefined);
  return {
    electronService: {
      isElectron: () => true,
      diagnostics: {
        appendRendererLog: vi.fn(async () => ({ success: true })),
      },
      fs: {
        exists,
        readFile,
        readFileAsBase64,
        writeFile,
        mkdir,
      },
    },
    __remoteUrlServiceTestFiles: files,
    __remoteUrlServiceTestBinaryFiles: binaryFiles,
    __remoteUrlServiceTestFsMocks: { exists, readFile, readFileAsBase64, writeFile, mkdir },
  };
});

vi.mock('../store/project/core', () => ({
  getProjectPath: vi.fn(async (projectId: string) => `/tmp/${projectId}`),
}));

vi.mock('../utils/safeFetch', () => ({
  safeFetch: vi.fn(async () => new Response('', { status: 200 })),
}));

describe('mediaRemoteUrlService.ensureRemoteUrlForImageAsset', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const electronModule = await import('./electronService') as unknown as {
      __remoteUrlServiceTestFiles: Map<string, string>;
      __remoteUrlServiceTestBinaryFiles: Map<string, string>;
    };
    electronModule.__remoteUrlServiceTestFiles.clear();
    electronModule.__remoteUrlServiceTestBinaryFiles.clear();

    const { safeFetch } = await import('../utils/safeFetch');
    vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 200 }));
  });

  it('uploads data-url bytes and fills remoteUrl (best-effort success)', async () => {
    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    (uploadBytesToImageHostingWithRetry as any).mockResolvedValue({
      success: true,
      url: 'https://cdn.example.com/out.png',
    });

    const { ensureRemoteUrlForImageAsset } = await import('./mediaRemoteUrlService');

    const asset = await ensureRemoteUrlForImageAsset({
      projectId: 'p1',
      policy: 'best-effort',
      asset: {
        kind: 'image',
        localPath: 'data:image/png;base64,AA==',
        createdAt: 1,
      },
    });

    expect(asset.remoteUrl).toBe('https://cdn.example.com/out.png');
  });

  it('throws when upload fails and policy is required', async () => {
    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    (uploadBytesToImageHostingWithRetry as any).mockResolvedValue({
      success: false,
      error: 'nope',
    });

    const { ensureRemoteUrlForImageAsset } = await import('./mediaRemoteUrlService');

    await expect(
      ensureRemoteUrlForImageAsset({
        projectId: 'p1',
        policy: 'required',
        asset: {
          kind: 'image',
          localPath: 'data:image/png;base64,AA==',
          createdAt: 1,
        },
      })
    ).rejects.toThrow('nope');
  });

  it('uploads multiple image sources sequentially with unique filenames', async () => {
    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    const uploadMock = uploadBytesToImageHostingWithRetry as any;
    uploadMock
      .mockResolvedValueOnce({ success: true, url: 'https://cdn.example.com/1.png' })
      .mockResolvedValueOnce({ success: true, url: 'https://cdn.example.com/2.png' });

    const { ensureRemoteUrlForImageSources } = await import('./mediaRemoteUrlService');

    const result = await ensureRemoteUrlForImageSources({
      projectId: 'p1',
      policy: 'required',
      sources: [
        'data:image/jpeg;base64,AA==',
        'data:image/jpeg;base64,BB==',
      ],
    });

    expect(result).toEqual([
      'https://cdn.example.com/1.png',
      'https://cdn.example.com/2.png',
    ]);
    expect(uploadMock.mock.calls[0][1]).toEqual({ filename: 'image-1.jpg' });
    expect(uploadMock.mock.calls[1][1]).toEqual({ filename: 'image-2.jpg' });
  });

  it('dedupes repeated sources in one normalization batch', async () => {
    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    const uploadMock = uploadBytesToImageHostingWithRetry as any;
    uploadMock.mockResolvedValue({ success: true, url: 'https://cdn.example.com/shared.png' });

    const { ensureRemoteUrlForImageSources } = await import('./mediaRemoteUrlService');

    const result = await ensureRemoteUrlForImageSources({
      projectId: 'p1',
      policy: 'required',
      sources: [
        'data:image/jpeg;base64,AA==',
        'data:image/jpeg;base64,AA==',
      ],
    });

    expect(result).toEqual([
      'https://cdn.example.com/shared.png',
      'https://cdn.example.com/shared.png',
    ]);
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('reuses cached remote url when reachable', async () => {
    const electronModule = await import('./electronService') as unknown as {
      __remoteUrlServiceTestFiles: Map<string, string>;
    };
    electronModule.__remoteUrlServiceTestFiles.set(
      '/tmp/p1/metadata/media-remote-url-cache.json',
      JSON.stringify({
        version: 1,
        entries: {
          'local:/tmp/source.png': {
            sourceKey: 'local:/tmp/source.png',
            sourceKind: 'local-file',
            localPath: '/tmp/source.png',
            remoteUrl: 'https://cdn.example.com/cached.png',
            updatedAt: 1,
          },
        },
      }),
    );

    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    const { ensureRemoteUrlForImageSources } = await import('./mediaRemoteUrlService');

    const result = await ensureRemoteUrlForImageSources({
      projectId: 'p1',
      policy: 'required',
      sources: ['/tmp/source.png'],
    });

    expect(result).toEqual(['https://cdn.example.com/cached.png']);
    expect(uploadBytesToImageHostingWithRetry).not.toHaveBeenCalled();
  });

  it('prefers local-path cache over stale asset remoteUrl', async () => {
    const electronModule = await import('./electronService') as unknown as {
      __remoteUrlServiceTestFiles: Map<string, string>;
    };
    electronModule.__remoteUrlServiceTestFiles.set(
      '/tmp/p1/metadata/media-remote-url-cache.json',
      JSON.stringify({
        version: 1,
        entries: {
          'local:/tmp/asset.png': {
            sourceKey: 'local:/tmp/asset.png',
            sourceKind: 'asset',
            localPath: '/tmp/asset.png',
            remoteUrl: 'https://cdn.example.com/fresh.png',
            updatedAt: 1,
          },
        },
      }),
    );

    const { safeFetch } = await import('../utils/safeFetch');
    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    const { ensureRemoteUrlForImageAsset } = await import('./mediaRemoteUrlService');

    const result = await ensureRemoteUrlForImageAsset({
      projectId: 'p1',
      policy: 'required',
      asset: {
        kind: 'image',
        localPath: '/tmp/asset.png',
        remoteUrl: 'https://cdn.example.com/stale.png',
        createdAt: 1,
      },
    });

    expect(result.remoteUrl).toBe('https://cdn.example.com/fresh.png');
    expect(uploadBytesToImageHostingWithRetry).not.toHaveBeenCalled();
    expect(vi.mocked(safeFetch).mock.calls.map(call => call[0])).toEqual([
      'https://cdn.example.com/fresh.png',
    ]);
  });

  it('stores reachable asset remoteUrl in local-path cache', async () => {
    const electronModule = await import('./electronService') as unknown as {
      __remoteUrlServiceTestFiles: Map<string, string>;
    };
    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    const { ensureRemoteUrlForImageAsset } = await import('./mediaRemoteUrlService');

    const result = await ensureRemoteUrlForImageAsset({
      projectId: 'p1',
      policy: 'required',
      asset: {
        kind: 'image',
        localPath: '/tmp/asset.png',
        remoteUrl: 'https://cdn.example.com/original.png',
        createdAt: 1,
      },
    });

    expect(result.remoteUrl).toBe('https://cdn.example.com/original.png');
    expect(uploadBytesToImageHostingWithRetry).not.toHaveBeenCalled();
    expect(electronModule.__remoteUrlServiceTestFiles.get('/tmp/p1/metadata/media-remote-url-cache.json'))
      .toContain('https://cdn.example.com/original.png');
  });

  it('reuploads and updates cache when cached remote url is unreachable', async () => {
    const electronModule = await import('./electronService') as unknown as {
      __remoteUrlServiceTestFiles: Map<string, string>;
    };
    electronModule.__remoteUrlServiceTestFiles.set(
      '/tmp/p1/metadata/media-remote-url-cache.json',
      JSON.stringify({
        version: 1,
        entries: {
          'local:/tmp/stale.png': {
            sourceKey: 'local:/tmp/stale.png',
            sourceKind: 'local-file',
            localPath: '/tmp/stale.png',
            remoteUrl: 'https://cdn.example.com/stale.png',
            updatedAt: 1,
          },
        },
      }),
    );
    const electronBinaryModule = electronModule as typeof electronModule & {
      __remoteUrlServiceTestBinaryFiles: Map<string, string>;
    };
    electronBinaryModule.__remoteUrlServiceTestBinaryFiles.set('/tmp/stale.png', 'AA==');
    const { safeFetch } = await import('../utils/safeFetch');
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response('', { status: 404 }));

    const { uploadBytesToImageHostingWithRetry } = await import('./imageHostingService');
    const uploadMock = uploadBytesToImageHostingWithRetry as any;
    uploadMock.mockResolvedValue({ success: true, url: 'https://cdn.example.com/fresh.png' });

    const { ensureRemoteUrlForImageSources } = await import('./mediaRemoteUrlService');
    const result = await ensureRemoteUrlForImageSources({
      projectId: 'p1',
      policy: 'required',
      sources: ['/tmp/stale.png'],
    });

    expect(result).toEqual(['https://cdn.example.com/fresh.png']);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(electronModule.__remoteUrlServiceTestFiles.get('/tmp/p1/metadata/media-remote-url-cache.json'))
      .toContain('https://cdn.example.com/fresh.png');
  });
});
