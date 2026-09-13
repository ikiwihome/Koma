import React from 'react';
import { Button, Space, Typography, Popconfirm, Tooltip } from 'antd';
import {
  RobotOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
  ReloadOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import './StoryboardToolbar.scss';

const { Text } = Typography;

// Helper to get tooltip text for disabled buttons
function getPromptButtonTooltip(hasSelected: boolean, noPromptCount: number, generating: boolean): string {
  if (generating) return '正在生成中...';
  if (!hasSelected) return '请先选择分镜';
  if (noPromptCount === 0) return '所选分镜都已有提示词';
  return '为所选分镜生成提示词';
}

function getRePromptButtonTooltip(hasSelected: boolean, withPromptCount: number, generating: boolean): string {
  if (generating) return '正在生成中...';
  if (!hasSelected) return '请先选择分镜';
  if (withPromptCount === 0) return '所选分镜都没有提示词';
  return '重新生成提示词';
}

function getImageButtonTooltip(hasSelected: boolean, noImageCount: number, generating: boolean): string {
  if (generating) return '正在生成中...';
  if (!hasSelected) return '请先选择分镜';
  if (noImageCount === 0) return '所选分镜都已有图片';
  return '为所选分镜生成图片';
}

function getReImageButtonTooltip(hasSelected: boolean, withImageCount: number, generating: boolean): string {
  if (generating) return '正在生成中...';
  if (!hasSelected) return '请先选择分镜';
  if (withImageCount === 0) return '所选分镜都没有图片';
  return '重新生成图片';
}

function getVideoButtonTooltip(hasSelected: boolean, total: number, generating: boolean): string {
  if (generating) return '正在生成中...';
  if (!hasSelected) return '请先选择分镜';
  if (total === 0) return '没有可生成视频的分镜';
  return '为所选分镜生成视频';
}

function getReVideoButtonTooltip(hasSelected: boolean, withVideoCount: number, generating: boolean): string {
  if (generating) return '正在生成中...';
  if (!hasSelected) return '请先选择分镜';
  if (withVideoCount === 0) return '所选分镜都没有视频';
  return '重新生成视频';
}

export interface StoryboardToolbarProps {
  stats: {
    total: number;
    withPrompt: number;
    withImage: number;
    withVideo: number;
    confirmed: number;
  };
  selectedStats: {
    total: number;
    noPrompt: number;
    noImage: number;
    noVideo: number;
    withPrompt: number;
    withImage: number;
    withVideo: number;
  };
  hasSelected: boolean;
  selectedCount: number;
  generatingPrompts: boolean;
  generatingImages: boolean;
  generatingVideos: boolean;
  onBatchPrompts: () => void;
  onBatchRePrompts: () => void;
  onBatchImages: () => void;
  onBatchReImages: () => void;
  onBatchVideos: () => void;
  onBatchReVideos: () => void;
  onAddShot: () => void;
  onBatchDelete: () => void;
}

export const StoryboardToolbar: React.FC<StoryboardToolbarProps> = ({
  stats,
  selectedStats,
  hasSelected,
  selectedCount,
  generatingPrompts,
  generatingImages,
  generatingVideos,
  onBatchPrompts,
  onBatchRePrompts,
  onBatchImages,
  onBatchReImages,
  onBatchVideos,
  onBatchReVideos,
  onAddShot,
  onBatchDelete,
}) => {
  return (
    <div className="storyboard-toolbar-inner">
      <Space wrap>
        <Space.Compact>
          <Tooltip title={getPromptButtonTooltip(hasSelected, selectedStats.noPrompt, generatingPrompts)}>
            <Button
              icon={<RobotOutlined />}
              disabled={!hasSelected || selectedStats.noPrompt === 0 || generatingPrompts}
              onClick={onBatchPrompts}
            >
              生成提示词 ({selectedStats.noPrompt})
            </Button>
          </Tooltip>
          <Tooltip title={getRePromptButtonTooltip(hasSelected, selectedStats.withPrompt, generatingPrompts)}>
            <Button
              icon={<ReloadOutlined />}
              disabled={!hasSelected || selectedStats.withPrompt === 0 || generatingPrompts}
              onClick={onBatchRePrompts}
            />
          </Tooltip>
        </Space.Compact>

        <Space.Compact>
          <Tooltip title={getImageButtonTooltip(hasSelected, selectedStats.noImage, generatingImages)}>
            <Button
              icon={<ThunderboltOutlined />}
              disabled={!hasSelected || selectedStats.noImage === 0 || generatingImages}
              onClick={onBatchImages}
            >
              生成图片 ({selectedStats.noImage})
            </Button>
          </Tooltip>
          <Tooltip title={getReImageButtonTooltip(hasSelected, selectedStats.withImage, generatingImages)}>
            <Button
              icon={<ReloadOutlined />}
              disabled={!hasSelected || selectedStats.withImage === 0 || generatingImages}
              onClick={onBatchReImages}
            />
          </Tooltip>
        </Space.Compact>

        <Space.Compact>
          <Tooltip title={getVideoButtonTooltip(hasSelected, selectedStats.total, generatingVideos)}>
            <Button
              icon={<VideoCameraOutlined />}
              disabled={!hasSelected || selectedStats.total === 0 || generatingVideos}
              onClick={onBatchVideos}
            >
              生成视频 ({selectedStats.total})
            </Button>
          </Tooltip>
          <Tooltip title={getReVideoButtonTooltip(hasSelected, selectedStats.withVideo, generatingVideos)}>
            <Button
              icon={<ReloadOutlined />}
              disabled={!hasSelected || selectedStats.withVideo === 0 || generatingVideos}
              onClick={onBatchReVideos}
            />
          </Tooltip>
        </Space.Compact>

        <div className="h-4 w-px bg-bg-hover" />

        <Button type="primary" icon={<PlusOutlined />} onClick={onAddShot}>
          添加分镜
        </Button>
      </Space>

      {hasSelected && (
        <Space className="selection-actions">
          <Text type="secondary">已选 {selectedCount} 项</Text>
          <div className="h-4 w-px bg-bg-hover" />
          <Popconfirm title={`删除 ${selectedCount} 个分镜？`} onConfirm={onBatchDelete}>
            <Button size="small" danger>批量删除</Button>
          </Popconfirm>
        </Space>
      )}

      <div className="toolbar-stats">
        <Text type="secondary">
          T: {stats.withPrompt}/{stats.total} |
          I: {stats.withImage}/{stats.total} |
          V: {stats.withVideo}/{stats.total} |
          OK: {stats.confirmed}/{stats.total}
        </Text>
      </div>
    </div>
  );
};
