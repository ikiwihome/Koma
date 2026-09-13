/**
 * 剧本工作台
 * 包含工具栏和剧本编辑器，支持自动保存
 */
import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { App } from 'antd';
import { Film, Loader2 } from 'lucide-react';
import { InlineProjectToolbar } from './InlineProjectToolbar';
import { ScriptEditor } from '../../editor';
import { saveEpisode, loadEpisodeAnalysis, saveEpisodeAnalysis } from '../../store/projectStore';
import { generateRandomScript, polishScript } from '../../workflow/scriptGenerator';
import { submitScriptAnalysisTask } from '../../services/analysisTaskClient';
import { generateTweetScript } from '../../services/TweetCopyService';
import { createCreationContext } from '../../services/CreationContext';
import { TaskManager } from '../../services/TaskManager';
import { useActiveTask } from '../../hooks';
import type { Project, Episode, AppSettings } from '../../types';
import { useTheme } from '../../theme/runtime';
import { createLogger } from '../../store/logger';
import { createAITraceId } from '../../utils/aiTrace';
import { classifyAIError } from '../../utils/aiError';
import { serializeMediaSelection } from '../../providers/channel/resolver';

const logger = createLogger('ScriptWorkbench');

interface ScriptWorkbenchProps {
  project: Project;
  episode: Episode | null;
  onScriptChange: (text: string) => void;
  /** 解析状态变更上报；外部据此控制"解析剧本"按钮的 loading 态 */
  onAnalyzingChange?: (isAnalyzing: boolean) => void;
  /**
   * 当 scriptReady 等剧集字段被工具栏内的动作（如"标记为字幕格式" / 推文化完成）
   * 写回 DB 时回调，把字段 patch 同步给上层 selectedEpisode；
   * 否则父组件持有的剧集状态是过时的，解析按钮 disabled 与状态徽章不会刷新。
   */
  onEpisodeUpdate?: (updates: Partial<Episode>) => void;
}

export interface ScriptWorkbenchRef {
  flushSave: () => Promise<Episode | null>;
  /** 触发当前剧集的剧本解析（先 flushSave 再 submitScriptAnalysisTask） */
  analyze: () => Promise<void>;
}

