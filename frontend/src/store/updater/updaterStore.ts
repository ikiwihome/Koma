/**
 * Updater 全局 store（Zustand，极简版）。
 *
 * - 应用启动调一次 initialize，之后状态由 main 进程广播驱动。
 * - 只暴露用户实际会用的 4 个动作。
 */
import { create } from 'zustand';
import { updaterClient, type UpdaterStateDto } from '../../services/updaterClient';

interface UpdaterStoreState {
  state: UpdaterStateDto | null;
  isAvailable: boolean;
  _unsubscribe: (() => void) | null;

  initialize: () => Promise<void>;
  teardown: () => void;
  refetch: () => Promise<void>;
  checkNow: () => Promise<void>;
  download: () => Promise<void>;
  installNow: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => ({
  state: null,
  isAvailable: updaterClient.isAvailable(),
  _unsubscribe: null,

  async initialize() {
    if (get()._unsubscribe) return; // 防 StrictMode 双 init
    const unsub = updaterClient.onStateChange((state) => set({ state }));
    set({ _unsubscribe: unsub });
    await get().refetch();
  },

  teardown() {
    get()._unsubscribe?.();
    set({ _unsubscribe: null });
  },

  async refetch() {
    const state = await updaterClient.getState();
    if (state) set({ state });
  },

  async checkNow() {
    const next = await updaterClient.checkNow();
    if (next) set({ state: next });
  },

  download: () => updaterClient.download(),
  installNow: () => updaterClient.installNow(),
}));
