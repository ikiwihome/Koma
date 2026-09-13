import React from 'react';
import { AssetManager } from '../../asset/AssetManager';
import type { EditorStepContext } from '../../../workflow/editorStepRegistry';

/**
 * 资产步骤包装：从 EditorStepContext 中挑选 AssetManager 所需字段。
 * 加新字段时，扩展 EditorStepContext + 此处 props，EditorView 不需要改动。
 */
export const AssetsStep: React.FC<{ ctx: EditorStepContext }> = ({ ctx }) => {
  return (
    <AssetManager
      projectId={ctx.activeProject.id}
      aspectRatio={ctx.activeProject.aspectRatio || '16:9'}
      ttiSelection={ctx.ttiSelection}
      itvSelection={ctx.itvSelection}
      styleSnapshot={ctx.styleSnapshot}
      episodeId={ctx.activeEpisode?.id}
      episodeName={
        ctx.activeEpisode?.title
          ?? (ctx.activeEpisode ? `第${ctx.activeEpisode.number}集` : undefined)
      }
      script={ctx.scriptText}
      llmSelection={ctx.llmSelection}
      characters={ctx.analysisData?.characters}
      scenes={ctx.analysisData?.scenes}
      props={ctx.analysisData?.props}
      onNext={() => ctx.onStepChange('storyboard')}
    />
  );
};
