/**
 * 多图片卡片网格组件
 *
 * - 默认（!compact）：flex-wrap，每张 100×70 缩略图（资产面板用）
 * - compact 模式：2×2 固定槽位 grid，每槽真正占 1/4 区域；空槽保持位置不动；
 *   超过 4 张走翻页（footer 「‹ 1/N ›」），顺带 footer 提供「再生成一版」+ 「添加 ▾」
 *   多版本数据模型已支持（StoredMediaAsset[] + currentImageIndex）
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Image, Tooltip, Typography, App } from 'antd';
import {
  PlusOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  EyeOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  LoadingOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { Character, Scene, Prop } from '../../types';
import { electronService } from '../../services/electronService';
import { buildImageAddMenu } from './imageAddMenu';
import './ImageCardGrid.scss';

const { Text } = Typography;

const COMPACT_PAGE_SIZE = 4;

function toDisplayUrl(source: string): string {
  if (/^https?:\/\//i.test(source) || source.startsWith('data:') || source.startsWith('blob:') || source.startsWith('koma-local://')) {
    return source;
  }
  return electronService.fs.toLocalUrl(source);
}

export interface ImageCardGridProps {
  images: string[];
  selectedIndex?: number;
  onSelect: (index: number) => void;
  onAdd: (imagePath: string) => void;
  onDelete: (index: number) => void | Promise<void>;
  onSplitGrid?: (index: number) => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  characters?: Character[];
  scenes?: Scene[];
  props?: Prop[];
  compact?: boolean;  // 紧凑模式：分镜卡片专用，2×2 固定槽位 + 翻页
}

export const ImageCardGrid: React.FC<ImageCardGridProps> = ({
  images,
  selectedIndex = 0,
  onSelect,
  onAdd,
  onDelete,
  onSplitGrid,
  onGenerate,
  isGenerating = false,
  disabled = false,
  characters = [],
  scenes = [],
  props: propsList = [],
  compact = false,
}) => {
  const { message } = App.useApp();
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // ====== compact 模式翻页状态 ======
  const totalPages = Math.max(1, Math.ceil(images.length / COMPACT_PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(() => Math.floor((selectedIndex || 0) / COMPACT_PAGE_SIZE));
  // 当选中索引变化（外部切版本）→ 翻到目标版本所在页
  useEffect(() => {
    if (!compact) return;
    const target = Math.floor((selectedIndex || 0) / COMPACT_PAGE_SIZE);
    if (target !== currentPage) setCurrentPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, compact]);
  // 新版本生成后（images 数量增加）→ 跳到末页让用户立刻看到新生成的
  const prevImagesLenRef = useRef(images.length);
  useEffect(() => {
    if (!compact) return;
    if (images.length > prevImagesLenRef.current) {
      const lastPage = Math.max(0, Math.ceil(images.length / COMPACT_PAGE_SIZE) - 1);
      setCurrentPage(lastPage);
    }
    prevImagesLenRef.current = images.length;
  }, [images.length, compact]);
  // 越界保护：删除版本后页码可能超出 totalPages
  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(Math.max(0, totalPages - 1));
  }, [currentPage, totalPages]);

  // 添加菜单 = 共享构造器（本地上传 + 角色 / 场景 / 道具子菜单）
  const addMenuItems = buildImageAddMenu({
    onAdd,
    characters,
    scenes,
    props: propsList,
    message,
  });

  const handlePreview = (index: number) => {
    setPreviewIndex(index);
    setPreviewVisible(true);
  };

  const handleDelete = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    void onDelete(index);
  };

  const handlePreviewClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    handlePreview(index);
  };

  const handleSplitGridClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    onSplitGrid?.(index);
  };

  const hasImages = images.length > 0;
  const generateLabel = hasImages ? '再生成一版' : 'AI生成';
  const generatingLabel = hasImages ? '生成中...' : '生成中';

  // ===== compact 模式：2×2 固定槽位 grid =====
  // 父级（ShotCard）负责渲染 add/generate 按钮，所以 footer 只剩翻页指示器
  // 空数组不再渲染 2×2 占位，直接空白（避免视觉噪声）
  if (compact) {
    if (images.length === 0) {
      return <div className="imageCardGrid compact compactEmpty" />;
    }
    const pageStart = currentPage * COMPACT_PAGE_SIZE;
    const pageItems = Array.from({ length: COMPACT_PAGE_SIZE }, (_, i) => images[pageStart + i]);

    return (
      <div className="imageCardGrid compact">
        <div className="compactGrid2x2">
          {pageItems.map((img, i) => {
            const globalIdx = pageStart + i;
            if (!img) {
              return <div key={`empty-${i}`} className="slotEmpty" aria-label="空版本槽位" />;
            }
            const isSelected = globalIdx === selectedIndex;
            return (
              <div
                key={`slot-${globalIdx}`}
                className={`slot ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelect(globalIdx)}
                onDoubleClick={() => handlePreview(globalIdx)}
                title={`版本 ${globalIdx + 1}${isSelected ? '（当前）' : ''}`}
              >
                <img src={toDisplayUrl(img)} alt={`v${globalIdx + 1}`} />
                {isSelected && <CheckCircleFilled className="selectedIcon" />}
                <div className="slotIndexBadge">v{globalIdx + 1}</div>
                <div className="slotOverlay">
                  <Tooltip title="预览">
                    <Button type="text" size="small" icon={<EyeOutlined />} onClick={(e) => handlePreviewClick(globalIdx, e)} className="overlayBtn" />
                  </Tooltip>
                  {onSplitGrid && (
                    <Tooltip title="拆分九宫格">
                      <Button type="text" size="small" icon={<AppstoreOutlined />} onClick={(e) => handleSplitGridClick(globalIdx, e)} className="overlayBtn" />
                    </Tooltip>
                  )}
                  <Tooltip title="删除此版本">
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => handleDelete(globalIdx, e)} className="overlayBtn" />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="compactFooter">
            <div className="compactPager">
              <Button
                type="text"
                size="small"
                icon={<LeftOutlined />}
                className="pagerBtn"
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              />
              <span className="pagerText">{currentPage + 1}/{totalPages}</span>
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                className="pagerBtn"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              />
            </div>
          </div>
        )}

        {/* 预览组（隐藏 trigger，靠双击/按钮唤起） */}
        <Image.PreviewGroup
          preview={{
            open: previewVisible,
            onOpenChange: setPreviewVisible,
            current: previewIndex,
          }}
        >
          <div className="hiddenPreviewImages">
            {images.map((img, idx) => (
              <Image key={idx} src={toDisplayUrl(img)} />
            ))}
          </div>
        </Image.PreviewGroup>
      </div>
    );
  }

  // ===== 默认模式：原有 flex-wrap 布局（资产面板等用） =====
  return (
    <div className="imageCardGrid">
      <div className="imageCards">
        {images.map((img, idx) => (
          <div
            key={idx}
            className={`imageCard ${idx === selectedIndex ? 'selected' : ''}`}
            onClick={() => onSelect(idx)}
            onDoubleClick={() => handlePreview(idx)}
          >
            <img src={toDisplayUrl(img)} alt={`img-${idx}`} />
            {idx === selectedIndex && <CheckCircleFilled className="selectedIcon" />}
            <div className="cardOverlay">
              <Tooltip title="预览图像">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={(e) => handlePreviewClick(idx, e)}
                  className="overlayBtn"
                />
              </Tooltip>
              {onSplitGrid && (
                <Tooltip title="拆分九宫格">
                  <Button
                    type="text"
                    size="small"
                    icon={<AppstoreOutlined />}
                    onClick={(e) => handleSplitGridClick(idx, e)}
                    className="overlayBtn"
                  />
                </Tooltip>
              )}
              <Tooltip title="删除此图像">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => handleDelete(idx, e)}
                  className="overlayBtn"
                />
              </Tooltip>
            </div>
          </div>
        ))}

        <Dropdown menu={{ items: addMenuItems }} trigger={['click']} disabled={disabled}>
          <div className="imageCard addCard">
            <PlusOutlined />
            <Text type="secondary" className="addCardText">添加</Text>
          </div>
        </Dropdown>
      </div>

      {onGenerate && (
        <Button
          type="text"
          size="small"
          icon={isGenerating ? <LoadingOutlined /> : <ThunderboltOutlined />}
          onClick={onGenerate}
          disabled={isGenerating || disabled}
          className="generateBtn"
        >
          {isGenerating ? generatingLabel : generateLabel}
        </Button>
      )}

      <Image.PreviewGroup
        preview={{
          open: previewVisible,
          onOpenChange: setPreviewVisible,
          current: previewIndex,
        }}
      >
        <div className="hiddenPreviewImages">
          {images.map((img, idx) => (
            <Image key={idx} src={toDisplayUrl(img)} />
          ))}
        </div>
      </Image.PreviewGroup>
    </div>
  );
};

export default ImageCardGrid;
