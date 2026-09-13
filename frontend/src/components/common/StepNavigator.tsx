import React, { ReactNode } from 'react';
import { EditorStep, EpisodeStepProgress } from '../../types';
import { Check, Lock } from 'lucide-react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { listEditorSteps } from '../../workflow/editorStepRegistry';

interface StepNavigatorProps {
  currentStep: EditorStep;
  onStepChange: (step: EditorStep) => void;
  stepProgress?: EpisodeStepProgress;
  actionButton?: ReactNode;
  /** 左侧槽位：通常是项目标识（图标 + 标题 + 题材） */
  leftContent?: ReactNode;
  /** 右侧附加按钮，渲染在 actionButton 之前（通常是项目设置） */
  extraButton?: ReactNode;
  /**
   * 'script' 步骤不持久化到 EpisodeStepProgress（数据 schema 保持不变），
   * 它的"已完成"状态由当前剧本是否非空在运行时派生。
   */
  scriptText?: string;
}

const defaultProgress: EpisodeStepProgress = {
  assets: 'pending', storyboard: 'pending', video: 'pending',
};

/**
 * 派生指定步骤的完成状态：
 * - 'script' 由 scriptText 是否非空运行时计算（不持久化）
 * - 其他三步走 EpisodeStepProgress
 */
function isStepCompleted(
  stepId: string,
  stepProgress: EpisodeStepProgress,
  scriptText?: string,
): boolean {
  if (stepId === 'script') {
    return !!(scriptText && scriptText.trim().length > 0);
  }
  return stepProgress[stepId as keyof EpisodeStepProgress] === 'completed';
}

export const StepNavigator: React.FC<StepNavigatorProps> = ({
  currentStep,
  onStepChange,
  stepProgress = defaultProgress,
  actionButton,
  leftContent,
  extraButton,
  scriptText,
}) => {
  const { t } = useTranslation();

  // 数据驱动：从 editorStepRegistry 读取
  const steps = listEditorSteps();
  const stepOrder = steps.map((s) => s.id);
  const _currentIndex = stepOrder.indexOf(currentStep);

  // 判断步骤是否可点击
  const isStepClickable = (stepId: string, index: number): boolean => {
    if (stepId === currentStep) return true;
    // 当前步骤之前的步骤始终可以返回
    if (index < _currentIndex) return true;
    if (isStepCompleted(stepId, stepProgress, scriptText)) return true;
    if (index > 0) {
      const prevStep = stepOrder[index - 1];
      if (isStepCompleted(prevStep, stepProgress, scriptText)) return true;
    }
    return false;
  };

  const handleStepClick = (step: string, index: number) => {
    if (isStepClickable(step, index)) {
      onStepChange(step as EditorStep);
    }
  };

  return (
    <div className="w-full bg-bg-surface border-b border-border-subtle shadow-lg z-30">
      <div className="flex items-center w-full py-1.5 px-3 gap-3">
        {/* 左侧槽位：项目标识 */}
        {leftContent && (
          <div className="flex items-center flex-shrink-0 min-w-0">
            {leftContent}
          </div>
        )}

        {/* 步骤条 */}
        <div className="flex items-center flex-1 min-w-0">
          {steps.map((step, index) => {
            const isActive = step.id === currentStep;
            const isCompleted = isStepCompleted(step.id, stepProgress, scriptText);
            const clickable = isStepClickable(step.id, index);
            const isLocked = !clickable && !isActive;
            const Icon = step.icon;
            const stepProgressWidth = isCompleted ? '100%' : '0%';

            const stepNode = (
              <div
                onClick={() => handleStepClick(step.id, index)}
                className={`flex items-center gap-1.5 group relative z-10 select-none transition-opacity ${
                  clickable ? 'cursor-pointer' : 'cursor-not-allowed'
                } ${isLocked ? 'opacity-40' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    isActive
                      ? 'bg-accent-hover border-accent text-on-accent scale-105 ring-4 ring-accent/20'
                      : isCompleted
                      ? 'bg-bg-surface border-accent text-accent'
                      : 'bg-bg-app border-border text-text-muted'
                  }`}
                >
                  {isCompleted && !isActive ? (
                    <Check className="w-3.5 h-3.5 stroke-[3px]" />
                  ) : isLocked ? (
                    <Lock className="w-3 h-3" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                </div>

                <span
                  className={`text-xs font-medium transition-colors duration-300 ${
                    // 激活态 label 在页面背景（非 accent）上展示，不能用 onAccent；
                    // 用 text-accent 突出当前步骤，与已完成步骤色一致但通过粗细 / 圆点强调
                    isActive ? 'text-accent font-semibold' : isCompleted ? 'text-accent' : 'text-text-tertiary'
                  }`}
                >
                  {t(step.labelKey)}
                </span>
              </div>
            );

            return (
              <React.Fragment key={step.id}>
                {/* 步骤节点 */}
                {isLocked ? (
                  <Tooltip title={t('common.required')} placement="bottom">
                    {stepNode}
                  </Tooltip>
                ) : (
                  stepNode
                )}

                {/* 连接线 */}
                {index < steps.length - 1 && (
                  <div className="flex-1 h-[2px] mx-1.5 bg-bg-elevated relative rounded-full overflow-hidden min-w-[16px]">
                    <div
                      className="absolute top-0 left-0 h-full w-[var(--step-progress-width)] bg-accent-hover transition-all duration-500 ease-in-out"
                      style={{ '--step-progress-width': stepProgressWidth } as React.CSSProperties}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* 右侧操作区：主操作按钮（如下一步） + 附加图标按钮（如项目设置） */}
        {(extraButton || actionButton) && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {actionButton}
            {extraButton}
          </div>
        )}
      </div>
    </div>
  );
};
