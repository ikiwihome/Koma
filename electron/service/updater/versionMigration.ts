/**
 * 版本变更迁移钩子（极简）
 *
 * 启动时比较 `updater-last-installed-version`（KV）与 `app.getVersion()`：
 *   - 不同 → 视为升级（或首次运行新版本），执行迁移
 *   - 相同 → no-op
 *
 * 当前迁移动作只有一项：清空 `~/.koma/plugins-staging/`
 * （插件解压临时区；任何残留对正常运行都是"过时"状态）。
 *
 * 不动 `plugins-runtime/`——`PluginService._syncBuiltinPlugins()` 已经在每次启动
 * 强制覆盖内置插件目录；第三方插件目录留给用户，避免破坏其配置。
 *
 * 必须在 `UpdaterService.start()` 之前调用（否则 KV 已被 bump，永远检测不到差异）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { logger } from 'ee-core/log';

import { getPluginsStagingDir } from '../paths';
import { updaterStore } from './store';

export function runVersionMigrationIfNeeded(): void {
  const currentVersion = app.getVersion();
  const lastVersion = updaterStore.getLastInstalledVersion();

  if (lastVersion === currentVersion) {
    return; // 同版本，无需迁移
  }

  logger.info(
    `[version-migration] version changed: ${lastVersion ?? '(first run)'} -> ${currentVersion}`,
  );

  try {
    clearPluginsStaging();
  } catch (err) {
    // 迁移失败不阻塞启动；UpdaterService 后续仍会写入新版本号
    logger.warn('[version-migration] cleanup failed', err);
  }
}

function clearPluginsStaging(): void {
  const stagingDir = getPluginsStagingDir();
  if (!fs.existsSync(stagingDir)) return;
  const entries = fs.readdirSync(stagingDir);
  for (const entry of entries) {
    const full = path.join(stagingDir, entry);
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`[version-migration] failed to remove ${full}`, err);
    }
  }
  logger.info(`[version-migration] cleared plugins-staging: ${entries.length} entries`);
}
