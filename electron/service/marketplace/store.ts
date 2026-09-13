import { SqliteAppSettingsKvRepository } from '../storage';
import type { MarketplaceConfig } from './types';

const kv = new SqliteAppSettingsKvRepository();

const KEY_CONFIG = 'marketplace-config';
const KEY_LAST_CHECK = 'marketplace-last-check-at';
const KEY_REGISTRY_ETAG = 'marketplace-registry-etag';
const KEY_VERSIONS_CACHE = 'marketplace-plugin-versions-cache';

const DEFAULT_CONFIG: MarketplaceConfig = { autoCheck: true };

function readJson<T>(key: string, fallback: T): T {
  const row = kv.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, v: unknown): void {
  kv.set(key, JSON.stringify(v));
}

export const marketplaceStore = {
  getConfig(): MarketplaceConfig {
    return { ...DEFAULT_CONFIG, ...readJson<Partial<MarketplaceConfig>>(KEY_CONFIG, {}) };
  },
  setConfig(cfg: Partial<MarketplaceConfig>): MarketplaceConfig {
    const next = { ...this.getConfig(), ...cfg };
    writeJson(KEY_CONFIG, next);
    return next;
  },

  getLastCheckedAt(): string | null {
    return readJson<string | null>(KEY_LAST_CHECK, null);
  },
  setLastCheckedAt(iso: string): void {
    writeJson(KEY_LAST_CHECK, iso);
  },

  getRegistryEtag(): string | null {
    return readJson<string | null>(KEY_REGISTRY_ETAG, null);
  },
  setRegistryEtag(etag: string | null): void {
    if (etag == null) kv.delete(KEY_REGISTRY_ETAG);
    else writeJson(KEY_REGISTRY_ETAG, etag);
  },

  /**
   * 已安装过的最高版本号锚点（按插件 id），用于防降级。
   * 即使插件被卸载也保留，避免攻击者诱导"卸载 → 装回旧版"。
   */
  getInstalledVersion(pluginId: string): string | null {
    const map = readJson<Record<string, string>>(KEY_VERSIONS_CACHE, {});
    return map[pluginId] ?? null;
  },
  bumpInstalledVersion(pluginId: string, version: string, compare: (a: string, b: string) => number): void {
    const map = readJson<Record<string, string>>(KEY_VERSIONS_CACHE, {});
    const cur = map[pluginId];
    if (!cur || compare(version, cur) > 0) {
      map[pluginId] = version;
      writeJson(KEY_VERSIONS_CACHE, map);
    }
  },
};
