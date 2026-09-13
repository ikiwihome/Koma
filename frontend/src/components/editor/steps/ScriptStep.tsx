/**
 * 编辑器第一步：剧本（项目工作台）
 *
 * 把"项目工作台"（ProjectOverview）整体搬到编辑器流程作为第一步：
 *   - 左：剧集导航
 *   - 中：剧本编辑器（含解析 / 推文文案 / 导入剧本）
 *   - 右：项目资产概览
 *   - 顶：项目设置 / 模型选择 / 导入剧本入口
 *
 * 业务逻辑（剧集管理 / 自动保存 / 解析 / 推文 / 导入剧本 / 模型选择）完全
 * 复用 ProjectOverview，此包装层只把 EditorStepContext 适配成 ProjectOverview 所需 props，
 * 把 onEnterEpisode 接到上层 → 当用户点"开始制作"时同步当前剧集并切到 'assets' 步。
 */
import React from 'react';
import { ProjectOverview } from '../../project/ProjectOverview';
import type { EditorStepContext } from '../../../workflow/editorStepRegistry';
import type { Episode, Project } from '../../../types';

export const ScriptStep: React.FC<{ ctx: EditorStepContext }> = ({ ctx }) => {
  return (
    <ProjectOverview
      project={ctx.activeProject}
      onEnterEpisode={(episode: Episode, options) => {
        // 选剧集 → 同步到上层；"开始制作"模式 → 切到下一步（角色场景）
        ctx.onActiveEpisodeChange?.(episode);
        if (options?.mode === 'start-production') {
          ctx.onStepChange('assets');
        }
      }}
      onProjectUpdate={(updates: Partial<Project>) => ctx.onProjectUpdate?.(updates)}
      onScriptChange={(text) => ctx.onScriptChange?.(text)}
      openImportSignal={ctx.scriptImportSignal}
    />
  );
};
