/**
 * marketplaceClient — 插件 marketplace 前端薄封装。
 */
import { isElectron, type MarketplacePluginItem, type MarketplaceStateDto } from './electronService';

function api() {
  if (!isElectron()) return null;
  return (window as any).electronAPI?.marketplace ?? null;
}

export type { MarketplacePluginItem, MarketplaceStateDto };

export const marketplaceClient = {
  isAvailable: (): boolean => !!api(),

  async list(): Promise<MarketplacePluginItem[]> {
    const res = await api()?.list();
    return res?.items ?? [];
  },

  async refresh(): Promise<MarketplaceStateDto | null> {
    return (await api()?.refresh()) ?? null;
  },

  async checkUpdates(): Promise<MarketplacePluginItem[]> {
    const res = await api()?.checkUpdates();
    return res?.items ?? [];
  },

  async getState(): Promise<MarketplaceStateDto | null> {
    return (await api()?.getState()) ?? null;
  },

  async installOrUpdate(pluginId: string): Promise<void> {
    await api()?.installOrUpdate(pluginId);
  },

  async uninstall(pluginId: string): Promise<void> {
    await api()?.uninstall(pluginId);
  },

  async setAutoCheck(enabled: boolean): Promise<void> {
    await api()?.setAutoCheck(enabled);
  },

  onStateChange(handler: (state: MarketplaceStateDto) => void): () => void {
    const a = api();
    if (!a) return () => {};
    return a.onStateChange((_e: unknown, state: MarketplaceStateDto) => handler(state));
  },

  onPluginInstalled(handler: (payload: { pluginId: string; version: string }) => void): () => void {
    const a = api();
    if (!a) return () => {};
    return a.onPluginInstalled((_e: unknown, payload: { pluginId: string; version: string }) => handler(payload));
  },
};
