/**
 * Koma TTS 内置音色试听样本：通过 IPC 解析绝对路径，再走 koma-local:// 给 <audio>。
 *
 * 缓存：sampleFile → koma-local URL。同一 sample 的 IPC 只调一次。
 * Electron 不可用 / 路径未解析时返回空串，调用方据此隐藏试听 UI。
 */
import { ipc, ipcApiRoute } from '../utils/ipcRenderer';
import { electronService } from './electronService';

const cache = new Map<string, string>();

export async function getKomaTTSVoiceSampleUrl(sampleFile?: string): Promise<string> {
  const key = String(sampleFile || '').trim();
  if (!key) return '';
  if (cache.has(key)) return cache.get(key) || '';
  if (!electronService.isElectron()) {
    cache.set(key, '');
    return '';
  }
  try {
    const result = await ipc.invoke(
      ipcApiRoute.app.getKomaTTSVoiceSamplePath,
      { sampleFile: key },
    ) as { localPath: string | null } | null;
    const localPath = result?.localPath;
    if (!localPath) {
      cache.set(key, '');
      return '';
    }
    const url = electronService.fs.toLocalUrl(localPath);
    cache.set(key, url);
    return url;
  } catch {
    cache.set(key, '');
    return '';
  }
}

export function clearKomaTTSVoiceSampleCache(): void {
  cache.clear();
}
