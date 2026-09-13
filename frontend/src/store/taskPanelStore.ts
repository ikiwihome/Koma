/**
 * 任务面板的开/关状态。
 *
 * 入口在左侧 Sidebar（点击不切 view，仅 toggle Drawer），
 * Drawer 主体在 TaskStatusBar 组件挂载于 App 顶层。
 *
 * 用全局 store 而非组件 props 是为了让 Sidebar 不必知道 App 内部状态——
 * Sidebar 只需要 setOpen / toggle，App 只需 mount Drawer 并读 open 即可。
 */
import { create } from 'zustand';

interface TaskPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useTaskPanelStore = create<TaskPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
