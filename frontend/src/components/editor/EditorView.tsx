import React, { useEffect, useState } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import { SettingOutlined, UploadOutlined } from '@ant-design/icons';
import { Film, Users } from 'lucide-react';
import {
  Project, Episode, EditorStep, EpisodeStepProgress,
  ScriptAnalysisResult, AppSettings, ProjectStyleSnapshot,
} from '../../types';
import type { MentionItem } from '../../editor';
import { StepNavigator } from '../common/StepNavigator';
import { serializeMediaSelection } from '../../providers/channel/resolver';
import {
  getEditorStep,
  type EditorStepContext,
} from '../../workflow/editorStepRegistry';
import { loadEpisodeAnalysis } from '../../store/projectStore';
import { useTaskTransitions } from '../../hooks';
// 副作用 import：把各步骤 Component 注入到 registry
import './steps';

interface EditorViewProps {
  activeProject: Project;
  activeEpisode: Episode | null;
  editorStep: EditorStep;
  stepProgress: EpisodeStepProgress;
  scriptText: string;
  analysisData: ScriptAnalysisResult | null;
  appSettings: AppSettings;
  mentionItems: MentionItem[];
  onStepChange: (step: EditorStep) => void;
  onStepChangeWithMark: (step: EditorStep) => void;
  onViewChange: (view: 'projects') => void;
  onOpenProjectSettings: () => void;
  /** 'script' 步骤把编辑后的剧本回写到 App 顶层 state */
  onScriptChange?: (text: string) => void;
  /** 'script' 步骤里 ProjectOverview 修改项目元信息时回写 */
  onProjectUpdate?: (updates: Partial<Project>) => void;
  /** 'script' 步骤里选剧集时把当前剧集回写到 App 顶层 state */
  onActiveEpisodeChange?: (episode: Episode) => void;
}

