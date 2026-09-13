/**
 * updaterClient — 主程序更新前端薄封装（极简版）。
 *
 * 暴露 4 个动作：getState / checkNow / download / installNow + 状态变更订阅。
 * 用户视角只点一个按钮，所以前端也不需要 dismiss / channel / autoCheck 等开关。
 */
import { isElectron, type UpdaterStateDto } from './electronService';

function api() {
  if (!isElectron()) return null;
  return (window as any).electronAPI?.updater ?? null;
}

export type { UpdaterStateDto };

export const updaterClient = {
  isAvailable: (): boolean => !!api(),

  async getState(): Promise<UpdaterStateDto | null> {
    return (await api()?.getState()) ?? null;
  },

  async checkNow(): Promise<UpdaterStateDto | null> {
    return (await api()?.checkNow()) ?? null;
  },

  async download(): Promise<void> {
    await api()?.download();
  },

  async installNow(): Promise<void> {
    await api()?.installNow();
  },

  /** 返回 unsubscribe 函数。renderer 卸载时必须调用。 */
  onStateChange(handler: (state: UpdaterStateDto) => void): () => void {
    const a = api();
    if (!a) return () => {};
    return a.onStateChange((_e: unknown, state: UpdaterStateDto) => handler(state));
  },
};
