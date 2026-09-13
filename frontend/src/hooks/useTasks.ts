/**
 * 任务订阅 hooks — UI 投影任务状态的统一入口
 *
 * 设计理念：UI 不持有 loading / progress 状态，只订阅任务表。
 * 切走再回来，组件 mount 时 hook 立即从全局缓存复原 loading/progress/error。
 *
 * 用法：
 *   const task = useActiveTask({ scope, targetKind: 'shot', targetId: shot.id });
 *   const loading = !!task && (task.status === 'pending' || task.status === 'running');
 *   const progress = task?.progress ?? 0;
 *   const error = task?.status === 'failed' ? task.error : null;
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  getTasksSnapshot,
  matchesFilter,
  subscribeTasks,
  subscribeTaskTransitions,
  type TasksFilter,
  type TransitionEvent,
} from '../store/tasksStore';
import type { TaskRecord } from '../services/tasksIPC';

const EMPTY: ReadonlyArray<TaskRecord> = Object.freeze([]);

function useTasksSnapshot(): ReadonlyArray<TaskRecord> {
  return useSyncExternalStore(subscribeTasks, getTasksSnapshot, getTasksSnapshot);
}

/**
 * 按过滤条件订阅任务列表。结果按 createdAt 倒序。
 */
export function useTasks(filter: TasksFilter): ReadonlyArray<TaskRecord> {
  const all = useTasksSnapshot();
  // filter 通常是内联对象，每次 render 都新建；这里靠 JSON 字符串签名稳住记忆
  const filterKey = useMemo(() => stableFilterKey(filter), [filter]);

  return useMemo(() => {
    if (!all.length) return EMPTY;
    return all.filter(t => matchesFilter(t, filter));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey is the stable signature for filter
  }, [all, filterKey]);
}

/**
 * 拿当前最近的"非终态"任务（pending / running / processing 任意一条）。
 * 没有则返回 null —— 组件可据此判断是否显示 loading / 进度条。
 *
 * 同一个 target 同时多条 active 时返回 createdAt 最新的那条。
 */
export function useActiveTask(filter: Omit<TasksFilter, 'activeOnly'>): TaskRecord | null {
  const tasks = useTasks({ ...filter, activeOnly: true });
  return tasks[0] ?? null;
}

/**
 * 按 id 订阅单条任务。任务被删除时返回 null。
 */
export function useTaskById(id: string | null | undefined): TaskRecord | null {
  const all = useTasksSnapshot();
  return useMemo(() => {
    if (!id) return null;
    return all.find(t => t.id === id) ?? null;
  }, [all, id]);
}

/**
 * 强制确保全局缓存被订阅（不需要数据但希望维持订阅活跃，比如全局 status bar）。
 * 等价于一个空 useTasks 但更显意图。
 */
export function useEnsureTasksHydrated(): void {
  useEffect(() => {
    const noop = () => undefined;
    const unsub = subscribeTasks(noop);
    return unsub;
  }, []);
}

export interface TransitionFilter extends TasksFilter {
  /** 仅触发从这些状态进入的转换；缺省=任何前态（含 null） */
  from?: ReadonlyArray<string | null>;
  /** 仅触发到达这些状态的转换；缺省=任何后态 */
  to?: ReadonlyArray<string>;
  /** hydrate 时已有任务（prevStatus = null）是否触发；默认 false（典型场景只关心新发生的事件） */
  includeInitial?: boolean;
}

/**
 * 订阅任务状态转换的 hook。常用于"任务变 completed 时弹消息/刷新数据"这种 edge-triggered 副作用。
 *
 * 例：
 *   useTaskTransitions(
 *     { scope: `project:${id}`, type: 'script-analysis', to: ['completed'] },
 *     (event) => { message.success('解析完成'); reload(event.record); }
 *   );
 */
export function useTaskTransitions(
  filter: TransitionFilter,
  callback: (event: TransitionEvent) => void
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const filterKey = useMemo(
    () => stableFilterKey(filter) + '|' + (filter.from?.join(',') ?? '') + '|' + (filter.to?.join(',') ?? '') + '|' + (filter.includeInitial ? '1' : '0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableFilterKey(filter), filter.from, filter.to, filter.includeInitial]
  );

  useEffect(() => {
    const unsub = subscribeTaskTransitions((event) => {
      const fromList = filter.from;
      const toList = filter.to;
      if (!filter.includeInitial && event.prevStatus === null) return;
      if (fromList && !fromList.includes(event.prevStatus)) return;
      if (toList && !toList.includes(event.currStatus)) return;
      if (!matchesFilter(event.record, filter)) return;
      callbackRef.current(event);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey is the stable signature
  }, [filterKey]);
}

function stableFilterKey(filter: TasksFilter): string {
  // 浅拷贝固定 key 顺序，避免 {a:1,b:2} vs {b:2,a:1} 误判
  return [
    filter.scope ?? '',
    (filter.scopes ?? []).join(','),
    Array.isArray(filter.status) ? filter.status.join(',') : (filter.status ?? ''),
    filter.targetKind ?? '',
    filter.targetId ?? '',
    filter.type ?? '',
    filter.activeOnly ? '1' : '0',
  ].join('|');
}
