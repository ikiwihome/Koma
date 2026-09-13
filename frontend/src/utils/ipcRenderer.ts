/**
 * Electron 前端 IPC 封装
 * 提供 controller/<domain>/<method> 格式的调用方式
 */

// 获取 Electron 对象
const Renderer: Partial<NonNullable<Window['electron']>> = window.electron || {};

/**
 * IPC 对象
 * 官方API说明：https://www.electronjs.org/zh/docs/latest/api/ipc-renderer
 */
export const ipc = Renderer.ipcRenderer || {
  invoke: () => Promise.reject(new Error('Not in Electron environment')),
  sendSync: () => null,
  on: () => {},
  once: () => {},
  removeListener: () => {},
  removeAllListeners: () => {},
  send: () => {},
};

/**
 * 是否为 Electron-Egg 环境
 */
export const isEE = Renderer.isEE || false;

/**
 * IPC 路由定义
 * 使用 controller/<domain>/<method> 格式
 */
export const ipcApiRoute = {
  // App 控制器
  app: {
    getPath: 'controller/app/getPath',
    getVersion: 'controller/app/getVersion',
    openExternal: 'controller/app/openExternal',
    showItemInFolder: 'controller/app/showItemInFolder',
    getStyleReferenceImagePath: 'controller/app/getStyleReferenceImagePath',
    getKomaTTSVoiceSamplePath: 'controller/app/getKomaTTSVoiceSamplePath',
    getActiveStyleReferenceImagePath: 'controller/app/getActiveStyleReferenceImagePath',
    saveStyleReferenceImage: 'controller/app/saveStyleReferenceImage',
    clearStyleReferenceImage: 'controller/app/clearStyleReferenceImage',
    saveProjectStyleReferenceImage: 'controller/app/saveProjectStyleReferenceImage',
    clearProjectStyleReferenceImage: 'controller/app/clearProjectStyleReferenceImage',
  },
  // 窗口控制器
  window: {
    minimize: 'controller/window/minimize',
    maximize: 'controller/window/maximize',
    close: 'controller/window/close',
    isMaximized: 'controller/window/isMaximized',
  },
  // 对话框控制器
  dialog: {
    openFile: 'controller/dialog/openFile',
    openDirectory: 'controller/dialog/openDirectory',
    saveFile: 'controller/dialog/saveFile',
  },
  // 文件系统控制器
  fs: {
    readFile: 'controller/fs/readFile',
    writeFile: 'controller/fs/writeFile',
    exists: 'controller/fs/exists',
    mkdir: 'controller/fs/mkdir',
    readdir: 'controller/fs/readdir',
    stat: 'controller/fs/stat',
    remove: 'controller/fs/remove',
    copy: 'controller/fs/copy',
  },
};

/**
 * 便捷调用主进程 controller 方法（controller/<domain>/<method>）
 * @param channel - IPC 路由
 * @param args - 传递给主进程的参数对象
 * @returns 主进程返回结果
 */
export async function invokeController<T = any>(
  channel: string,
  args?: Record<string, any>
): Promise<T> {
  return ipc.invoke(channel, args) as Promise<T>;
}

export default {
  ipc,
  isEE,
  ipcApiRoute,
  invokeController,
};