export const EditorView: React.FC<EditorViewProps> = ({
  activeProject,
  activeEpisode,
  editorStep,
  stepProgress,
  scriptText,
  analysisData,
  appSettings,
  mentionItems,
  onStepChange,
  onStepChangeWithMark,
  onViewChange,
  onOpenProjectSettings,
  onScriptChange,
  onProjectUpdate,
  onActiveEpisodeChange,
}) => {
  const styleSnapshot: ProjectStyleSnapshot | undefined = activeProject.styleSnapshot;
  const llmSelection = serializeMediaSelection(activeProject.mediaSelections?.llm);
  const ttiSelection = serializeMediaSelection(activeProject.mediaSelections?.tti);
  const itvSelection = serializeMediaSelection(activeProject.mediaSelections?.itv);
  const ttsSelection = serializeMediaSelection(activeProject.mediaSelections?.tts);

  // 'script' 步：导入剧本对话框由 ProjectOverview 渲染；EditorView 顶部按钮通过递增信号
  // 触发其打开（避免把 dialog 提到这一层后还要重新搭刷新 EpisodeManager / AssetOverview 的通道）
  const [scriptImportSignal, setScriptImportSignal] = useState(0);

  // 'script' 步：跟踪当前剧集的解析就绪状态（剧本必须解析过才能进入下一步）
  // 派生顺序：episode.hasAnalysis → 兜底走 loadEpisodeAnalysis 的 completedStages 长度
  const [scriptAnalysisReady, setScriptAnalysisReady] = useState(false);
  useEffect(() => {
    if (!activeEpisode) {
      setScriptAnalysisReady(false);
      return;
    }
    let cancelled = false;
    const initial = !!activeEpisode.hasAnalysis;
    setScriptAnalysisReady(initial);
    // 兜底：从分析数据派生（避免 episode 字段未及时刷新）
    if (!initial) {
      loadEpisodeAnalysis(activeProject.id, activeEpisode.id)
        .then((analysis) => {
          if (cancelled) return;
          const stages = analysis?.completedStages || [];
          if (stages.length > 0) setScriptAnalysisReady(true);
        })
        .catch(() => {/* 加载失败时按未就绪处理 */});
    }
    return () => {
      cancelled = true;
    };
  }, [activeProject.id, activeEpisode]);

  // 后台解析任务完成 → 标 ready；走 edge-triggered 转换事件
  useTaskTransitions(
    {
      scope: `project:${activeProject.id}`,
      type: 'script-analysis',
      targetKind: 'episode',
      targetId: activeEpisode?.id,
      to: ['completed'],
    },
    () => setScriptAnalysisReady(true)
  );

  // 数据驱动："下一步"按钮从 editorStepRegistry.nextAction 派生
  const getActionButton = () => {
    const next = getEditorStep(editorStep)?.nextAction;
    if (!next) return null;

    // 'script' 步：必须先解析剧本才能进入下一步
    const blockedByAnalysis = editorStep === 'script' && !scriptAnalysisReady;
    const tooltip = blockedByAnalysis
      ? '请先点击右侧资产面板的「解析剧本」完成解析'
      : undefined;

    const button = (
      <Button
        type="primary"
        disabled={blockedByAnalysis}
        onClick={() => onStepChangeWithMark(next.targetStepId as EditorStep)}
        className={blockedByAnalysis ? '' : 'bg-accent-hover hover:bg-accent border-none'}
      >
        下一步
      </Button>
    );

    return tooltip ? <Tooltip title={tooltip}>{button}</Tooltip> : button;
  };

  // 构造 step 渲染上下文
  const ctx: EditorStepContext = {
    activeProject,
    activeEpisode,
    scriptText,
    analysisData,
    appSettings,
    mentionItems,
    styleSnapshot,
    llmSelection,
    ttiSelection,
    itvSelection,
    ttsSelection,
    onStepChange: (id) => onStepChange(id as EditorStep),
    onViewChange,
    onScriptChange,
    onProjectUpdate,
    onOpenProjectSettings,
    onActiveEpisodeChange,
    scriptImportSignal,
  };

  // 数据驱动：从 registry 取当前 step 的 Component
  const stepDef = getEditorStep(editorStep);
  const StepComponent = stepDef?.Component;

  return (
    <div className="flex flex-col h-full">
      {/* 嵌入式步骤导航：左侧项目标识 + 步骤条 + 右侧（剧本步:导入剧本） / 主操作按钮 / 项目设置图标 */}
      <StepNavigator
        currentStep={editorStep}
        onStepChange={onStepChange}
        stepProgress={stepProgress}
        scriptText={scriptText}
        leftContent={(
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 bg-gradient-to-br from-accent to-accent-hover rounded flex items-center justify-center flex-shrink-0">
              <Film className="w-2.5 h-2.5 text-on-accent" />
            </div>
            <span className="text-xs font-medium text-text-primary truncate max-w-[140px]" title={activeProject.title}>
              {activeProject.title}
            </span>
            <Tag className="!m-0 !text-[10px] !leading-4 !px-1.5 !bg-accent/15 !text-accent !border-accent/30">
              {activeProject.genre || '未分类'}
            </Tag>
          </div>
        )}
        actionButton={(
          <>
            {getActionButton()}
            {editorStep === 'script' && (
              <Tooltip title="导入完整剧本并 AI 自动分集（会替换项目中所有剧集）">
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  onClick={() => setScriptImportSignal((s) => s + 1)}
                  className="!text-text-secondary !border-border !bg-bg-elevated hover:!text-status-info hover:!border-status-info"
                >
                  导入剧本
                </Button>
              </Tooltip>
            )}
          </>
        )}
        extraButton={(
          <Tooltip title="项目设置（项目名 / 题材 / 风格 / 模型选择）">
            <button
              onClick={() => onOpenProjectSettings()}
              className="flex items-center justify-center w-7 h-7 bg-bg-elevated hover:bg-bg-hover border border-border rounded text-text-secondary transition-colors"
              aria-label="项目设置"
            >
              <SettingOutlined />
            </button>
          </Tooltip>
        )}
      />

      {/* 主内容区 */}
      <div className="flex-1 overflow-hidden relative">
        {StepComponent ? (
          <StepComponent ctx={ctx} />
        ) : (
          // 未实现/未注册 Component 的 step：fallback
          <div className="flex h-full items-center justify-center text-text-tertiary flex-col gap-4">
            <Users className="w-16 h-16 opacity-10" />
            <p>步骤 "{editorStep}" 未实现。</p>
            <Button type="link" onClick={() => onViewChange('projects')}>返回项目列表</Button>
          </div>
        )}
      </div>
    </div>
  );
};
