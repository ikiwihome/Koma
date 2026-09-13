import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../electronService', () => ({ electronService: { isElectron: () => true, ipc: { invoke: vi.fn() } } }));
import { electronService } from '../electronService';
import { createPluginAPI } from './PluginAPI';
import type { InstalledPlugin } from '../../types/plugin';

const plugin = { id: 'com.koma.qiniu-image-hosting', isEnabled: true, scopes: ['network:external'] } as InstalledPlugin;
describe('image hosting connection test transport', () => {
  beforeEach(() => vi.mocked(electronService.ipc.invoke).mockReset());
  it('uses the backend so production connect-src does not block the test upload', async () => {
    vi.mocked(electronService.ipc.invoke).mockResolvedValue(true);
    const result = await createPluginAPI(plugin).channels.testProvider('image-hosting', 'qiniu-image-hosting', { enabled: true });
    expect(result.success).toBe(true);
    expect(electronService.ipc.invoke).toHaveBeenCalledWith('controller/plugin/callProvider', {
      kind: 'image-hosting', type: 'qiniu-image-hosting', method: 'testConnection', args: [{ enabled: true }],
    });
  });
  it('does not treat an error object as success', async () => {
    vi.mocked(electronService.ipc.invoke).mockResolvedValue({ success: false, error: 'upload rejected' });
    const result = await createPluginAPI(plugin).channels.testProvider('image-hosting', 'qiniu-image-hosting', {});
    expect(result).toMatchObject({ success: false, error: 'upload rejected' });
  });
  it('checks network permission before calling the backend', async () => {
    const result = await createPluginAPI({ ...plugin, scopes: [] }).channels.testProvider('image-hosting', 'qiniu-image-hosting', {});
    expect(result.success).toBe(false);
    expect(electronService.ipc.invoke).not.toHaveBeenCalled();
  });
});
