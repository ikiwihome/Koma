/**
 * StoryboardStudio - 分镜工作室
 * 简化版：移除舞台区域，仅作为容器
 */
import React from 'react';

interface StoryboardStudioProps {
  children: React.ReactNode;
}

export const StoryboardStudio: React.FC<StoryboardStudioProps> = ({
  children,
}) => {
  return (
    <div className="storyboardStudio">
      {/* 分镜列表区域 - 占满全部空间 */}
      <div className="timelineArea">
        {children}
      </div>
    </div>
  );
};

export default StoryboardStudio;
