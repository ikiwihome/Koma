/**
 * Electron preload 暴露的 window 全局对象类型声明
 *
 * 由 electron/preload/bridge.ts 通过 contextBridge.exposeInMainWorld 注入。
 * 本文件用 declaration merging 让 8+ 处直接消费 window.electronAPI / window.electron
 * 的代码无需再写 `(window as any)` 强转。
 *
 * 类型故意宽松为 any —— 各 namespace（chat / llm / ffmpeg / mcp / fs / dialog ...）
 * 在各自消费点自行做精确类型断言（如 services/electronService.ts 中的 ElectronAPI）。
 * 这是渐进式做法：不强求全局描述完整 IPC surface，但消除"冗余强转"这一具体痛点。
 */
declare global {
  interface Window {
    electronAPI?: any;
    electron?: {
      ipcRenderer: {
        invoke: (channel: string, args?: unknown) => Promise<unknown>;
        on: (channel: string, listener: (...args: unknown[]) => void) => void;
        once: (channel: string, listener: (...args: unknown[]) => void) => void;
        removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
        removeAllListeners: (channel: string) => void;
      };
      isEE: boolean;
    };
  }
}

// 让本文件被识别为 module（declare global 才能生效）
export {};
