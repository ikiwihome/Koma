import { SqliteAppSettingsKvRepository } from '../storage';

const kv = new SqliteAppSettingsKvRepository();

const KEY_LAST_INSTALLED = 'updater-last-installed-version';

function readJson<T>(key: string, fallback: T): T {
  const row = kv.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  kv.set(key, JSON.stringify(value));
}

/**
 * Updater 持久化。
 *
 * 当前只保留一个键：`updater-last-installed-version`——用于 manifestVerifier
 * 的单调递增防降级检查。其他历史键（config / dismissedUntil / pendingVersion）
 * 都已随极简化方案删除：自动检查永远开、不允许 dismiss、channel 概念取消、
 * 是否"已下载等重启"由 electron-updater 内存态管理即可。
 */
export const updaterStore = {
  getLastInstalledVersion(): string | null {
    return readJson<string | null>(KEY_LAST_INSTALLED, null);
  },
  bumpLastInstalledVersion(version: string, compare: (a: string, b: string) => number): void {
    const cur = this.getLastInstalledVersion();
    if (!cur || compare(version, cur) > 0) {
      writeJson(KEY_LAST_INSTALLED, version);
    }
  },
};
