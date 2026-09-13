/**
 * 更新状态机 — 5 个状态。
 *   idle        无更新 / 已检查过 / 还没开始
 *   checking    正在拉 manifest
 *   downloading 正在下载安装包
 *   downloaded  下载完毕，等用户点"重启以更新"
 *   failed      最近一次检查 / 下载失败（用户不直接看到，UI 静默自重试）
 *
 * 历史上有过 update-available / silent / ready-to-install / installing 等中间态，
 * 已统一砍掉：用户只关心"能不能点一下更新"，前端只需通过 `availableVersion` + `kind`
 * 就能完全决定按钮显隐与文案。
 */
export type UpdaterStateKind = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'failed';

export interface UpdaterState {
  kind: UpdaterStateKind;
  /** 检测到的新版本号；无更新时 undefined。前端只看这一项决定按钮是否出现。 */
  availableVersion?: string;
  /** 当前已安装版本（始终带上，About 子页用） */
  currentVersion: string;
  /** 下载进度 0..1 */
  downloadProgress?: number;
  /** 失败原因（仅日志/排查用，UI 不显示文案） */
  error?: { message: string; detail?: string };
}

export type PlatformKey =
  | 'win-x64-nsis'
  | 'win-x64-portable'
  | 'mac-x64-dmg'
  | 'mac-arm64-dmg'
  | 'linux-x64-appimage'
  | 'unsupported';

export interface PlatformInfo {
  key: PlatformKey;
  canAutoUpdate: boolean;
  useElectronUpdater: boolean;
}
