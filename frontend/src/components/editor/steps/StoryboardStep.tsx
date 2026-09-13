import React from 'react';
import { Storyboard } from '../../storyboard/Storyboard';
import type { EditorStepContext } from '../../../workflow/editorStepRegistry';

export const StoryboardStep: React.FC<{ ctx: EditorStepContext }> = ({ ctx }) => {
  return (
    <div className="absolute inset-0">
      <Storyboard
        projectId={ctx.activeProject.id}
        episodeId={ctx.activeEpisode?.id}
        episodeName={
          ctx.activeEpisode?.title
            ?? (ctx.activeEpisode ? `第${ctx.activeEpisode.number}集` : undefined)
        }
        script={ctx.scriptText}
        aspectRatio={ctx.activeProject.aspectRatio || '16:9'}
        llmSelection={ctx.llmSelection}
        ttiSelection={ctx.ttiSelection}
        itvSelection={ctx.itvSelection}
        ttsSelection={ctx.ttsSelection}
        ttsVoiceId={ctx.activeProject.ttsVoiceId}
        ttsSpeed={ctx.activeProject.ttsSpeed}
        settings={ctx.appSettings}
        styleSnapshot={ctx.styleSnapshot}
        mentionItems={ctx.mentionItems}
      />
    </div>
  );
};
