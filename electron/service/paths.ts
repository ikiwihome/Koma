/**
 * 应用路径职责分离
 *
 * 设计原则：
 * - `userData`（由 Electron `app.getPath('userData')` 给出）= **Chromium / Electron 框架** 自管目录
 *   （Cookies / Local Storage / Cache / SingletonLock 等），业务代码**不应**直接读写
 * - **业务根** = `~/.koma/`，存放：
 *     * settings.db 全局配置 SQLite
 *     * plugins-runtime/  plugins-staging/  插件目录
 *     * logs/  日志
 *     * ffmpeg-cache/  FFmpeg 临时
 *     * projects/  默认项目根（用户可在前端 storageConfig 改到别处）
 *       - projects/{id}/koma.db  项目级 SQLite（剧集 / 分镜 / 时间线 / 媒体绑定）
 *       - projects/{id}/assets/  大文件（图 / 视频 / 音频 / 字体）
 *       - projects/{id}/cache/   缩略图 / 波形 / 预览
 *       - projects/{id}/episodes/{id}/analysis.json  剧集解析结果（嵌套 JSON）
 *

 * 在 main.ts 已通过 `app.setPath('userData', '~/.koma/_userData')` 把 Chromium
 * 内部数据挪到子目录，让业务根目录干净。
 *
 * 任何过去用 `app.getPath('userData')` 拼业务路径的代码都改为本模块的 helper。
 */
import { app } from 'electron';
import * as path from 'node:path';

/** 业务根目录（与默认 storageRoot 一致，固定不可配置） */
export function getBusinessRoot(): string {
  return path.join(app.getPath('home'), '.koma');
}

/** 默认业务日志目录；实际运行时会跟随可配置 storageRoot。 */
export function getBusinessLogsDir(): string {
  return path.join(getBusinessRoot(), 'logs');
}

/** 全局配置 SQLite（settings.db）所在目录 */
export function getSettingsDir(): string {
  return getBusinessRoot();
}

/** 插件运行时目录 */
export function getPluginsRuntimeDir(): string {
  return path.join(getBusinessRoot(), 'plugins-runtime');
}

/** 插件暂存（待安装/解压）目录 */
export function getPluginsStagingDir(): string {
  return path.join(getBusinessRoot(), 'plugins-staging');
}

/** 插件 provider 配置文件 */
export function getPluginProviderConfigPath(): string {
  return path.join(getBusinessRoot(), 'provider-configs.json');
}

/** FFmpeg 临时工作目录 */
export function getFfmpegCacheDir(): string {
  return path.join(getBusinessRoot(), 'ffmpeg-cache');
}

/** FFmpeg 二进制目录（与 cache 区分） */
export function getFfmpegBinDir(): string {
  return path.join(getBusinessRoot(), 'ffmpeg');
}

/** 风格参考图运行时目录（业务根下，便于 koma-local:// 协议直读） */
export function getStyleReferencesDir(): string {
  return path.join(getBusinessRoot(), 'style-references');
}

/** 主程序更新下载缓存（dmg / exe / AppImage 临时落盘点） */
export function getUpdaterCacheDir(): string {
  return path.join(getBusinessRoot(), 'updater-cache');
}

/** 插件 marketplace 下载缓存（plugin zip 临时落盘点） */
export function getMarketplaceCacheDir(): string {
  return path.join(getBusinessRoot(), 'marketplace-cache');
}
