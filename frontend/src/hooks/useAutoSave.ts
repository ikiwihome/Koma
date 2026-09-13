/**
 * 自动保存 Hook
 * 防抖保存项目数据
 */
import { useCallback, useRef, useEffect } from 'react';
import { saveTimeline, saveProject, loadProject } from '../store/projectStore';
import type { ProjectMeta } from '../types';
import type { TimelineData } from '../types/editor';
import { createLogger } from '../store/logger';

const logger = createLogger('AutoSave');

interface AutoSaveOptions {
  projectId: string | null;
  debounceMs?: number;
  onSaveStart?: () => void;
  onSaveEnd?: (success: boolean) => void;
}

export function useAutoSave(options: AutoSaveOptions) {
  const { projectId, debounceMs = 2000, onSaveStart, onSaveEnd } = options;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<{ timeline?: TimelineData; meta?: Partial<ProjectMeta> } | null>(null);
  const isSavingRef = useRef(false);

  // 执行保存
  const doSave = useCallback(async () => {
    if (!projectId || !pendingDataRef.current || isSavingRef.current) return;

    isSavingRef.current = true;
    onSaveStart?.();

    try {
      const { timeline, meta } = pendingDataRef.current;
      pendingDataRef.current = null;

      if (timeline) {
        await saveTimeline(projectId, timeline);
      }
      if (meta) {
        // 加载现有项目数据并合并更新
        const existing = await loadProject(projectId);
        if (existing) {
          await saveProject({ ...existing, ...meta, updatedAt: Date.now() });
        }
      }

      onSaveEnd?.(true);
    } catch (err) {
      logger.error('自动保存失败', err);
      onSaveEnd?.(false);
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId, onSaveStart, onSaveEnd]);

  // 触发保存（防抖）
  const triggerSave = useCallback(
    (data: { timeline?: TimelineData; meta?: Partial<ProjectMeta> }) => {
      if (!projectId) return;

      // 合并待保存数据
      pendingDataRef.current = {
        ...pendingDataRef.current,
        ...data,
      };

      // 清除之前的定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // 设置新的防抖定时器
      timeoutRef.current = setTimeout(doSave, debounceMs);
    },
    [projectId, debounceMs, doSave]
  );

  // 立即保存（不防抖）
  const saveNow = useCallback(
    async (data?: { timeline?: TimelineData; meta?: Partial<ProjectMeta> }) => {
      if (!projectId) return;

      // 清除防抖定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (data) {
        pendingDataRef.current = {
          ...pendingDataRef.current,
          ...data,
        };
      }

      await doSave();
    },
    [projectId, doSave]
  );

  // 组件卸载时保存未保存的数据
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // 同步保存剩余数据（最佳努力）
      if (pendingDataRef.current && projectId) {
        doSave();
      }
    };
  }, [projectId, doSave]);

  return {
    triggerSave,
    saveNow,
    isSaving: isSavingRef.current,
  };
}

export default useAutoSave;
