import { useEffect } from 'react';
import { useUpdaterStore } from '../store/updater/updaterStore';

/**
 * 在挂载组件期间订阅 updater 状态变化。
 * 顶层 App 调用一次即可；组件树内若再次调用是幂等的（store 内部防双 init）。
 */
export function useUpdater() {
  const state = useUpdaterStore((s) => s.state);
  const isAvailable = useUpdaterStore((s) => s.isAvailable);
  const initialize = useUpdaterStore((s) => s.initialize);
  const teardown = useUpdaterStore((s) => s.teardown);

  useEffect(() => {
    if (!isAvailable) return;
    void initialize();
    return () => teardown();
  }, [isAvailable, initialize, teardown]);

  return { state, isAvailable };
}
