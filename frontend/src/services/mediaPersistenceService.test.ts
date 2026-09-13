import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persistMediaAsset } from './mediaPersistenceService';

describe('mediaPersistenceService.persistMediaAsset', () => {
  const installElectron = () => {
    const writeFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const copy = vi.fn(async () => undefined);
    const downloadFile = vi.fn(async () => ({ success: true, size: 0 }));

    (window as any).electronAPI = {
      fs: {
        writeFile,
        mkdir,
        copy,
        downloadFile,
      },
    };

    return { writeFile, mkdir, copy, downloadFile };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('persists data-url payload as base64 file content (not treated as a path)', async () => {
    const { writeFile, copy } = installElectron();

    await persistMediaAsset({
      projectId: 'p1',
      kind: 'image',
      source: 'data:image/jpeg;base64,QUJD', // "ABC"
      destPath: '/tmp/out.jpg',
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith('/tmp/out.jpg', 'QUJD', true);
    expect(copy).not.toHaveBeenCalled();
  });
});

