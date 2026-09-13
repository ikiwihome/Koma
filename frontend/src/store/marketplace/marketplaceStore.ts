/**
 * Marketplace 全局 store（Zustand）。
 */
import { create } from 'zustand';
import {
  marketplaceClient,
  type MarketplacePluginItem,
  type MarketplaceStateDto,
} from '../../services/marketplaceClient';

interface MarketplaceStoreState {
  state: MarketplaceStateDto | null;
  items: MarketplacePluginItem[];
  loading: boolean;
  error: string | null;
  isAvailable: boolean;
  _unsubState: (() => void) | null;
  _unsubInstalled: (() => void) | null;

  initialize: () => Promise<void>;
  teardown: () => void;
  refetch: () => Promise<void>;
  installOrUpdate: (pluginId: string) => Promise<void>;
  uninstall: (pluginId: string) => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceStoreState>((set, get) => ({
  state: null,
  items: [],
  loading: false,
  error: null,
  isAvailable: marketplaceClient.isAvailable(),
  _unsubState: null,
  _unsubInstalled: null,

  async initialize() {
    if (get()._unsubState) return;
    const unsubState = marketplaceClient.onStateChange((state) => set({ state }));
    const unsubInstalled = marketplaceClient.onPluginInstalled(() => {
      void get().refetch();
    });
    set({ _unsubState: unsubState, _unsubInstalled: unsubInstalled });
    await get().refetch();
  },

  teardown() {
    get()._unsubState?.();
    get()._unsubInstalled?.();
    set({ _unsubState: null, _unsubInstalled: null });
  },

  async refetch() {
    set({ loading: true, error: null });
    try {
      const [items, state] = await Promise.all([
        marketplaceClient.list(),
        marketplaceClient.getState(),
      ]);
      set({ items, state, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error)?.message ?? '加载失败' });
    }
  },

  async installOrUpdate(pluginId) {
    try {
      await marketplaceClient.installOrUpdate(pluginId);
      // 不立即 refetch；marketplace:plugin-installed 广播会触发
    } catch (err) {
      set({ error: (err as Error)?.message ?? '操作失败' });
      throw err;
    }
  },

  async uninstall(pluginId) {
    try {
      await marketplaceClient.uninstall(pluginId);
      await get().refetch();
    } catch (err) {
      set({ error: (err as Error)?.message ?? '卸载失败' });
      throw err;
    }
  },

  setAutoCheck: (enabled) => marketplaceClient.setAutoCheck(enabled),
}));
