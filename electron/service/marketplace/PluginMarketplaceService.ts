/**
 * PluginMarketplaceService — 插件 marketplace 主入口
 *
 * 负责：
 *   - 拉注册表（带 ETag 缓存）
 *   - 比对本地 installed 状态，给前端 list 视图
 *   - install / update / uninstall，并发守门（同一插件不允许并发操作）
 *   - 状态广播：marketplace:state-changed / marketplace:plugin-installed
 *
 * 不负责：
 *   - manifest 字段扩展、兼容性校验（在 plugin/compatibility.ts）
 *   - 验签 / SHA512（在 release-signing/manifestVerifier）
 */
import { BrowserWindow } from 'electron';
import { logger } from 'ee-core/log';

import { compareSemver } from '../release-signing/manifestVerifier';
import { fetchRegistry } from './registryClient';
import { installFromRegistry, uninstallPlugin } from './pluginInstaller';
import { marketplaceStore } from './store';
import { pluginRuntime } from '../plugin/runtime';
import { validatePluginCompatibility } from '../plugin/compatibility';
import type {
  MarketplaceState,
  PluginListItem,
  PluginRegistryEntry,
} from './types';

const STATE_CHANNEL = 'marketplace:state-changed';
const INSTALLED_CHANNEL = 'marketplace:plugin-installed';

export class PluginMarketplaceService {
  private installing = new Set<string>();
  private uninstalling = new Set<string>();
  private cachedRegistry: PluginRegistryEntry[] = [];
  private lastError: string | undefined;

  start(): void {
    // 没有定时拉，UI 进入插件市场时按需触发；启动时拉一次以维护"已安装版本是否兼容"的角标
    if (marketplaceStore.getConfig().autoCheck) {
      this.refreshRegistry().catch((err) =>
        logger.warn('[marketplace] startup refresh failed', err),
      );
    }
  }

  stop(): void {
    // 当前无后台定时器；保留方法占位，避免 lifecycle 调用报错
    this.installing.clear();
    this.uninstalling.clear();
  }

  getState(): MarketplaceState {
    return {
      installing: Array.from(this.installing),
      uninstalling: Array.from(this.uninstalling),
      lastCheckedAt: marketplaceStore.getLastCheckedAt() ?? undefined,
      lastError: this.lastError,
    };
  }

  async refreshRegistry(): Promise<MarketplaceState> {
    const result = await fetchRegistry();
    if (!result.ok) {
      this.lastError = result.reason;
      this.broadcastState();
      return this.getState();
    }
    if (result.registry) {
      this.cachedRegistry = result.registry.plugins;
      this.lastError = undefined;
    }
    // 304 时保留旧 cachedRegistry
    this.broadcastState();
    return this.getState();
  }

  async list(): Promise<PluginListItem[]> {
    // 若内存里没缓存，按需拉一次
    if (this.cachedRegistry.length === 0 && !this.lastError) {
      await this.refreshRegistry();
    }
    const installedById = new Map(
      pluginRuntime.listPlugins().map((p) => [p.manifest.id, p.manifest]),
    );

    return this.cachedRegistry.map<PluginListItem>((entry) => {
      const installedManifest = installedById.get(entry.id);
      const installedVersion = installedManifest?.version;
      const hasUpdate = installedVersion
        ? compareSemver(entry.latestVersion, installedVersion) > 0
        : false;

      // 兼容性预检：用 entry.engine + 模拟一个最小 manifest 跑一次校验
      let incompatibleReason: string | undefined;
      if (entry.engine) {
        const stub = {
          id: entry.id,
          name: entry.name,
          version: entry.latestVersion,
          category: 'tool' as const,
          engine: {
            minAppVersion: entry.engine.minAppVersion ?? '0.0.0',
            sdkVersion: '1.0.0',
            maxAppVersion: entry.engine.maxAppVersion,
            apiVersion: entry.engine.apiVersion,
          },
          scopes: [],
          entry: {},
        };
        const r = validatePluginCompatibility(stub as any, undefined, { strictSignature: false });
        // 只关心 app_too_new / api_version_unsupported 这些发布层就能看出来的；签名缺失要装时才校验
        const blockers = r.fatal.filter(
          (i) => i.code === 'app_too_new' || i.code === 'api_version_unsupported',
        );
        if (blockers.length > 0) {
          incompatibleReason = blockers.map((i) => i.message).join('; ');
        }
      }

      return {
        entry,
        installed: Boolean(installedVersion),
        installedVersion,
        hasUpdate,
        incompatibleReason,
      };
    });
  }

  async checkUpdates(): Promise<PluginListItem[]> {
    const all = await this.list();
    return all.filter((it) => it.hasUpdate);
  }

  async installOrUpdate(pluginId: string): Promise<void> {
    if (this.installing.has(pluginId)) {
      throw new Error('该插件正在安装/升级中，请稍候');
    }
    const entry = this.cachedRegistry.find((p) => p.id === pluginId);
    if (!entry) {
      throw new Error(`插件 ${pluginId} 不在注册表中`);
    }
    this.installing.add(pluginId);
    this.broadcastState();
    try {
      const res = await installFromRegistry(entry);
      if (!res.ok) {
        throw new Error(res.reason ?? '安装失败');
      }
      this.broadcastInstalled(pluginId, entry.latestVersion);
    } finally {
      this.installing.delete(pluginId);
      this.broadcastState();
    }
  }

  async uninstall(pluginId: string): Promise<void> {
    if (this.uninstalling.has(pluginId)) {
      throw new Error('该插件正在卸载中');
    }
    this.uninstalling.add(pluginId);
    this.broadcastState();
    try {
      const res = await uninstallPlugin(pluginId);
      if (!res.ok) {
        throw new Error(res.reason ?? '卸载失败');
      }
    } finally {
      this.uninstalling.delete(pluginId);
      this.broadcastState();
    }
  }

  async setAutoCheck(enabled: boolean): Promise<void> {
    marketplaceStore.setConfig({ autoCheck: enabled });
  }

  private broadcastState(): void {
    const state = this.getState();
    for (const wc of BrowserWindow.getAllWindows()) {
      if (!wc.isDestroyed()) {
        wc.webContents.send(STATE_CHANNEL, state);
      }
    }
  }

  private broadcastInstalled(pluginId: string, version: string): void {
    for (const wc of BrowserWindow.getAllWindows()) {
      if (!wc.isDestroyed()) {
        wc.webContents.send(INSTALLED_CHANNEL, { pluginId, version });
      }
    }
  }
}

let _service: PluginMarketplaceService | null = null;
export function initPluginMarketplaceService(): PluginMarketplaceService {
  if (_service) return _service;
  _service = new PluginMarketplaceService();
  _service.start();
  return _service;
}
export function getPluginMarketplaceService(): PluginMarketplaceService | null {
  return _service;
}
