/**
 * 平台策略 — 决定当前运行环境用哪条更新路径。
 *
 * - Windows NSIS：标准 electron-updater 流程
 * - Windows portable：不支持自动更新，仅引导手动下载
 * - macOS dmg：未签名期间过渡方案——下载到本地缓存 → 客户端 ed25519 验签 →
 *              shell.openPath 弹 Finder 让用户手动拖到 Applications；不替换正在运行的 .app
 * - Linux AppImage：electron-updater 原生支持，via APPIMAGE 环境变量原地替换
 *
 * 实际安装动作由 UpdaterService 调用各 strategy.install() 完成；本模块只负责
 * "我是谁、能不能自动更新、走哪条链路"的判定。
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { PlatformInfo, PlatformKey } from './types';

export function detectPlatformInfo(_execPath: string): PlatformInfo {
  if (process.platform === 'darwin') {
    const key: PlatformKey =
      process.arch === 'arm64' ? 'mac-arm64-dmg' : 'mac-x64-dmg';
    // canAutoUpdate=true 让 download() 走 mac-dmg-guided 分支（后台下载 dmg + 验签
    // + 用 Finder 弹出引导用户拖到 Applications）；useElectronUpdater=false
    // 是因为未签名包不能调 Squirrel.Mac 的 quitAndInstall。
    return { key, canAutoUpdate: true, useElectronUpdater: false };
  }
  if (process.platform === 'linux') {
    // electron-updater 通过 APPIMAGE 环境变量判定是否 AppImage 运行
    if (process.env.APPIMAGE) {
      return { key: 'linux-x64-appimage', canAutoUpdate: true, useElectronUpdater: true };
    }
    return { key: 'unsupported', canAutoUpdate: false, useElectronUpdater: false };
  }
  if (process.platform === 'win32') {
    // 简易启发式：portable 版本的 exe 通常解压在临时目录或非标准路径，无 uninstall
    // 这里直接根据 process.env.PORTABLE_EXECUTABLE_FILE（electron-builder portable 设的）判断
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      return { key: 'win-x64-portable', canAutoUpdate: false, useElectronUpdater: false };
    }
    return { key: 'win-x64-nsis', canAutoUpdate: true, useElectronUpdater: true };
  }
  return { key: 'unsupported', canAutoUpdate: false, useElectronUpdater: false };
}

/** manifest.platforms 里对应当前平台的 key（key 与 detectPlatformInfo 返回一致） */
export function manifestKeyForCurrent(): PlatformKey {
  return detectPlatformInfo(process.execPath).key;
}

/** 在 cache 目录里给 mac dmg 起一个稳定文件名（用 version + key），便于幂等下载 */
export function macDmgCacheName(version: string, key: PlatformKey): string {
  return `Koma-Studio-${version}-${key}.dmg`;
}

export function isMacGuidedFlow(info: PlatformInfo): boolean {
  return info.key === 'mac-x64-dmg' || info.key === 'mac-arm64-dmg';
}

export { os as _os, path as _path }; // keep imports useful for callers via re-export
