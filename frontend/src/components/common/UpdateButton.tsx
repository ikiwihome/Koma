/**
 * UpdateButton — 标题栏右侧的极简更新按钮。
 *
 * 渲染状态：
 *   - 无更新     → 不渲染任何元素
 *   - 有更新     → "更新到 vX.Y.Z" 点击 = 下载
 *   - 下载中     → "更新中… 47%" 不可点
 *   - 已下载     → "重启以更新" 点击 = quitAndInstall（长任务时由 main 静默忽略）
 *   - 失败       → "更新失败 · 重试" 点击 = 重新 download
 *   - checking   → 不渲染（短暂态，避免闪烁）
 *
 * 没有红点、没有 banner、没有模态、没有 changelog 展开。
 */
import React, { useCallback } from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import { useUpdaterStore } from '../../store/updater/updaterStore';

export const UpdateButton: React.FC = () => {
  const { state, isAvailable } = useUpdater();
  const download = useUpdaterStore((s) => s.download);
  const installNow = useUpdaterStore((s) => s.installNow);

  const handleClick = useCallback(() => {
    if (!state) return;
    if (state.kind === 'downloaded') {
      void installNow();
      return;
    }
    if (state.kind === 'failed' && state.availableVersion) {
      void download();
      return;
    }
    if (state.kind === 'idle' && state.availableVersion) {
      void download();
    }
  }, [state, download, installNow]);

  if (!isAvailable || !state) return null;
  // checking 短暂态不显示，避免闪烁
  if (state.kind === 'checking') return null;
  // idle 且没检测到新版本：不渲染
  if (state.kind === 'idle' && !state.availableVersion) return null;
  // failed 但没 availableVersion（从未成功检查过）：也不渲染
  if (state.kind === 'failed' && !state.availableVersion) return null;

  let label = '';
  let clickable = false;
  let isError = false;
  if (state.kind === 'idle' && state.availableVersion) {
    label = `更新到 v${state.availableVersion}`;
    clickable = true;
  } else if (state.kind === 'downloading') {
    const pct = Math.round((state.downloadProgress ?? 0) * 100);
    label = `更新中… ${pct}%`;
  } else if (state.kind === 'downloaded') {
    label = '重启以更新';
    clickable = true;
  } else if (state.kind === 'failed') {
    label = '更新失败 · 重试';
    clickable = true;
    isError = true;
  }

  const colorClass = isError
    ? 'text-status-error hover:bg-bg-hover cursor-pointer'
    : clickable
      ? 'text-accent hover:bg-bg-hover cursor-pointer'
      : 'text-text-secondary cursor-default';

  return (
    <button
      onClick={clickable ? handleClick : undefined}
      disabled={!clickable}
      className={`no-drag h-full px-3 flex items-center text-xs transition-colors ${colorClass}`}
      title={state.error?.detail ?? label}
    >
      {label}
    </button>
  );
};
