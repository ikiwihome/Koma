/**
 * 插件 marketplace 类型定义。
 *
 * 与主程序 updater 通道完全独立——状态机、IPC、KV 命名空间不互相读写。
 * 唯一共用 electron/service/release-signing/ 的验签与公钥。
 */

export interface PluginRegistryEntry {
  id: string;
  name: string;
  latestVersion: string;
  category?: string;
  iconUrl?: string;
  description?: string;
  /** 完整 https URL；客户端不动态拼接，避免路径注入 */
  downloadUrl: string;
  /** zip 文件 sha512，base64 形式（与 manifestVerifier.sha512Base64 输出一致） */
  sha512: string;
  size?: number;
  engine?: {
    minAppVersion?: string;
    maxAppVersion?: string;
    apiVersion?: string;
  };
}

export interface MarketplaceConfig {
  autoCheck: boolean;
  /** 允许覆盖默认注册表 URL（企业内网场景，本期不暴露给前端） */
  registryUrl?: string;
}

export interface PluginListItem {
  entry: PluginRegistryEntry;
  installed: boolean;
  installedVersion?: string;
  hasUpdate: boolean;
  /** 不兼容原因（minAppVersion / maxAppVersion / apiVersion 任一不满足时 set） */
  incompatibleReason?: string;
}

export type MarketplaceOpKind = 'install' | 'update' | 'uninstall';

export interface MarketplaceState {
  /** 当前正在 install/update 的插件 id 集合；用于前端禁用按钮 */
  installing: string[];
  uninstalling: string[];
  lastCheckedAt?: string;
  /** 上次 registry 拉取失败的原因（人话） */
  lastError?: string;
}
