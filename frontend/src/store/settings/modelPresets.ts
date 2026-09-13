/**
 * 模型预设管理
 * 存储：主进程 app_settings_kv 表（key = 'model-presets', value = ModelPreset[]）
 * 非 Electron 环境降级到 localStorage。
 */
import { electronService } from '../../services/electronService';
import { STORAGE_KEYS } from '../../constants/storageKeys';

export interface ModelPreset {
  name: string;
  type: 'llm' | 'tti' | 'tts' | 'itv';
  config: any;
}

const KV_KEY = 'model-presets';

type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

async function kvGet<T>(key: string): Promise<T | null> {
  const res = (await electronService.ipc.invoke('app-kv:get', { key })) as IpcResult<{ value: T | null; updatedAt: number | null }>;
  if (!res || typeof res !== 'object' || !('ok' in res) || res.ok === false) {
    return null;
  }
  return res.data?.value ?? null;
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  const res = (await electronService.ipc.invoke('app-kv:set', { key, value })) as IpcResult<unknown>;
  if (!res || typeof res !== 'object' || !('ok' in res) || res.ok === false) {
    throw new Error(`app-kv:set failed for ${key}`);
  }
}

export async function loadPresets(): Promise<ModelPreset[]> {
  if (!electronService.isElectron()) {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRESETS);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // ignore
    }
    return [];
  }

  try {
    const presets = await kvGet<ModelPreset[]>(KV_KEY);
    return Array.isArray(presets) ? presets : [];
  } catch {
    return [];
  }
}

export async function savePreset(preset: ModelPreset): Promise<void> {
  if (!electronService.isElectron()) {
    const presets = await loadPresets();
    const filtered = presets.filter((p) => p.name !== preset.name);
    filtered.push(preset);
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(filtered));
    return;
  }

  const presets = await loadPresets();
  const filtered = presets.filter((p) => p.name !== preset.name);
  filtered.push(preset);
  await kvSet(KV_KEY, filtered);
}

export async function deletePreset(presetName: string): Promise<void> {
  if (!electronService.isElectron()) {
    const presets = await loadPresets();
    const filtered = presets.filter((p) => p.name !== presetName);
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(filtered));
    return;
  }

  const presets = await loadPresets();
  const filtered = presets.filter((p) => p.name !== presetName);
  await kvSet(KV_KEY, filtered);
}
