/**
 * 任务面板 Drawer 组件
 * 唯一入口在左侧 Sidebar 的"任务"按钮，通过 taskPanelStore 控制开关。
 * 没有顶部指示器（删了），所有交互都从 Sidebar 进。
 */
import React, { useState, useMemo } from 'react';
import { Progress, Typography, Tag, Button, Empty, Tooltip, Drawer } from 'antd';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { Loader2, CheckCircle2, XCircle, FileText, Video, Cpu, Box, Download, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskManager } from '../../services/TaskManager';
import type { Task as ManagerTask } from '../../services/TaskManager';
import { buildScriptAnalysisOverallProgress } from '../../services/scriptAnalysisProgress';
import { deleteMediaTask, clearCompletedMediaTasks } from '../../services/mediaTaskClient';
import { useTaskPanelStore } from '../../store/taskPanelStore';
import { useTasks } from '../../hooks';
import { cancelTaskRecord } from '../../services/tasksIPC';

const { Text } = Typography;

interface TaskStatusBarProps {
  projectId: string;
  onRetry?: (task: ManagerTask) => void;
  onCancel?: (task: ManagerTask) => void;
}

type StatusBarCategory = 'prompt' | 'analysis' | 'asset' | 'script' | 'export' | 'media';
type StatusBarStatus = 'pending' | 'running' | 'processing' | 'completed' | 'failed';
type FilterKey = 'all' | 'running' | 'completed' | 'failed';

interface StatusBarTask {
  id: string;
  projectId: string;
  status: StatusBarStatus;
  progress: number;
  category?: StatusBarCategory;
  subType?: string;
  type: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  recoverable?: boolean;
  attempt?: number;
  maxRetries?: number;
  source: 'task-manager' | 'task-queue';
  raw?: ManagerTask;
}

type ScriptStageKey = 'plan' | 'characters' | 'scenes' | 'props';

interface ScriptStageState {
  status?: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  chunkIndex?: number;
  chunkTotal?: number;
  retryAttempt?: number;
  retryMax?: number;
  retryDelayMs?: number;
  message?: string;
}

interface ScriptStagePresentation {
  stages: Array<{ key: ScriptStageKey; state: ScriptStageState }>;
  currentStage?: ScriptStageKey;
  currentState?: ScriptStageState;
  progress: number;
  summary: string;
  detail?: string;
  completedCount: number;
  totalCount: number;
}

const SCRIPT_STAGE_ORDER: ScriptStageKey[] = ['plan', 'characters', 'scenes', 'props'];

const SCRIPT_STAGE_LABELS: Record<ScriptStageKey, string> = {
  plan: '规划',
  characters: '角色',
  scenes: '场景',
  props: '道具',
};

const useCategoryConfig = () => {
  const { t } = useTranslation();
  return {
    prompt: { label: '提示词', icon: <FileText className="w-3 h-3" />, color: 'purple' },
    media: { label: t('video.title'), icon: <Video className="w-3 h-3" />, color: 'blue' },
    analysis: { label: t('project.scriptAnalysis'), icon: <Cpu className="w-3 h-3" />, color: 'cyan' },
    asset: { label: t('asset.title'), icon: <Box className="w-3 h-3" />, color: 'orange' },
    script: { label: t('project.scriptAnalysis'), icon: <FileText className="w-3 h-3" />, color: 'green' },
    export: { label: t('common.export'), icon: <Download className="w-3 h-3" />, color: 'gold' },
  } as Record<StatusBarCategory, { label: string; icon: React.ReactNode; color: string }>;
};

const getStatusIcon = (status: StatusBarStatus) => {
  switch (status) {
    case 'pending':
    case 'running':
    case 'processing':
      return <Loader2 className="w-4 h-4 animate-spin text-accent" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-accent" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-status-error" />;
  }
};

