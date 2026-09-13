/**
 * 多视频卡片网格组件
 *
 * - 默认（!compact）：flex-wrap 缩略图列表
 * - compact 模式：2×2 固定槽位，每槽 1/4 区域；空槽保持位置；超过 4 版本翻页；
 *   footer 提供「再生成一版」+ 翻页控件
 *   多版本数据模型已支持（StoredMediaAsset[] + currentVideoIndex）
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Modal, Tooltip, Typography, Popconfirm } from 'antd';
import {
  PlayCircleOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  VideoCameraOutlined,
  LoadingOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { ShotVideo } from '../../types';
import { electronService } from '../../services/electronService';
import { ffmpegManager } from '../../services/ffmpegManager';
import './VideoCardGrid.scss';

const { Text } = Typography;
const COMPACT_PAGE_SIZE = 4;

export interface VideoCardGridProps {
  videos: ShotVideo[];
  selectedIndex?: number;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  /** 生成按钮 disabled 时的解释（tooltip 显示） */
  generateDisabledReason?: string;
  compact?: boolean;
}

export const VideoCardGrid: React.FC<VideoCardGridProps> = ({
  videos,
  selectedIndex = 0,
  onSelect,
  onDelete,
  onGenerate,
  isGenerating = false,
  disabled = false,
  generateDisabledReason: _generateDisabledReason,
  compact = false,
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [generatedThumbnails, setGeneratedThumbnails] = useState<Record<string, string>>({});

  // ===== compact 模式翻页状态 =====
  const totalPages = Math.max(1, Math.ceil(videos.length / COMPACT_PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(() => Math.floor((selectedIndex || 0) / COMPACT_PAGE_SIZE));
  useEffect(() => {
    if (!compact) return;
    const target = Math.floor((selectedIndex || 0) / COMPACT_PAGE_SIZE);
    if (target !== currentPage) setCurrentPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, compact]);
  const prevVideosLenRef = useRef(videos.length);
  useEffect(() => {
    if (!compact) return;
    if (videos.length > prevVideosLenRef.current) {
      const lastPage = Math.max(0, Math.ceil(videos.length / COMPACT_PAGE_SIZE) - 1);
      setCurrentPage(lastPage);
    }
    prevVideosLenRef.current = videos.length;
  }, [videos.length, compact]);
  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(Math.max(0, totalPages - 1));
  }, [currentPage, totalPages]);

  const getVideoKey = useCallback((video: ShotVideo) => {
    const base = `${video.path}|${video.createdAt}|${video.url || ''}`;
    let hash = 0;
    for (let i = 0; i < base.length; i += 1) {
      hash = ((hash << 5) - hash) + base.charCodeAt(i);
      hash |= 0;
    }
    return `shot-video-${Math.abs(hash)}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 性能：快速滚动场景下虚拟滚动会瞬时挂卸大量 VideoCardGrid，
    // 如果立刻并发抽帧 ffmpeg 队列会被洗刷，反而加剧卡顿。
    // 改成 220ms debounce + 串行抽帧——挂载不到 220ms 就被卸载（如快速滚过）→ 完全不触发 ffmpeg。
    const timer = setTimeout(async () => {
      const missingVideos = videos.filter(video => !video.thumbnailPath && video.path);
      if (missingVideos.length === 0 || cancelled) return;

      // 串行执行避免单帧 mount 时一次性扔出 N 个 ffmpeg 任务
      for (const video of missingVideos) {
        if (cancelled) return;
        try {
          const framePath = await ffmpegManager.getPosterFrame(video.path, getVideoKey(video), 320);
          if (cancelled || !framePath) continue;
          const url = electronService.fs.toLocalUrl(framePath);
          setGeneratedThumbnails(prev => ({ ...prev, [getVideoKey(video)]: url }));
        } catch {
          // 单条抽帧失败继续下一条，不阻断整个队列
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [videos, getVideoKey]);

  const thumbnailSources = useMemo(
    () => videos.map((video) => {
      if (video.thumbnailPath) {
        return electronService.fs.toLocalUrl(video.thumbnailPath);
      }
      return generatedThumbnails[getVideoKey(video)] || '';
    }),
    [videos, generatedThumbnails, getVideoKey]
  );

  const handlePlay = useCallback((video: ShotVideo, e: React.MouseEvent) => {
    e.stopPropagation();
    const source = video.path || video.url || '';
    const url = electronService.fs.toLocalUrl(source);
    setPreviewUrl(url);
    setPreviewVisible(true);
  }, []);

  const handleDelete = useCallback((index: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onDelete(index);
  }, [onDelete]);

  // ===== compact 模式：2×2 固定槽位 =====
  // 父级（ShotCard）负责渲染 generate 按钮，footer 只剩翻页指示器
  // 空数组不再渲染 2×2 占位
  if (compact) {
    if (videos.length === 0) {
      return <div className="videoCardGrid compact compactEmpty" />;
    }
    const pageStart = currentPage * COMPACT_PAGE_SIZE;
    const pageItems = Array.from({ length: COMPACT_PAGE_SIZE }, (_, i) => videos[pageStart + i]);
    const pageThumbs = Array.from({ length: COMPACT_PAGE_SIZE }, (_, i) => thumbnailSources[pageStart + i]);

    return (
      <div className="videoCardGrid compact">
        <div className="compactGrid2x2">
          {pageItems.map((video, i) => {
            const globalIdx = pageStart + i;
            if (!video) {
              return <div key={`empty-${i}`} className="slotEmpty" aria-label="空版本槽位" />;
            }
            const isSelected = globalIdx === selectedIndex;
            const thumb = pageThumbs[i];
            return (
              <div
                key={`slot-${globalIdx}`}
                className={`slot ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelect(globalIdx)}
                title={`版本 ${globalIdx + 1}${isSelected ? '（当前）' : ''}`}
              >
                {thumb ? (
                  <img src={thumb} alt={`v${globalIdx + 1}`} />
                ) : (
                  <div className="videoPlaceholder">
                    <VideoCameraOutlined />
                  </div>
                )}
                {isSelected && <CheckCircleFilled className="selectedIcon" />}
                <div className="slotIndexBadge">v{globalIdx + 1}</div>
                <div className="slotOverlay">
                  <Tooltip title="播放">
                    <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={(e) => handlePlay(video, e)} className="overlayBtn" />
                  </Tooltip>
                  <Popconfirm
                    title="确定删除此版本？"
                    onConfirm={(e) => handleDelete(globalIdx, e as any)}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Tooltip title="删除">
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                        className="overlayBtn"
                      />
                    </Tooltip>
                  </Popconfirm>
                </div>
              </div>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="compactFooter">
            <div className="compactPager">
              <Button type="text" size="small" icon={<LeftOutlined />} className="pagerBtn"
                disabled={currentPage === 0}
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))} />
              <span className="pagerText">{currentPage + 1}/{totalPages}</span>
              <Button type="text" size="small" icon={<RightOutlined />} className="pagerBtn"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} />
            </div>
          </div>
        )}

        {/* 视频播放弹窗 */}
        <Modal
          title="视频预览"
          open={previewVisible}
          onCancel={() => setPreviewVisible(false)}
          footer={null}
          width={720}
          centered
          destroyOnHidden
        >
          <video
            src={previewUrl}
            controls
            autoPlay
            className="videoPreviewPlayer"
          />
        </Modal>
      </div>
    );
  }

  // ===== 默认模式：原有 flex-wrap =====
  return (
    <div className="videoCardGrid">
      <div className="videoCards">
        {videos.map((video, idx) => (
          <div
            key={idx}
            className={`videoCard ${idx === selectedIndex ? 'selected' : ''}`}
            onClick={() => onSelect(idx)}
          >
            {thumbnailSources[idx] ? (
              <img src={thumbnailSources[idx]} alt={`v${idx + 1}`} />
            ) : (
              <div className="videoPlaceholder">
                <VideoCameraOutlined />
              </div>
            )}
            <span className="versionLabel">v{idx + 1}</span>
            {idx === selectedIndex && <CheckCircleFilled className="selectedIcon" />}
            <div className="cardOverlay">
              <Tooltip title="播放">
                <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={(e) => handlePlay(video, e)} className="overlayBtn" />
              </Tooltip>
              <Popconfirm
                title="确定删除此版本？"
                onConfirm={(e) => handleDelete(idx, e as any)}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Tooltip title="删除">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                    className="overlayBtn"
                  />
                </Tooltip>
              </Popconfirm>
            </div>
          </div>
        ))}

        {videos.length === 0 && (
          <div className="videoCard empty">
            <VideoCameraOutlined />
            <Text type="secondary" className="emptyVideoText">无视频</Text>
          </div>
        )}
      </div>

      {onGenerate && (
        <Button
          type="text"
          size="small"
          icon={isGenerating ? <LoadingOutlined /> : <VideoCameraOutlined />}
          onClick={onGenerate}
          disabled={isGenerating || disabled}
          className="generateBtn"
        >
          {isGenerating ? '生成中' : 'AI生成视频'}
        </Button>
      )}

      <Modal
        title="视频预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={720}
        centered
        destroyOnHidden
      >
        <video
          src={previewUrl}
          controls
          autoPlay
          className="videoPreviewPlayer"
        />
      </Modal>
    </div>
  );
};

export default VideoCardGrid;
