/**
 * useChannelChangesVersion
 *
 * 订阅主进程 'channel:changed' 广播，每次触发时把内部计数器 +1。
 * 消费组件用返回的 version 作为 useEffect 依赖即可获得"渠道变化时重新拉取"。
 *
 * 设计说明：
 *  - 使用全局 listener pool 是有意为之 —— 多个组件订阅同一事件源，
 *    只需注册一次 IPC listener，避免每个组件都向 ipcRenderer.on 注册一次。
 *  - 不在 hook 内做数据拉取，让消费组件自行决定 refetch 策略，避免引入隐式行为。
 *
 * 典型用法：
 *   const version = useChannelChangesVersion();
 *   useEffect(() => {
 *     getChannelConfigs().then(setConfigs);
 *   }, [version]);
 */
import { useEffect, useState } from 'react';
import {
  subscribeChannelChanges,
  type ChannelChangedEvent,
} from '../store/settings/channelConfig';

let globalVersion = 0;
const listeners = new Set<(version: number) => void>();
let unsubscribeFromIpc: (() => void) | null = null;

function ensureIpcSubscription(): void {
  if (unsubscribeFromIpc) return;
  unsubscribeFromIpc = subscribeChannelChanges((_event: ChannelChangedEvent) => {
    globalVersion += 1;
    for (const fn of listeners) {
      fn(globalVersion);
    }
  });
}

export function useChannelChangesVersion(): number {
  const [version, setVersion] = useState(globalVersion);

  useEffect(() => {
    ensureIpcSubscription();
    listeners.add(setVersion);
    // 同步当前 version（处理"先发生事件、后挂载组件"场景）
    if (version !== globalVersion) {
      setVersion(globalVersion);
    }
    return () => {
      listeners.delete(setVersion);
      // 全部消费组件 unmount 时回收 IPC listener，避免热重载场景下重复注册
      if (listeners.size === 0 && unsubscribeFromIpc) {
        unsubscribeFromIpc();
        unsubscribeFromIpc = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return version;
}

/**
 * 测试辅助：重置全局状态。仅供单元测试使用。
 */
export function __resetChannelChangesVersionForTest(): void {
  globalVersion = 0;
  listeners.clear();
  if (unsubscribeFromIpc) {
    unsubscribeFromIpc();
    unsubscribeFromIpc = null;
  }
}
