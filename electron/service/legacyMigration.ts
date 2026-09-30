/**
 * 旧版家目录残留迁移（幂等）
 *
 * 历史版本里 ee-core 会把框架自管目录建在 `~/.<app 名>` 下
 * （原因与修复方式见 `electron/main.ts` 里对 `EE_CORE_APP_NAME` 的说明），
 * 于是用户家目录里会多出一个 `.AI短剧生成工具/{data,logs}`。
 * 现在这些目录统一落到业务根 `~/.koma/`，但升级上来的机器上旧目录不会自己消失，
 * 所以每次启动做一次 best-effort 迁移：
 *   1. 把旧 `logs/*.log` 搬进 `~/.koma/logs/`（保留历史日志；同名则保留新目录里那份）
 *   2. 删掉旧目录
 *
 * 任何一步失败都只记日志不抛错 —— 例如旧版本进程还开着、文件被占用，下次启动再试。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { logger } from 'ee-core/log';

import { getBusinessLogsDir } from './paths';

/** 旧版 ee-core 用 `'.' + app.getName()` 拼出来的目录名（= main.ts 里的 APP_DISPLAY_NAME） */
const LEGACY_APP_HOME_DIR_NAME = '.AI短剧生成工具';

export function migrateLegacyAppHomeDir(): void {
  const legacyDir = path.join(app.getPath('home'), LEGACY_APP_HOME_DIR_NAME);
  if (!fs.existsSync(legacyDir)) return;

  const logsDir = getBusinessLogsDir();
  let moved = 0;

  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const legacyLogsDir = path.join(legacyDir, 'logs');
    if (fs.existsSync(legacyLogsDir)) {
      for (const entry of fs.readdirSync(legacyLogsDir)) {
        const from = path.join(legacyLogsDir, entry);
        const to = path.join(logsDir, entry);
        try {
          if (fs.existsSync(to)) {
            // 同名日志（同一天）已经在业务根里，丢弃旧副本即可
            fs.rmSync(from, { force: true });
          } else {
            fs.renameSync(from, to);
            moved += 1;
          }
        } catch (err) {
          logger.warn(`[legacy-migration] failed to move ${from}`, err);
        }
      }
    }
  } catch (err) {
    logger.warn('[legacy-migration] failed to prepare logs dir', err);
  }

  try {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    logger.info(`[legacy-migration] removed legacy dir ${legacyDir} (moved ${moved} log files)`);
  } catch (err) {
    logger.warn(`[legacy-migration] failed to remove legacy dir ${legacyDir}`, err);
  }
}