export const ScriptWorkbench = forwardRef<ScriptWorkbenchRef, ScriptWorkbenchProps>(({
  project,
  episode,
  onScriptChange,
  onAnalyzingChange,
  onEpisodeUpdate,
}, ref) => {
  const { message } = App.useApp();
  const { theme } = useTheme();
  const isDarkTheme = theme.meta.mode === 'dark';
  const [localScript, setLocalScript] = useState(episode?.scriptText || '');
  const [isSaving, setIsSaving] = useState(false);
  // 点击到任务真正落库之间的短暂"提交中"窗口；任务创建后就由 activeAnalysisTask 接管
  const [isSubmittingAnalysis, setIsSubmittingAnalysis] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTweetGenerating, setIsTweetGenerating] = useState(false);
  const [streamingMode, setStreamingMode] = useState<'generate' | 'polish' | 'tweet' | null>(null);
  const [streamingPreview, setStreamingPreview] = useState('');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef(episode?.scriptText || '');
  const streamingPreviewRef = useRef<HTMLDivElement | null>(null);

  // 同步外部 episode 变化（仅在剧集 ID 切换时重置本地内容）
  useEffect(() => {
    setLocalScript(episode?.scriptText || '');
    lastSavedRef.current = episode?.scriptText || '';
  }, [episode?.id]);

  // 解析任务的 loading 来自任务表投影 —— 切走再回来无需重新同步
  const activeAnalysisTask = useActiveTask({
    scope: `project:${project.id}`,
    type: 'script-analysis',
    targetKind: 'episode',
    targetId: episode?.id,
  });
  const isAnalyzing = isSubmittingAnalysis || !!activeAnalysisTask;

  useEffect(() => {
    if (!streamingPreviewRef.current) return;
    streamingPreviewRef.current.scrollTop = streamingPreviewRef.current.scrollHeight;
  }, [streamingPreview]);

  // 自动保存 (防抖 2s) — 可选 patch 字段（如 scriptReady）一起入库
  const saveScript = useCallback(async (
    text: string,
    extra?: Partial<Pick<Episode, 'scriptReady'>>,
  ): Promise<Episode | null> => {
    if (!episode) return null;
    if (text === lastSavedRef.current && !extra) {
      return { ...episode, scriptText: text };
    }

    setIsSaving(true);
    try {
      const updated = await saveEpisode(project.id, episode.id, { scriptText: text, ...(extra || {}) });
      lastSavedRef.current = text;
      onScriptChange(text);
      // 把 extra 字段（scriptReady 等）同步给上层 selectedEpisode，
      // 否则解析按钮 disabled 守门和状态徽章不会刷新
      if (extra && Object.keys(extra).length > 0) {
        onEpisodeUpdate?.(extra);
      }
      return updated || { ...episode, scriptText: text, ...(extra || {}) };
    } catch (err: unknown) {
      logger.error('自动保存失败', err);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [episode, project.id, onScriptChange, onEpisodeUpdate]);

  const flushSave = useCallback(async (): Promise<Episode | null> => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    return saveScript(localScript);
  }, [localScript, saveScript]);

  const handleManualSave = useCallback(async () => {
    if (!episode) {
      message.warning('请先选择剧集');
      return;
    }

    const result = await flushSave();
    if (result) {
      message.success('剧本已保存');
      return;
    }

    message.error('保存失败，请重试');
  }, [episode, flushSave, message]);

  // 上报解析状态变更
  useEffect(() => {
    onAnalyzingChange?.(isAnalyzing);
  }, [isAnalyzing, onAnalyzingChange]);

  const handleScriptChange = useCallback((text: string) => {
    setLocalScript(text);

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 设置新的定时器，保存成功后 saveScript 内部会回调 onScriptChange
    // TODO[B]: 用户手编辑剧本时是否要自动重置 scriptReady = false（剧本被改动 → 需要重新确认）
    //   先暂不实现；如需要议论后再开。当前策略是"一旦确认即保持"，用户主动通过推文文案 / 标记按钮触发置位
    saveTimeoutRef.current = setTimeout(() => {
      saveScript(text);
    }, 2000);
  }, [saveScript]);

  /**
   * A 项：手动「标记为字幕格式」绕过入口
   * - 用户可能直接导入了字幕文件，或自己手写了字幕行格式的剧本，没经过推文文案按钮
   * - 提供一个独立按钮，让 scriptReady 直接置 true，解锁解析与下一步
   */
  const handleMarkScriptReady = useCallback(async () => {
    if (!episode) {
      message.warning('请先选择剧集');
      return;
    }
    if (!localScript.trim()) {
      message.warning('剧本为空，无需标记');
      return;
    }
    const result = await saveScript(localScript, { scriptReady: true });
    if (result) {
      message.success('已标记为字幕格式，可以进入解析步骤');
    } else {
      message.error('标记失败，请重试');
    }
  }, [episode, localScript, saveScript, message]);

  // 用 ref 追踪最新状态，供组件卸载时使用
  const localScriptRef = useRef(localScript);
  localScriptRef.current = localScript;

  // 组件卸载时保存（剧集切换由 flushSave 处理，不在此处保存）
  useEffect(() => {
    const episodeId = episode?.id;
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      // 仅在组件卸载时保存，剧集切换走 flushSave 路径
      if (episodeId) {
        const currentScript = localScriptRef.current;
        if (currentScript !== lastSavedRef.current) {
          saveEpisode(project.id, episodeId, { scriptText: currentScript }).catch(err => logger.error('保存失败', err));
        }
      }
    };
  }, [project.id]);

  // AI 随机生成
  const handleRandomGenerate = async () => {
    const traceId = createAITraceId('random-script');
    setIsGenerating(true);
    setStreamingMode('generate');
    setStreamingPreview('');
    try {
      logger.info('用户触发随机生成剧本', {
        traceId,
        projectId: project.id,
        episodeId: episode?.id,
        episodeName: episode?.title,
      });

      const script = await generateRandomScript('3', undefined, {
        traceId,
        source: 'ScriptWorkbench.handleRandomGenerate',
        projectId: project.id,
        targetId: episode?.id,
        targetName: episode?.title || `第${episode?.number || 0}集`,
        styleSnapshot: project.styleSnapshot,
        project,
        onChunk: (_delta, accumulated) => {
          setStreamingPreview(accumulated);
        },
      });
      setStreamingPreview(script);
      setLocalScript(script);
      await saveScript(script);
      logger.info('随机生成剧本成功', {
        traceId,
        projectId: project.id,
        episodeId: episode?.id,
        scriptLength: script.length,
      });
      message.success('剧本生成成功！');
    } catch (err: unknown) {
      logger.error('随机生成失败', {
        traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      message.error('剧本生成失败，请检查 LLM 配置后重试');
    } finally {
      setIsGenerating(false);
      setStreamingMode(null);
      setStreamingPreview('');
    }
  };

  // AI 润色
  const handlePolish = async () => {
    if (!localScript.trim()) {
      message.warning('请先输入剧本内容');
      return;
    }
    setIsPolishing(true);
    setStreamingMode('polish');
    setStreamingPreview('');
    try {
      const polished = await polishScript(
        {} as AppSettings,
        localScript,
        '使语言更加生动，对话更自然，情节更紧凑',
        () => {},
        { styleSnapshot: project.styleSnapshot, project },
        (_delta, accumulated) => {
          setStreamingPreview(accumulated);
        }
      );
      setStreamingPreview(polished);
      setLocalScript(polished);
      await saveScript(polished);
      message.success('润色完成！');
    } catch (err: unknown) {
      logger.error('润色失败', err);
      message.error(classifyAIError(err).userMessage);
    } finally {
      setIsPolishing(false);
      setStreamingMode(null);
      setStreamingPreview('');
    }
  };

  // 推文文案：流式直接覆盖当前剧本编辑器（不弹窗）
  const handleTweetCopy = async () => {
    if (!episode) {
      message.warning('请先选择剧集');
      return;
    }
    if (!localScript.trim()) {
      message.warning('请先输入剧本内容');
      return;
    }
    setIsTweetGenerating(true);
    setStreamingMode('tweet');
    setStreamingPreview('');
    try {
      const ctx = await createCreationContext(project.id, episode.id, {
        styleSnapshot: project.styleSnapshot,
      });
      const result = await generateTweetScript(
        ctx,
        localScript,
        () => {},
        (_delta, accumulated) => {
          setStreamingPreview(accumulated);
        },
      );
      setStreamingPreview(result);
      setLocalScript(result);
      // 推文化完成 → 同时置 scriptReady = true 解锁解析与下一步
      await saveScript(result, { scriptReady: true });
      message.success('推文文案已生成并写入剧本，可以进入解析步骤');
    } catch (err: unknown) {
      logger.error('推文文案生成失败', err);
      message.error(classifyAIError(err).userMessage);
    } finally {
      setIsTweetGenerating(false);
      setStreamingMode(null);
      setStreamingPreview('');
    }
  };

  // 解析剧本
  const handleAnalyze = useCallback(async () => {
    if (!episode || !localScript.trim()) {
      message.warning('请先输入剧本内容');
      return;
    }

    const existingTask = TaskManager.getProjectTasks(project.id).find(task =>
      task.type === 'script-analysis'
      && task.targetId === episode.id
      && (task.status === 'pending' || task.status === 'running' || task.status === 'processing')
    );
    if (existingTask) {
      message.info('当前剧集已在后台解析中，请等待完成后再试。');
      return;
    }

    setIsSubmittingAnalysis(true);
    try {
      await saveScript(localScript);
      const previousAnalysis = await loadEpisodeAnalysis(project.id, episode.id);
      if (previousAnalysis) {
        await saveEpisodeAnalysis(project.id, episode.id, {
          ...previousAnalysis,
          completedStages: [],
        }, { resetStages: true });
      }
      try {
        const { deduped } = await submitScriptAnalysisTask({
          projectId: project.id,
          episodeId: episode.id,
          episodeName: episode.title || `第${episode.number}集`,
          script: localScript,
          llmSelection: serializeMediaSelection(project.mediaSelections?.llm),
          styleSnapshot: project.styleSnapshot,
        });
        if (deduped) {
          message.info('当前剧集已在后台解析中，请等待完成后再试。');
          return;
        }
        message.success('解析任务已启动，可在状态栏查看进度');
      } catch (analysisErr: unknown) {
        if (previousAnalysis) {
          await saveEpisodeAnalysis(project.id, episode.id, previousAnalysis, { resetStages: true });
        }
        throw analysisErr;
      }
    } catch (err: unknown) {
      logger.error('解析失败', err);
      message.error(classifyAIError(err).userMessage);
    } finally {
      setIsSubmittingAnalysis(false);
    }
  }, [episode, localScript, project, message, saveScript]);

  useImperativeHandle(ref, () => ({
    flushSave,
    analyze: handleAnalyze,
  }), [flushSave, handleAnalyze]);

  // 空状态
  if (!episode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-bg-app">
        <div className="w-20 h-20 mb-6 rounded-2xl bg-bg-elevated/80 flex items-center justify-center">
          <Film className="w-10 h-10 text-text-muted" />
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          选择剧集开始创作
        </h2>
        <p className="text-sm text-text-tertiary">
          从左侧选择一个剧集，或创建新剧集开始编写剧本
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-app">
      {/* 工具栏 */}
      <InlineProjectToolbar
        episode={episode}
        hasScript={!!localScript.trim()}
        isSaving={isSaving}
        isGenerating={isGenerating}
        isPolishing={isPolishing}
        isTweetGenerating={isTweetGenerating}
        scriptReady={!!episode.scriptReady}
        onSave={handleManualSave}
        onPolish={handlePolish}
        onRandomGenerate={handleRandomGenerate}
        onTweetCopy={handleTweetCopy}
        onMarkScriptReady={handleMarkScriptReady}
      />

      {/* 剧本编辑器 */}
      <div className="flex-1 p-4 overflow-hidden">
        {streamingMode ? (
          <div className="h-full flex flex-col overflow-hidden rounded-lg border border-accent/20 bg-bg-app">
            <div className="flex items-center justify-between gap-4 border-b border-border-subtle bg-bg-surface/80 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  <span>
                    {streamingMode === 'generate'
                      ? 'AI 正在生成剧本'
                      : streamingMode === 'polish'
                        ? 'AI 正在润色剧本'
                        : 'AI 正在改写为推文文案'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  {streamingMode === 'generate'
                    ? '内容会实时显示，完成后自动写入编辑器。'
                    : streamingMode === 'polish'
                      ? '润色结果会实时预览，完成后再覆盖当前剧本。'
                      : '推文文案会实时预览，完成后会覆盖当前剧本编辑器内容并自动保存。'}
                </p>
              </div>
              <span className="shrink-0 text-xs text-text-tertiary">{streamingPreview.length} 字符</span>
            </div>
            <div
              ref={streamingPreviewRef}
              className="flex-1 overflow-auto bg-bg-surface"
            >
              <pre className="min-h-full whitespace-pre-wrap break-words px-4 py-3 font-sans text-[13px] leading-6 text-text-primary">
                {streamingPreview || (streamingMode === 'generate'
                  ? '正在等待模型返回首段内容...'
                  : '正在等待模型返回润色结果...')}
              </pre>
            </div>
          </div>
        ) : (
          <ScriptEditor
            value={localScript}
            onChange={handleScriptChange}
            placeholder="在此开始创作剧本... (支持 Markdown 格式)"
            minHeight="100%"
            maxHeight="100%"
            showLineNumbers={true}
            darkTheme={isDarkTheme}
            enableCameraCommands={false}
            className="h-full flex-1"
          />
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="h-8 px-4 flex items-center justify-between text-xs text-text-tertiary border-t border-border-subtle bg-bg-surface">
        <span>
          第 {episode.number} 集: {episode.title}
        </span>
        <span>
          {(streamingMode ? streamingPreview.length : localScript.length)} 字符
        </span>
      </div>
    </div>
  );
});

ScriptWorkbench.displayName = 'ScriptWorkbench';

export default ScriptWorkbench;
