import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsMock = vi.fn();
const readFileAsBase64Mock = vi.fn();

vi.mock('./electronService', () => ({
  electronService: {
    isElectron: vi.fn(() => true),
    fs: {
      exists: (path: string) => existsMock(path),
      readFileAsBase64: (path: string) => readFileAsBase64Mock(path),
    },
  },
}));

import { resolveProviderAssetInput } from './mediaAssetResolver';

describe('mediaAssetResolver.resolveProviderAssetInput', () => {
  beforeEach(() => {
    existsMock.mockReset();
    readFileAsBase64Mock.mockReset();
  });

  it('prefers remoteUrl when provided on StoredMediaAsset by default', async () => {
    const result = await resolveProviderAssetInput({
      kind: 'image',
      localPath: '/local/file.png',
      remoteUrl: 'https://cdn.example.com/x.png',
      mimeType: 'image/png',
      createdAt: 1,
    });

    expect(result).toEqual({
      transport: 'remote-url',
      value: 'https://cdn.example.com/x.png',
      mimeType: 'image/png',
    });
    expect(existsMock).not.toHaveBeenCalled();
  });

  it('prefers local file for seedance-style flows when requested', async () => {
    existsMock.mockResolvedValueOnce(true);
    readFileAsBase64Mock.mockResolvedValueOnce('LOCAL_BASE64');

    const result = await resolveProviderAssetInput({
      kind: 'image',
      localPath: '/local/file.png',
      remoteUrl: 'https://cdn.example.com/x.png',
      mimeType: 'image/png',
      createdAt: 1,
    }, {
      preferLocalFile: true,
    });

    expect(existsMock).toHaveBeenCalledWith('/local/file.png');
    expect(readFileAsBase64Mock).toHaveBeenCalledWith('/local/file.png');
    expect(result).toEqual({
      transport: 'data-url',
      value: 'data:image/png;base64,LOCAL_BASE64',
      mimeType: 'image/png',
    });
  });

  it('falls back to remoteUrl when preferred local file is missing', async () => {
    existsMock.mockResolvedValueOnce(false);

    const result = await resolveProviderAssetInput({
      kind: 'image',
      localPath: '/local/missing.png',
      remoteUrl: 'https://cdn.example.com/x.png',
      mimeType: 'image/png',
      createdAt: 1,
    }, {
      preferLocalFile: true,
    });

    expect(existsMock).toHaveBeenCalledWith('/local/missing.png');
    expect(result).toEqual({
      transport: 'remote-url',
      value: 'https://cdn.example.com/x.png',
      mimeType: 'image/png',
    });
  });
});
