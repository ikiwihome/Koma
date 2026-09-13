/**
 * 分镜列表公共表头
 * 集成全选、批量操作按钮、列标题
 */
import React from 'react';
import { Checkbox, Button, Tooltip, Dropdown, Popconfirm } from 'antd';
import type { MenuProps } from 'antd';
import {
  ThunderboltOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  PlusOutlined,
  DownOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { SHOT_LAYOUT, COL_ACTION_WIDTH } from '../../constants/storyboardConstants';
import type { ShotImageMode } from '../../types';

interface ShotListHeaderProps {
  totalCount: number;
  selectedCount: number;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  /** 图像设计：批量生成/优化 prompt 的运行态 */
  generatingImagePrompts: boolean;
  /** 视频设计：批量生成/优化 prompt 的运行态 */
  generatingVideoPrompts: boolean;
  generatingImages: boolean;
  generatingVideos: boolean;
  /** 配音批量运行态 */
  generatingAudios?: boolean;
  onSelectAll: (checked: boolean) => void;
  onBatchPrompts: () => void;
  onBatchRePrompts: () => void;
  onBatchImages: () => void;
  onBatchReImages: () => void;
  onBatchVideos: () => void;
  onBatchReVideos: () => void;
  onBatchVideoPrompts: () => void;
  onBatchReVideoPrompts: () => void;
  /** 批量配音：仅缺失生成 / 全部重生成 */
  onBatchAudios?: () => void;
  onBatchReAudios?: () => void;
  onBulkVideoModeChange?: (mode: 'multi-ref' | 'first-frame') => void;
  onBulkImageModeChange?: (mode: Exclude<ShotImageMode, 'grid'>) => void;
  onAddShot: () => void;
  onBatchDelete: () => void;
}

export const ShotListHeader: React.FC<ShotListHeaderProps> = ({
  totalCount,
  selectedCount,
  isAllSelected,
  isIndeterminate,
  generatingImagePrompts,
  generatingVideoPrompts,
  generatingImages,
  generatingVideos,
  generatingAudios = false,
  onSelectAll,
  onBatchPrompts,
  onBatchRePrompts,
  onBatchImages,
  onBatchReImages,
  onBatchVideos,
  onBatchReVideos,
  onBatchVideoPrompts,
  onBatchReVideoPrompts,
  onBatchAudios,
  onBatchReAudios,
  onBulkVideoModeChange,
  onBulkImageModeChange,
  onAddShot,
  onBatchDelete,
}) => {
  const { t } = useTranslation();
  const cellClass = "px-2 py-1.5 text-xs font-medium text-text-secondary border-r border-border-subtle flex items-center";

  const hasSelected = selectedCount > 0;
  const targetLabel = hasSelected ? `(${selectedCount})` : '';

  // 高频批量按钮直显（批量提示词 / 批量出图 / 批量出视频），各自带 submenu
  const imagePromptBatchItems: MenuProps['items'] = [
    { key: 'image-prompt-gen', label: t('storyboard.generateEmpty'), onClick: onBatchPrompts },
    { key: 'image-prompt-regen', label: t('storyboard.regenerateAll'), onClick: onBatchRePrompts },
  ];
  const videoPromptBatchItems: MenuProps['items'] = [
    { key: 'video-prompt-gen', label: t('storyboard.generateEmpty'), onClick: onBatchVideoPrompts },
    { key: 'video-prompt-regen', label: t('storyboard.regenerateAll'), onClick: onBatchReVideoPrompts },
  ];
  const imageBatchItems: MenuProps['items'] = [
    { key: 'image-gen', label: t('storyboard.generateEmpty'), onClick: onBatchImages },
    { key: 'image-regen', label: t('storyboard.regenerateAll'), onClick: onBatchReImages },
  ];
  const videoBatchItems: MenuProps['items'] = [
    { key: 'video-gen', label: t('storyboard.generateEmpty'), onClick: onBatchVideos },
    { key: 'video-regen', label: t('storyboard.regenerateAll'), onClick: onBatchReVideos },
  ];
  const audioBatchItems: MenuProps['items'] = [
    { key: 'audio-gen', label: t('storyboard.generateEmpty'), onClick: () => onBatchAudios?.() },
    { key: 'audio-regen', label: t('storyboard.regenerateAll'), onClick: () => onBatchReAudios?.() },
  ];

  // 「更多」收 视频模式切换 + 图片模式切换（其它已上提）
  const moreBatchItems: MenuProps['items'] = [
    ...(onBulkImageModeChange ? [{
      key: 'image-mode',
      label: '图片模式切换',
      type: 'group' as const,
      children: [
        { key: 'image-mode-normal', label: '全部切到 · 普通', onClick: () => onBulkImageModeChange('normal') },
        { key: 'image-mode-grid-4', label: '全部切到 · 四宫格', onClick: () => onBulkImageModeChange('grid-4') },
        { key: 'image-mode-grid-9', label: '全部切到 · 九宫格', onClick: () => onBulkImageModeChange('grid-9') },
        { key: 'image-mode-storyboard', label: '全部切到 · 故事板', onClick: () => onBulkImageModeChange('storyboard') },
      ],
    }] : []),
    ...(onBulkVideoModeChange ? [{
      key: 'video-mode',
      label: '视频模式切换',
      type: 'group' as const,
      children: [
        { key: 'mode-multi', label: '全部切到 · 多参模式', onClick: () => onBulkVideoModeChange('multi-ref') },
        { key: 'mode-first', label: '全部切到 · 首帧模式', onClick: () => onBulkVideoModeChange('first-frame') },
      ],
    }] : []),
  ];

  return (
    <div className="sticky top-0 z-20 flex items-stretch bg-bg-surface border-b border-border w-full">
      {/* 操作列：全选 + 批量删除（hasSelected 时才显示）— 横向更紧凑、视觉锚定在一起 */}
      <div className={`${COL_ACTION_WIDTH} shrink-0 border-r border-border-subtle flex items-center justify-center gap-1.5 py-1.5`}>
        <Tooltip title={isAllSelected ? t('storyboard.deselectAll') : `${t('storyboard.selectAll')} (${totalCount})`}>
          <Checkbox
            checked={isAllSelected}
            indeterminate={isIndeterminate}
            onChange={(e) => onSelectAll(e.target.checked)}
          />
        </Tooltip>
        {hasSelected && (
          <Popconfirm title={`${t('storyboard.deleteSelected')} ${selectedCount} ${t('storyboard.selectedCount')}?`} onConfirm={onBatchDelete} placement="right">
            <Tooltip title={t('storyboard.deleteSelected')}>
              <Button type="text" danger size="small" className="!w-5 !h-5 !p-0" icon={<DeleteOutlined className="text-[11px]" />} />
            </Tooltip>
          </Popconfirm>
        )}
      </div>

      {/* 剧本 */}
      <div className={`${SHOT_LAYOUT.colScript} ${cellClass}`}>{t('storyboard.script')}</div>

      {/* 资产 */}
      <div className={`${SHOT_LAYOUT.colAssets} ${cellClass}`}>{t('storyboard.assets')}</div>

      {/* 媒体列：上下两段 —— 行1 居中列标题（独立 cell），行2 批量按钮挤紧靠右 */}
      <div className={`${SHOT_LAYOUT.colMedia} border-r-0 flex flex-col text-text-secondary`}>
        <div className="px-2 py-1 text-xs font-medium text-center border-b border-border-subtle/60">
          媒体（图像 · 视频）
        </div>
        <div className="flex items-center justify-end gap-0.5 px-1 py-0.5">
          <Dropdown menu={{ items: imagePromptBatchItems }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              className="h-5 px-1 text-[11px]"
              icon={<ThunderboltOutlined />}
              loading={generatingImagePrompts}
            >
              图像词{targetLabel} <DownOutlined className="text-[8px]" />
            </Button>
          </Dropdown>
          <Dropdown menu={{ items: imageBatchItems }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              className="h-5 px-1 text-[11px]"
              icon={<PictureOutlined />}
              loading={generatingImages}
            >
              出图{targetLabel} <DownOutlined className="text-[8px]" />
            </Button>
          </Dropdown>
          <Dropdown menu={{ items: videoPromptBatchItems }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              className="h-5 px-1 text-[11px]"
              icon={<ThunderboltOutlined />}
              loading={generatingVideoPrompts}
            >
              视频词{targetLabel} <DownOutlined className="text-[8px]" />
            </Button>
          </Dropdown>
          <Dropdown menu={{ items: videoBatchItems }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              className="h-5 px-1 text-[11px]"
              icon={<VideoCameraOutlined />}
              loading={generatingVideos}
            >
              出视频{targetLabel} <DownOutlined className="text-[8px]" />
            </Button>
          </Dropdown>
          {(onBatchAudios || onBatchReAudios) && (
            <Dropdown menu={{ items: audioBatchItems }} trigger={['click']} placement="bottomRight">
              <Button
                type="text"
                size="small"
                className="h-5 px-1 text-[11px]"
                icon={<AudioOutlined />}
                loading={generatingAudios}
              >
                配音{targetLabel} <DownOutlined className="text-[8px]" />
              </Button>
            </Dropdown>
          )}
          {moreBatchItems.length > 0 && (
            <Dropdown menu={{ items: moreBatchItems }} trigger={['click']} placement="bottomRight">
              <Button
                type="text"
                size="small"
                className="h-5 px-1 text-[11px]"
              >
                更多 <DownOutlined className="text-[8px]" />
              </Button>
            </Dropdown>
          )}
          <Tooltip title={t('storyboard.addShot')}>
            <Button
              type="text"
              size="small"
              className="!w-5 !h-5 !p-0"
              icon={<PlusOutlined />}
              onClick={onAddShot}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