const formatDuration = (startedAt?: number, completedAt?: number): string => {
  if (!startedAt) return '';
  const end = completedAt || Date.now();
  const seconds = Math.floor((end - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

const isRunning = (status: StatusBarStatus) => status === 'running' || status === 'processing' || status === 'pending';

const getProgressStrokeColor = (status: StatusBarStatus) => {
  switch (status) {
    case 'failed':
      return 'var(--token-status-error)';
    case 'completed':
      return 'var(--token-status-success)';
    default:
      return 'var(--token-accent-base)';
  }
};

const getTaskCardClassName = (status: StatusBarStatus, featured = false) => {
  const base = featured
    ? 'rounded-xl border px-3 py-3 shadow-[0_0_0_1px_color-mix(in_srgb,var(--token-bg-surface)_50%,transparent)]'
    : 'rounded-xl border px-3 py-2.5 transition-colors';

  switch (status) {
    case 'failed':
      return `${base} border-status-error/20 bg-status-error/5 hover:bg-status-error/10`;
    case 'completed':
      return `${base} border-accent/10 bg-accent/5 hover:bg-accent/10`;
    default:
      return `${base} border-border/80 bg-bg-elevated/50 hover:bg-bg-elevated/70`;
  }
};

const formatCountdown = (ms?: number) => {
  if (!ms || ms <= 0) return '即将重试';
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${seconds}s 后重试`;
};

export const TaskStatusBar: React.FC<TaskStatusBarProps> = ({ projectId, onRetry, onCancel }) => {
  const { t } = useTranslation();
  const CATEGORY_CONFIG = useCategoryConfig();

  const drawerOpen = useTaskPanelStore(s => s.open);
  const setDrawerOpen = useTaskPanelStore(s => s.setOpen);
  const [activeTab, setActiveTab] = useState<FilterKey>('all');
  // 项目维度筛选：默认"当前项目"，可切到"全部"看跨项目的任务
  const [projectFilter, setProjectFilter] = useState<'current' | 'all'>('current');
  // 用于"刚删完立即从 UI 移除"的本地隐藏集合（避免等待广播来回的视觉抖动）
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const getSubTypeLabel = (subType?: string): string => {
    const labels: Record<string, string> = {
      // prompt 类目下的 image/video 表示提示词，不是媒体生成；明确区分避免与 tti/itv 混淆
      image: '图片提示词',
      video: '视频提示词',
      tti: t('settings.tti'),
      itv: t('settings.itv'),
      tts: t('settings.tts'),
      'shot-analysis': t('storyboard.title'),
      'shot-generation': t('storyboard.generateImage'),
      'script-analysis': t('task.scriptAnalysis'),
      'asset-generation': t('task.imageGeneration'),
      'character-extraction': t('asset.character'),
      'prompt-generation': '图+视频提示词',
      'prompt-optimization': '提示词优化',
    };
    return labels[subType || ''] || subType || '';
  };

  const getTaskLabel = (task: StatusBarTask): string => {
    if (task.category && task.subType) {
      return `${CATEGORY_CONFIG[task.category]?.label || task.category} - ${getSubTypeLabel(task.subType)}`;
    }
    return task.type;
  };

  // 任务源已统一到 SQLite tasks 表；用 hooks 直接订阅
  // current 项目过滤靠 scope；'all' 不传 scope 拿全部
  const records = useTasks(
    projectFilter === 'all' ? {} : { scope: `project:${projectId}` }
  );

  const tasks = useMemo<StatusBarTask[]>(() => {
    const MEDIA_TYPES = new Set(['tti', 'itv', 'tts', 'character-extraction']);
    // 工具/管道类任务不在用户面板展示：每次 LLM 调用、未来可能的子级 IPC 任务等。
    // 用户关心的是父级业务任务（剧本解析 / 分镜生成 / 媒体生成），它们已经汇总
    // 了进度与阶段；llm:complete 这种"plumbing"在面板里只会刷屏盖过父任务。
    const HIDDEN_TYPES = new Set(['llm:complete']);

    const mapped: StatusBarTask[] = [];
    for (const record of records) {
      if (hiddenIds.has(record.id)) continue;
      if (HIDDEN_TYPES.has(record.type)) continue;
      const payload = (record.payload || {}) as Record<string, unknown> & {
        category?: string;
        subType?: string;
        type?: string;
        targetType?: string;
        targetId?: string;
        targetName?: string;
        startedAt?: number;
        completedAt?: number;
        error?: string;
        recoverable?: boolean;
        attempt?: number;
        maxRetries?: number;
      };

      const isMedia = MEDIA_TYPES.has(record.type);
      const projectId = record.scope.startsWith('project:')
        ? record.scope.slice('project:'.length)
        : '';

      if (isMedia) {
        mapped.push({
          id: record.id,
          projectId,
          status: record.status as StatusBarStatus,
          progress: record.progress,
          category: 'media',
          subType: record.type,
          type: `media:${record.type}`,
          targetType: record.targetKind ?? undefined,
          targetId: record.targetId ?? undefined,
          targetName: payload.targetName,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          startedAt: record.createdAt,
          completedAt: record.completedAt ?? undefined,
          error: record.error ?? undefined,
          source: 'task-queue',
        });
      } else {
        // payload 已经存了 ManagerTask 全字段；retry/cancel 回调要用，传过去
        mapped.push({
          id: record.id,
          projectId,
          status: record.status as StatusBarStatus,
          progress: record.progress,
          category: payload.category as StatusBarCategory | undefined,
          subType: payload.subType,
          type: record.type,
          targetType: record.targetKind ?? payload.targetType,
          targetId: record.targetId ?? payload.targetId,
          targetName: payload.targetName,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          startedAt: payload.startedAt,
          completedAt: record.completedAt ?? payload.completedAt,
          error: record.error ?? payload.error,
          recoverable: payload.recoverable,
          attempt: payload.attempt ?? record.attempt,
          maxRetries: payload.maxRetries ?? record.maxRetries,
          source: 'task-manager',
          raw: payload as unknown as ManagerTask,
        });
      }
    }
    return mapped
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  }, [records, hiddenIds]);

  const { runningTasks, completedTasks, failedTasks, allFilteredTasks } = useMemo(() => {
    const running = tasks.filter(t => t.status === 'pending' || t.status === 'running' || t.status === 'processing');
    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed');
    let filtered: StatusBarTask[];
    switch (activeTab) {
      case 'running': filtered = running; break;
      case 'completed': filtered = completed; break;
      case 'failed': filtered = failed; break;
      default: filtered = tasks;
    }
    return { runningTasks: running, completedTasks: completed, failedTasks: failed, allFilteredTasks: filtered };
  }, [tasks, activeTab]);

  const mainTask = runningTasks[0];

  const filterItems: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: 'all', label: t('common.all'), count: tasks.length },
    { key: 'running', label: t('task.running'), count: runningTasks.length },
    { key: 'completed', label: t('task.completed'), count: completedTasks.length },
    { key: 'failed', label: t('task.failed'), count: failedTasks.length },
  ];

  // Drawer 内除"运行中主任务卡"外，其他任务列表
  const visibleTasks = mainTask
    ? allFilteredTasks.filter(task => task.id !== mainTask.id)
    : allFilteredTasks;

  const getScriptStagePresentation = (task: StatusBarTask): ScriptStagePresentation | null => {
    if (task.source !== 'task-manager') return null;

    const result = (task.raw as any)?.result as {
      currentStage?: ScriptStageKey;
      stageStates?: Partial<Record<ScriptStageKey, ScriptStageState>>;
      stageMessage?: string;
    } | undefined;

    const stageStates = result?.stageStates;
    if (!stageStates || typeof stageStates !== 'object') return null;

    const planState = stageStates.plan;
    const includePlan = Boolean(
      planState && (
        result?.currentStage === 'plan'
        || (typeof planState.message === 'string' && planState.message.trim().length > 0)
        || planState.status !== 'completed'
        || (typeof planState.progress === 'number' && planState.progress < 1)
      )
    );

    const stages = SCRIPT_STAGE_ORDER
      .filter((key) => key !== 'plan' || includePlan)
      .filter((key) => stageStates[key])
      .map((key) => ({ key, state: stageStates[key] as ScriptStageState }));

    if (stages.length === 0) return null;

    const currentStage = (result?.currentStage && stageStates[result.currentStage])
      ? result.currentStage
      : stages.find(({ state }) => state.status === 'failed')?.key
        || stages.find(({ state }) => state.status === 'running')?.key
        || stages.find(({ state }) => state.status === 'pending')?.key
        || stages[stages.length - 1]?.key;

    const currentState = currentStage ? stageStates[currentStage] : undefined;
    const completedCount = stages.filter(({ state }) => state.status === 'completed').length;
    const totalCount = stages.length;

    let detail = '';
    if (currentStage && currentState) {
      const label = SCRIPT_STAGE_LABELS[currentStage];
      const stateMessage = currentState.message?.trim();
      const retryDelayMs = currentState.retryDelayMs
        ? Math.max(0, currentState.retryDelayMs - (Date.now() - task.updatedAt))
        : 0;

      if (retryDelayMs > 0) {
        detail = `${label} · ${formatCountdown(retryDelayMs)}`;
      } else if (currentState.status === 'failed' && stateMessage) {
        detail = stateMessage;
      } else if (currentState.status === 'completed' && stateMessage) {
        detail = stateMessage;
      } else if (currentState.chunkTotal) {
        const chunkIndex = Math.min(currentState.chunkIndex || 0, currentState.chunkTotal);
        detail = `${label} · 分块 ${chunkIndex}/${currentState.chunkTotal}`;
      } else if (currentState.status === 'completed') {
        detail = `${label} · 已完成`;
      } else if (currentState.status === 'failed') {
        detail = `${label} · 失败`;
      } else {
        detail = `${label} · 处理中`;
      }
    }

    return {
      stages,
      currentStage,
      currentState,
      progress: buildScriptAnalysisOverallProgress(stageStates as any, { includePlan }),
      summary: result?.stageMessage || `已完成 ${completedCount}/${totalCount} 阶段`,
      detail: detail || result?.stageMessage,
      completedCount,
      totalCount,
    };
  };

  const getStageMessage = (task: StatusBarTask) => {
    if (task.source !== 'task-manager') return '';
    return ((task.raw as any)?.result?.stageMessage as string | undefined) || '';
  };

  const renderTaskItem = (task: StatusBarTask, featured = false) => {
    const stageMessage = getStageMessage(task);
    const stagePresentation = getScriptStagePresentation(task);
    const displayProgress = stagePresentation?.progress ?? task.progress;
    const shouldShowScriptStages = Boolean(stagePresentation) && (isRunning(task.status) || task.status === 'failed');
    const detailText = task.status === 'failed'
      ? task.error || stagePresentation?.detail || stagePresentation?.summary || stageMessage
      : stagePresentation?.detail || stageMessage;

    return (
      <div key={task.id} className={getTaskCardClassName(task.status, featured)}>
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0">{getStatusIcon(task.status)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {task.category && CATEGORY_CONFIG[task.category] && (
                    <Tag color={CATEGORY_CONFIG[task.category].color} className="text-[10px] px-1.5 py-0 leading-tight shrink-0 rounded-full">
                      <div className="flex items-center gap-1">
                        {CATEGORY_CONFIG[task.category].icon}
                        <span>{getSubTypeLabel(task.subType)}</span>
                      </div>
                    </Tag>
                  )}
                  {task.recoverable && task.attempt && task.attempt > 0 && (
                    <Tooltip title={`${t('common.retry')}: ${task.attempt}/${task.maxRetries}`}>
                      <Tag color="warning" className="text-[10px] px-1.5 py-0 shrink-0 rounded-full">#{task.attempt}</Tag>
                    </Tooltip>
                  )}
                </div>
                <div className={`${featured ? 'mt-1.5 text-sm font-medium text-text-primary' : 'mt-1 text-sm text-text-primary'} break-words`}>
                  {task.targetName || getTaskLabel(task)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {task.startedAt && (
                  <Text className="text-text-tertiary text-xs tabular-nums">
                    {formatDuration(task.startedAt, task.completedAt)}
                  </Text>
                )}
                {task.status === 'failed' && task.source === 'task-manager' && task.raw && onRetry && (
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    className="text-text-tertiary hover:text-status-info shrink-0 !w-7 !h-7"
                    onClick={(e) => { e.stopPropagation(); onRetry(task.raw!); }}
                  />
                )}
                {isRunning(task.status) && (
                  <Tooltip title="取消任务">
                    <Button
                      type="text"
                      size="small"
                      icon={<StopOutlined />}
                      className="text-text-tertiary hover:text-status-error shrink-0 !w-7 !h-7"
                      onClick={async (e) => {
                        e.stopPropagation();
                        // 优先走 IPC 主进程取消（能 abort main-side handler 与 renderer-side 业务订阅）
                        await cancelTaskRecord(task.id, '用户取消').catch(() => undefined);
                        // 业务侧可能还想做额外清理（比如 onCancel 回调里的本地 state），保留外部钩子
                        if (task.source === 'task-manager' && task.raw && onCancel) {
                          onCancel(task.raw);
                        }
                      }}
                    />
                  </Tooltip>
                )}
                {/* 单任务删除：仅完成 / 失败状态可删；运行中需先取消才能删 */}
                {(task.status === 'completed' || task.status === 'failed') && (
                  <Tooltip title="从任务列表移除（不影响远端）">
                    <Button
                      type="text"
                      size="small"
                      icon={<Trash2 className="w-3.5 h-3.5" />}
                      className="text-text-tertiary hover:text-status-error shrink-0 !w-7 !h-7"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (task.source === 'task-manager') {
                          TaskManager.removeTask(task.id);
                        } else {
                          await deleteMediaTask(task.id);
                        }
                        // 立刻从 UI 隐藏（IPC 广播稍后会从 cache 真正移除该 record）
                        setHiddenIds(prev => {
                          const next = new Set(prev);
                          next.add(task.id);
                          return next;
                        });
                      }}
                    />
                  </Tooltip>
                )}
              </div>
            </div>
            {shouldShowScriptStages ? (
              <div className="mt-2 space-y-1.5">
                {isRunning(task.status) && (
                  <div className="flex items-center gap-2">
                    <Progress
                      percent={displayProgress}
                      size="small"
                      showInfo={false}
                      className="flex-1"
                      strokeColor={getProgressStrokeColor(task.status)}
                      trailColor="var(--token-border-base)"
                    />
                    <Text className="text-text-secondary text-xs shrink-0 tabular-nums">{displayProgress}%</Text>
                  </div>
                )}
                {stagePresentation && (
                  <div className="flex flex-wrap gap-1.5">
                    {stagePresentation.stages.map(({ key, state }) => {
                      const retryDelayMs = state.retryDelayMs
                        ? Math.max(0, state.retryDelayMs - (Date.now() - task.updatedAt))
                        : 0;
                      const isActiveStage = key === stagePresentation.currentStage;
                      const toneClass = state.status === 'failed'
                        ? 'border-status-error/30 bg-status-error/10 text-status-error'
                        : state.status === 'completed'
                          ? 'border-accent/30 bg-accent/10 text-accent'
                          : isActiveStage
                            ? 'border-status-info/30 bg-status-info/10 text-status-info'
                            : 'border-border bg-bg-elevated/40 text-text-secondary';

                      let label = SCRIPT_STAGE_LABELS[key];
                      if (retryDelayMs > 0) {
                        label += ` ${formatCountdown(retryDelayMs)}`;
                      } else if (state.chunkTotal) {
                        label += ` ${Math.min(state.chunkIndex || 0, state.chunkTotal)}/${state.chunkTotal}`;
                      }

                      return (
                        <span
                          key={key}
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-5 ${toneClass}`}
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
                {detailText && (
                  <div className={`text-xs leading-5 break-words ${task.status === 'failed' ? 'text-status-error' : 'text-text-secondary'}`}>
                    {detailText}
                  </div>
                )}
              </div>
            ) : task.status === 'failed' && task.error ? (
              <div className="mt-2 text-xs leading-5 text-status-error break-words">
                {task.error}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* 任务列表抽屉：从右侧滑入，关闭后释放渲染。入口在 Sidebar，本组件不再渲染顶栏指示器 */}
      <Drawer
        title={
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-text-primary">{t('task.title')}</span>
            <span className="text-xs text-text-tertiary font-normal tabular-nums">
              {t('task.running')} {runningTasks.length} · {t('task.completed')} {completedTasks.length} · {t('task.failed')} {failedTasks.length}
            </span>
          </div>
        }
        extra={
          (completedTasks.length > 0 || failedTasks.length > 0) && (
            <Tooltip title="清空已完成和失败的任务记录">
              <Button
                size="small"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={async () => {
                  const removedManager = TaskManager.clearFinishedTasks(projectId);
                  const removedAsync = await clearCompletedMediaTasks(projectId).catch(() => 0);
                  // 立刻把 finished 全部加入隐藏，等广播来回时缓存自然清掉
                  setHiddenIds(prev => {
                    const next = new Set(prev);
                    for (const t of tasks) {
                      if (t.status === 'completed' || t.status === 'failed') next.add(t.id);
                    }
                    return next;
                  });
                  // 留个日志便于调试（不弹 toast 避免噪音）
                  if (removedManager + removedAsync > 0) {
                    // eslint-disable-next-line no-console
                    console.info(`[TaskStatusBar] 清空已完成任务：${removedManager + removedAsync} 条`);
                  }
                }}
              >
                清空已完成
              </Button>
            </Tooltip>
          )
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        placement="right"
        size={460}
        destroyOnHidden
        styles={{ body: { padding: '12px 16px' } }}
      >
        {/* 项目维度筛选 */}
        <div className="mb-3 flex items-center gap-2">
          <Text className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary shrink-0">项目</Text>
          <div className="flex flex-wrap gap-2">
            {(['current', 'all'] as const).map((key) => {
              const active = projectFilter === key;
              const label = key === 'current' ? '当前项目' : '全部';
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProjectFilter(key)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${active
                    ? 'border-status-info/40 bg-status-info/15 text-status-info'
                    : 'border-border/80 bg-bg-elevated/40 text-text-secondary hover:border-border hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 主运行任务卡（如果有） */}
        {mainTask && (
          <div className="mb-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Text className="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">{t('task.running')}</Text>
              {mainTask.startedAt && (
                <Text className="text-[11px] text-text-tertiary tabular-nums">
                  {formatDuration(mainTask.startedAt, mainTask.completedAt)}
                </Text>
              )}
            </div>
            {renderTaskItem(mainTask, true)}
          </div>
        )}

        {/* tab 筛选 */}
        <div className="mb-3 flex flex-wrap gap-2">
          {filterItems.map((item) => {
            const active = item.key === activeTab;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${active
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border/80 bg-bg-elevated/40 text-text-secondary hover:border-border hover:text-text-primary'
                }`}
              >
                <span>{item.label}</span>
                <span className="tabular-nums">{item.count}</span>
              </button>
            );
          })}
        </div>

        {/* 列表 */}
        <div className="max-h-[calc(100vh-260px)] overflow-y-auto custom-scrollbar">
          {visibleTasks.length > 0 ? (
            <div className="space-y-2">
              {visibleTasks.map((task) => renderTaskItem(task))}
            </div>
          ) : (
            <Empty
              description={t('task.noTasks')}
              className="py-5 [&_.ant-empty-image]:h-10 [&_.ant-empty-image]:min-h-10"
            />
          )}
        </div>
      </Drawer>
    </>
  );
};

export default TaskStatusBar;
