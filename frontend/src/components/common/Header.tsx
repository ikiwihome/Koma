import React from 'react';
import { Button } from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { ChevronRight, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Project, Episode, EditorStep, EpisodeStepProgress } from '../../types';
import { StepNavigator } from './StepNavigator';
import { getEditorStep } from '../../workflow/editorStepRegistry';

interface HeaderProps {
  view: 'projects' | 'editor' | 'settings';
  activeProject: Project | null;
  activeEpisode: Episode | null;
  editorStep: EditorStep;
  stepProgress: EpisodeStepProgress;
  isAnalyzing: boolean;
  scriptText: string;
  onViewChange: (view: 'projects') => void;
  onStepChange: (step: EditorStep) => void;
  onStepChangeWithMark: (step: EditorStep) => void;
  onOpenProjectSettings: () => void;
  onAnalyze: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  view,
  activeProject,
  activeEpisode,
  editorStep,
  stepProgress,
  isAnalyzing: _isAnalyzing,
  scriptText: _scriptText,
  onViewChange,
  onStepChange,
  onStepChangeWithMark,
  onOpenProjectSettings,
  onAnalyze: _onAnalyze,
}) => {
  const { t } = useTranslation();

  return (
    <header className="h-auto border-b border-border-subtle flex flex-col bg-bg-surface/80 backdrop-blur-md shrink-0 z-30">
      {/* 上层：导航与操作 */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-border-subtle/50">
        <div className="flex items-center text-sm text-text-secondary">
          <button onClick={() => onViewChange('projects')} className="hover:text-text-primary transition-colors flex items-center">
            <Home className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">{t('common.home')}</span>
          </button>
          {/* 编辑视图面包屑：项目名 → 当前剧集（项目工作台已合并到编辑器第一步） */}
          {view === 'editor' && activeProject && (
            <>
              <ChevronRight className="w-4 h-4 mx-2 text-text-muted" />
              <span className="text-text-primary font-bold">{activeProject.title}</span>
              {activeEpisode && (
                <>
                  <ChevronRight className="w-4 h-4 mx-2 text-text-muted" />
                  <span className="text-text-secondary">{t('editor.episode')} {activeEpisode.number}</span>
                </>
              )}
              {activeProject.mode === 'narration' && (
                <span className="ml-2 text-[10px] bg-status-info/12 text-status-info border border-status-info/30 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">{t('editor.narrationMode')}</span>
              )}
            </>
          )}
          {view === 'settings' && (
            <>
              <ChevronRight className="w-4 h-4 mx-2" />
              <span className="text-text-primary">{t('settings.globalSettings')}</span>
            </>
          )}
        </div>

        {view === 'editor' && (
          <div className="flex gap-3">
            <Button icon={<SettingOutlined />} onClick={onOpenProjectSettings}>
              {t('project.settings')}
            </Button>
            <Button icon={<SaveOutlined />}>
              {t('common.saveDraft')}
            </Button>
            <Button type="primary" icon={<ExportOutlined />}>
              {t('common.exportProject')}
            </Button>
          </div>
        )}
      </div>

      {/* 下层：步骤导航 (仅在编辑器模式显示) */}
      {view === 'editor' && (
        <>
          <StepNavigator
            currentStep={editorStep}
            onStepChange={onStepChange}
            stepProgress={stepProgress}
            actionButton={(() => {
              const next = getEditorStep(editorStep)?.nextAction;
              if (!next) return null;
              return (
                <Button
                  type="primary"
                  onClick={() => onStepChangeWithMark(next.targetStepId as EditorStep)}
                >
                  {t(next.labelKey)}
                </Button>
              );
            })()}
          />
        </>
      )}
    </header>
  );
};
