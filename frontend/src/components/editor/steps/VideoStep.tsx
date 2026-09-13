import React from 'react';
import { Button } from 'antd';
import { Scissors } from 'lucide-react';
import { SimpleEditor } from '../index';
import type { EditorStepContext } from '../../../workflow/editorStepRegistry';

export const VideoStep: React.FC<{ ctx: EditorStepContext }> = ({ ctx }) => {
  if (!ctx.analysisData) {
    return (
      <div className="flex h-full items-center justify-center text-text-tertiary flex-col gap-4">
        <Scissors className="w-16 h-16 opacity-10" />
        <p>需完成分镜生成后才能进入剪辑环节。</p>
        <Button type="link" onClick={() => ctx.onStepChange('storyboard')}>返回分镜</Button>
      </div>
    );
  }
  return (
    <SimpleEditor
      shots={ctx.analysisData.shots}
      projectId={ctx.activeProject.id}
      episodeId={ctx.activeEpisode?.id}
      aspectRatio={ctx.activeProject.aspectRatio || '16:9'}
    />
  );
};
