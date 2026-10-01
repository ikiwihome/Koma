import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadFile } from './uploadService';

vi.mock('./ffmpegManager', () => ({ ffmpegManager: {
  getMediaInfo: vi.fn().mockResolvedValue({ duration: 1000, hasVideo: true, width: 64, height: 48 }),
  extractFrames: vi.fn().mockResolvedValue([]),
} }));

describe('desktop media import', () => {
  afterEach(() => { delete (window as any).electronAPI; vi.restoreAllMocks(); });
  const file = () => ({ name: '导入视频.mp4', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as File;
  it('stores media via the native bridge and retains a durable source', async () => {
    const saveUploadedFile = vi.fn().mockResolvedValue({ success: true, path: 'C:/project/assets/videos/video.mp4' });
    (window as any).electronAPI = { assets: { saveUploadedFile } };
    const result = await uploadFile(file(), 'project-1');
    expect(result.success).toBe(true);
    expect(result.asset?.src).toBe('C:/project/assets/videos/video.mp4');
    expect(saveUploadedFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'video', projectId: 'project-1', data: new Uint8Array([1, 2, 3]) }));
  });
  it('never falls back to temporary blob media in Electron with a missing bridge', async () => {
    (window as any).electronAPI = {};
    expect(await uploadFile(file(), 'project-1')).toEqual({ success: false, error: expect.stringContaining('导入服务不可用') });
  });
  it('does not accept a swallowed IPC failure as a successful import', async () => {
    (window as any).electronAPI = { assets: { saveUploadedFile: vi.fn().mockResolvedValue(undefined) } };
    expect((await uploadFile(file(), 'project-1')).success).toBe(false);
  });
});
