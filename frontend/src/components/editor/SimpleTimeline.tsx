/**
 * 简洁版时间线组件
 * 迁移自 electron-egg，高性能拖拽
 */
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Track, Clip, Asset, MediaType, Keyframe, EasingType } from '../../types/editor';
import { toKomaLocalUrl } from '../../utils/urlUtils';
import { useVideoFramesBatch } from './useVideoFrames';
import { hasCollision } from '../../utils/trackCollision';
import {
  getSortedTrackClips,
  resolveTimelineTracks,
  getAddableTransitionCount,
  getAddableTransitionDuration,
  getExistingTransitionCount,
  getMainVideoTrack,
} from '../../features/transition/core';
import { TransitionOverlay } from '../../features/transition/ui';
import {
  Play, Pause, Film, Music, Type, Trash2, Copy, ZoomIn, ZoomOut, Magnet,
  Volume2, VolumeX, Eye, EyeOff, Wand2, Eraser
} from 'lucide-react';
import { Popconfirm } from 'antd';
import { createLogger } from '../../store/logger';
import styles from './SimpleTimeline.module.scss';
import { cssVars } from '../../theme/runtime';

const logger = createLogger('SimpleTimeline');

interface TimelineProps {
  tracks: Track[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
  onMoveClip: (clipId: string, newTime: number, newTrackId: string) => void;
  onAssetDrop: (asset: Asset, time: number, trackId?: string) => void;
  onDeleteClip?: (clipId: string) => void;
  onAddKeyframe?: (clipId: string, clipLocalTime: number) => void;
  onSelectKeyframe?: (clipId: string, keyframeId: string | null) => void;
  onDeleteKeyframe?: (clipId: string, keyframeId: string) => void;
  onDuplicateClip?: (clipId: string) => void;
  onUpdateKeyframeEasing?: (clipId: string, keyframeId: string, easing: EasingType) => void;
  selectedKeyframeId?: string | null;
  isPlaying: boolean;
  togglePlay: () => void;
  onDeleteTrack: (trackId: string) => void;
  onUpdateTrack?: (trackId: string, updates: Partial<Track>) => void;
  selectedTransitionId?: string | null;
  onSelectTransition?: (id: string | null) => void;
  onAddTransition?: (trackId: string, fromClipId: string, toClipId: string) => void;
  onUpdateTransitionDuration?: (trackId: string, transitionId: string, duration: number) => void;
  onDeleteTransition?: (trackId: string, transitionId: string) => void;
  draggingAsset: Asset | null;
  onExport?: () => void;
  onTransitionError?: (message: string) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  onAddAllTransitions?: (trackId: string) => void;
  onDeleteAllTransitions?: (trackId: string) => void;
}

// 缓动选项
const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: EasingType.LINEAR, label: '线性' },
  { value: EasingType.EASE_IN, label: '缓入' },
  { value: EasingType.EASE_OUT, label: '缓出' },
  { value: EasingType.EASE_IN_OUT, label: '缓入缓出' },
  { value: EasingType.EASE_IN_CUBIC, label: '三次缓入' },
  { value: EasingType.EASE_OUT_CUBIC, label: '三次缓出' },
  { value: EasingType.EASE_IN_OUT_CUBIC, label: '三次缓入缓出' },
];

// 右键菜单状态
interface ContextMenuState {
  type: 'clip' | 'keyframe' | 'track';
  x: number;
  y: number;
  clipId?: string;
  trackId?: string;
  keyframeId?: string;
  clipLocalTime?: number;
}

// 基础常量
const BASE_PIXELS_PER_SECOND = 20;
const TRACK_HEIGHT = 80;
const CLIP_HEIGHT = 64;
const RULER_HEIGHT = 32;
const HEADER_WIDTH = 200;
const DRAG_THRESHOLD = 5;

// 缩放配置
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.1;
const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 3];

// 吸附配置
const SNAP_THRESHOLD = 8; // 像素距离阈值
type SnapTarget = 'playhead' | 'clipStart' | 'clipEnd';

// 计算动态刻度间隔
const getMarkerInterval = (pixelsPerSecond: number): number => {
  // 根据缩放级别自动调整刻度间隔
  if (pixelsPerSecond >= 100) return 1;    // 每秒一个
  if (pixelsPerSecond >= 50) return 2;     // 每2秒
  if (pixelsPerSecond >= 20) return 5;     // 每5秒
  if (pixelsPerSecond >= 10) return 10;    // 每10秒
  if (pixelsPerSecond >= 5) return 30;     // 每30秒
  return 60;                                // 每分钟
};

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

// Filmstrip 组件
const Filmstrip: React.FC<{ clip: Clip; frames?: string[]; pixelsPerSecond: number }> = ({ clip, frames, pixelsPerSecond }) => {
  if (clip.type === MediaType.TEXT) {
    return (
      <div className="w-full h-full flex items-center px-2 pointer-events-none overflow-hidden bg-accent/15">
        <span className="text-[10px] text-text-primary truncate">{clip.name}</span>
      </div>
    );
  }

  if (clip.type === MediaType.AUDIO) {
    return (
      <div className="w-full h-full flex items-center overflow-hidden bg-status-success/14 pointer-events-none px-1">
        <div className="flex gap-0.5 h-1/2 w-full items-center">
          {Array.from({ length: Math.ceil(clip.duration * 5) }).map((_, i) => (
            <div
              key={i}
              className={`${styles.waveformBar} w-1 bg-status-success/50 rounded-full flex-shrink-0`}
              style={cssVars({ '--waveform-height': `${20 + Math.random() * 80}%` })}
            />
          ))}
        </div>
        <span className="absolute left-2 text-[10px] text-text-secondary drop-shadow truncate">{clip.name}</span>
      </div>
    );
  }

  const frameAspectRatio = 16 / 9;
  const frameWidth = CLIP_HEIGHT * frameAspectRatio;
  const totalWidth = clip.duration * pixelsPerSecond;
  const frameCount = Math.max(1, Math.ceil(totalWidth / frameWidth));

  const hasFrames = frames && frames.length > 0;
  const fallbackSrc = toKomaLocalUrl(clip.src);

  // 帧提取的帧率（与 useVideoFrames 中一致，默认 1fps）
  const extractFps = 1;
  // 每个显示格子对应的时间跨度（秒）
  const timePerFrame = frameWidth / pixelsPerSecond;

  return (
    <div className="flex h-full w-full pointer-events-none select-none overflow-hidden bg-status-info/10">
      {Array.from({ length: frameCount }).map((_, i) => {
        // 计算该位置对应的片段内时间（秒）
        const positionTime = i * timePerFrame;
        // 根据时间计算应显示的帧索引
        let frameIndex = Math.floor(positionTime * extractFps);
        // 确保不越界
        if (hasFrames) {
          frameIndex = Math.min(frameIndex, frames.length - 1);
        }
        const frameSrc = hasFrames ? frames[frameIndex] : fallbackSrc;

        return (
          <div
            key={i}
            className={`${styles.filmFrame} flex-shrink-0 h-full border-r border-white/20 relative bg-bg-elevated`}
            style={cssVars({ '--film-frame-width': `${frameWidth}px` })}
          >
            <img
              src={frameSrc}
              className="w-full h-full object-cover opacity-90 relative z-10"
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-accent/10" />
          </div>
        );
      })}
      <span className="absolute top-1 left-2 text-[10px] text-white font-medium truncate px-1 drop-shadow-md z-10 bg-black/40 rounded">
        {clip.name}
      </span>
    </div>
  );
};

export const SimpleTimeline: React.FC<TimelineProps> = ({
  tracks,
  currentTime,
  duration,
  onSeek,
  selectedClipId,
  onSelectClip,
  onUpdateClip,
  onMoveClip,
  onAssetDrop,
  onDeleteClip,
  onAddKeyframe,
  onSelectKeyframe,
  onDeleteKeyframe,
  onDuplicateClip,
  onUpdateKeyframeEasing,
  selectedKeyframeId,
  isPlaying,
  togglePlay,
  onDeleteTrack,
  onUpdateTrack,
  selectedTransitionId,
  onSelectTransition,
  onAddTransition,
  onUpdateTransitionDuration,
  onDeleteTransition,
  draggingAsset,
  onExport,
  onTransitionError,
  onDragStateChange,
  onAddAllTransitions,
  onDeleteAllTransitions
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // 缩放与吸附状态
  const [zoom, setZoom] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapLine, setSnapLine] = useState<{ x: number; type: SnapTarget } | null>(null);

  // 动态计算每秒像素数
  const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoom;
  const markerInterval = getMarkerInterval(pixelsPerSecond);
  const resolvedTracks = useMemo(() => resolveTimelineTracks(tracks), [tracks]);
  const resolvedTracksMap = useMemo(
    () => new Map(resolvedTracks.map((track) => [track.track.id, track])),
    [resolvedTracks]
  );
  const previousInvalidCountRef = useRef(0);

  useEffect(() => {
    if (!onTransitionError) return;
    const invalidCount = resolvedTracks.reduce(
      (count, track) => count + track.invalidTransitions.length,
      0
    );
    if (invalidCount > 0 && invalidCount !== previousInvalidCountRef.current) {
      onTransitionError(`检测到 ${invalidCount} 条非法转场关系，已被忽略。`);
    }
    previousInvalidCountRef.current = invalidCount;
  }, [onTransitionError, resolvedTracks]);

  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const playheadDragStart = useRef<{ startX: number; startTime: number } | null>(null);
  const [highlightedTrackId, setHighlightedTrackId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackName, setEditingTrackName] = useState('');

  // 片段拖拽状态
  const [dragState, setDragState] = useState<{
    clipId: string;
    clip: Clip;
    startX: number;
    startY: number;
    originalStart: number;
    originalTrackId: string;
    currentX: number;
    currentY: number;
    isDragging: boolean;
    currentTrackId: string | null;
    hasCollision: boolean; // 是否与其他片段碰撞
  } | null>(null);

  // 片段缩放状态
  const [resizeState, setResizeState] = useState<{
    clipId: string;
    edge: 'start' | 'end';
    startX: number;
    originalStart: number;
    originalDuration: number;
    originalOffset: number;
    sourceDuration: number; // 源素材总时长，用于边界限制
    clipType: MediaType;    // 片段类型
  } | null>(null);

  // 计算时间轴总长度
  const totalSeconds = Math.max(duration + 10, 60);
  const totalWidth = totalSeconds * pixelsPerSecond;

  // 收集所有吸附点（用于拖拽时的吸附）
  const snapPoints = useMemo(() => {
    const points: Array<{ time: number; type: SnapTarget }> = [];
    // 播放头位置
    points.push({ time: currentTime, type: 'playhead' });
    // 所有片段的起止点
    resolvedTracks.forEach((track) => {
      track.clipWindows.forEach((clip) => {
        points.push({ time: clip.resolvedStart, type: 'clipStart' });
        points.push({ time: clip.resolvedEnd, type: 'clipEnd' });
      });
    });
    return points;
  }, [currentTime, resolvedTracks]);

  // 收集所有视频片段用于帧提取
  const videoClips = useMemo(() => {
    const clips: Array<{ id: string; src: string; type: string }> = [];
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.type === MediaType.VIDEO || clip.type === MediaType.IMAGE) {
          clips.push({ id: clip.id, src: clip.src, type: clip.type === MediaType.VIDEO ? 'video' : 'image' });
        }
      }
    }
    return clips;
  }, [tracks]);

  // 批量获取视频帧
  const frameMap = useVideoFramesBatch(videoClips);

  // 播放头位置 - 用 ref 避免状态更新循环
  const playheadPositionRef = useRef({ viewportX: 0, lineTop: 0 });
  const [, forceUpdate] = useState(0);

  // 更新播放头位置 (只在滚动/resize时更新state，播放时用CSS)
  const updatePlayheadRef = useCallback(() => {
    if (!containerRef.current || !rulerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const rulerRect = rulerRef.current.getBoundingClientRect();
    playheadPositionRef.current = {
      viewportX: containerRect.left + HEADER_WIDTH,
      lineTop: rulerRect.bottom
    };
  }, []);

  useEffect(() => {
    updatePlayheadRef();
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      updatePlayheadRef();
      forceUpdate(n => n + 1);
    };

    container.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [updatePlayheadRef]);

  // 计算实际的播放头 X 坐标
  const scrollLeft = containerRef.current?.scrollLeft || 0;
  const playheadX = playheadPositionRef.current.viewportX + currentTime * pixelsPerSecond - scrollLeft;

  // 吸附检测函数
  const findSnapPoint = useCallback((time: number, _excludeClipId?: string): { time: number; type: SnapTarget } | null => {
    if (!snapEnabled) return null;

    for (const point of snapPoints) {
      const pixelDiff = Math.abs((point.time - time) * pixelsPerSecond);
      if (pixelDiff < SNAP_THRESHOLD) {
        return point;
      }
    }
    return null;
  }, [snapEnabled, snapPoints, pixelsPerSecond]);

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  }, []);

  const handleZoomPreset = useCallback((preset: number) => {
    setZoom(preset);
  }, []);

  // Ctrl+滚轮缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // 播放头拖拽
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDraggingPlayhead(true);
    playheadDragStart.current = { startX: e.clientX, startTime: currentTime };
  }, [currentTime]);

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!playheadDragStart.current) return;
      const deltaX = e.clientX - playheadDragStart.current.startX;
      const deltaSeconds = deltaX / pixelsPerSecond;
      const newTime = Math.max(0, Math.min(totalSeconds, playheadDragStart.current.startTime + deltaSeconds));
      onSeek(newTime);
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
      playheadDragStart.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPlayhead, onSeek, totalSeconds, pixelsPerSecond]);

  // 片段拖拽/缩放
  useEffect(() => {
    if (dragState) {
      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - dragState.startX;
        const deltaY = e.clientY - dragState.startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const shouldDrag = distance >= DRAG_THRESHOLD;

        // 首次触发拖动时通知
        if (shouldDrag && !dragState.isDragging) {
          onDragStateChange?.(true);
        }

        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        let foundTrackId: string | null = null;

        for (const el of elements) {
          if (el instanceof HTMLElement && el.dataset.trackId) {
            foundTrackId = el.dataset.trackId;
            if (shouldDrag) setHighlightedTrackId(foundTrackId);
            break;
          }
        }

        if (shouldDrag && foundTrackId) {
          const deltaSeconds = deltaX / pixelsPerSecond;
          let newStart = Math.max(0, dragState.originalStart + deltaSeconds);

          // 吸附检测
          if (snapEnabled) {
            const clipEnd = newStart + dragState.clip.duration;

            // 检查片段起点吸附
            const startSnap = findSnapPoint(newStart, dragState.clipId);
            if (startSnap) {
              newStart = startSnap.time;
              setSnapLine({ x: newStart * pixelsPerSecond, type: startSnap.type });
            } else {
              // 检查片段终点吸附
              const endSnap = findSnapPoint(clipEnd, dragState.clipId);
              if (endSnap) {
                newStart = endSnap.time - dragState.clip.duration;
                setSnapLine({ x: endSnap.time * pixelsPerSecond, type: endSnap.type });
              } else {
                setSnapLine(null);
              }
            }
          }

          // 碰撞检测
          const targetTrack = tracks.find(t => t.id === foundTrackId);
          const targetClips = targetTrack?.clips.filter(c => c.id !== dragState.clipId) || [];
          const tempClip = { id: dragState.clipId, start: newStart, duration: dragState.clip.duration };
          const collision = hasCollision(tempClip, targetClips);

          setDragState(prev => prev ? {
            ...prev,
            currentX: e.clientX,
            currentY: e.clientY,
            isDragging: shouldDrag,
            currentTrackId: foundTrackId,
            hasCollision: collision
          } : null);

          // 不管是否碰撞都更新位置（实时显示预览），释放时再处理
          onMoveClip(dragState.clipId, newStart, foundTrackId);
        } else {
          setDragState(prev => prev ? {
            ...prev,
            currentX: e.clientX,
            currentY: e.clientY,
            isDragging: shouldDrag,
            currentTrackId: foundTrackId
          } : null);
        }
      };

      const handleMouseUp = () => {
        // 如果有碰撞，回退到原位置
        if (dragState.hasCollision && dragState.isDragging) {
          onMoveClip(dragState.clipId, dragState.originalStart, dragState.originalTrackId);
        }
        onDragStateChange?.(false);
        setDragState(null);
        setHighlightedTrackId(null);
        setSnapLine(null);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }

    if (resizeState) {
      const handleResizeMove = (e: MouseEvent) => {
        const deltaX = e.clientX - resizeState.startX;
        const deltaSeconds = deltaX / pixelsPerSecond;

        // 图片/文本类型可以无限拉长，视频/音频受源素材时长限制
        const hasSourceLimit = resizeState.clipType === MediaType.VIDEO || resizeState.clipType === MediaType.AUDIO;
        const maxAvailable = hasSourceLimit ? resizeState.sourceDuration : Infinity;

        if (resizeState.edge === 'end') {
          // 向右拉长：检查不超过源素材剩余长度
          // 可用的最大时长 = sourceDuration - offset
          const maxDuration = hasSourceLimit
            ? maxAvailable - resizeState.originalOffset
            : Infinity;
          const newDuration = Math.max(0.1, Math.min(maxDuration, resizeState.originalDuration + deltaSeconds));
          onUpdateClip(resizeState.clipId, { duration: newDuration });
        } else {
          // 向左拉长：检查不超过 offset（不能小于 0）
          let newStart = resizeState.originalStart + deltaSeconds;
          const endTime = resizeState.originalStart + resizeState.originalDuration;

          // 计算对应的新 offset
          const newOffset = resizeState.originalOffset + (newStart - resizeState.originalStart);

          // 边界检查
          if (newStart < 0) newStart = 0;
          if (newStart > endTime - 0.1) newStart = endTime - 0.1;

          // 对于视频/音频，检查 offset 不能小于 0
          if (hasSourceLimit && newOffset < 0) {
            // 限制 newStart，使 offset 刚好为 0
            newStart = resizeState.originalStart - resizeState.originalOffset;
          }

          const newDuration = endTime - newStart;
          const finalOffset = Math.max(0, resizeState.originalOffset + (newStart - resizeState.originalStart));
          onUpdateClip(resizeState.clipId, { start: newStart, duration: newDuration, offset: finalOffset });
        }
      };
      const handleResizeUp = () => {
        onDragStateChange?.(false);
        setResizeState(null);
      };

      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeUp);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeUp);
      };
    }
  }, [dragState, resizeState, onUpdateClip, onMoveClip, pixelsPerSecond, snapEnabled, findSnapPoint, tracks]);

  const handleClipMouseDown = (e: React.MouseEvent, clip: Clip) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[class*="cursor-w-resize"]') || target.closest('[class*="cursor-e-resize"]')) return;

    e.stopPropagation();
    onSelectClip(clip.id);
    setDragState({
      clipId: clip.id,
      clip,
      startX: e.clientX,
      startY: e.clientY,
      originalStart: clip.start,
      originalTrackId: clip.trackId,
      currentX: e.clientX,
      currentY: e.clientY,
      isDragging: false,
      currentTrackId: clip.trackId,
      hasCollision: false
    });
  };

  const handleResizeMouseDown = (e: React.MouseEvent, clip: Clip, edge: 'start' | 'end') => {
    e.stopPropagation();
    onDragStateChange?.(true);
    // 获取源素材时长：优先使用 clip.sourceDuration，否则用当前 duration + offset 作为估算
    const sourceDuration = clip.sourceDuration ?? (clip.duration + clip.offset);
    setResizeState({
      clipId: clip.id,
      edge,
      startX: e.clientX,
      originalStart: clip.start,
      originalDuration: clip.duration,
      originalOffset: clip.offset,
      sourceDuration,
      clipType: clip.type
    });
  };

  const handleDragOver = (e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setMousePos({ x: e.clientX, y: e.clientY });
    if (trackId) setHighlightedTrackId(trackId);
  };

  const handleDrop = (e: React.DragEvent, trackId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current) return;

    let asset: Asset | null = null;
    const json = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (json) {
      try { asset = JSON.parse(json); } catch { /* ignore */ }
    }
    if (!asset && draggingAsset) {
      asset = draggingAsset;
    }
    if (!asset) return;

    try {
      const containerRect = containerRef.current.getBoundingClientRect();
      const dropX = e.clientX - containerRect.left + containerRef.current.scrollLeft - HEADER_WIDTH;
      const time = Math.max(0, dropX / pixelsPerSecond);
      onAssetDrop(asset, time, trackId);
    } catch (err) {
      logger.error("Drop failed", err);
    } finally {
      setHighlightedTrackId(null);
    }
  };

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 片段右键菜单
  const handleClipContextMenu = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();

    // 计算片段内的本地时间
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const scrollLeft = containerRef.current?.scrollLeft || 0;
    const clickX = e.clientX - containerRect.left + scrollLeft - HEADER_WIDTH;
    const clickTime = clickX / pixelsPerSecond;
    const resolvedWindow = resolvedTracksMap
      .get(clip.trackId)
      ?.clipWindows.find((window) => window.clipId === clip.id);
    const clipLocalTime = Math.max(
      0,
      Math.min(clip.duration, clickTime - (resolvedWindow?.resolvedStart ?? clip.start))
    );

    onSelectClip(clip.id);
    setContextMenu({
      type: 'clip',
      x: e.clientX,
      y: e.clientY,
      clipId: clip.id,
      clipLocalTime
    });
  }, [onSelectClip, pixelsPerSecond, resolvedTracksMap]);

  const handleTrackContextMenu = useCallback((e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenu({
      type: 'track',
      x: e.clientX,
      y: e.clientY,
      trackId: track.id,
    });
  }, []);

  // 关键帧右键菜单
  const handleKeyframeContextMenu = useCallback((e: React.MouseEvent, clipId: string, keyframe: Keyframe) => {
    e.preventDefault();
    e.stopPropagation();

    onSelectKeyframe?.(clipId, keyframe.id);
    setContextMenu({
      type: 'keyframe',
      x: e.clientX,
      y: e.clientY,
      clipId,
      keyframeId: keyframe.id
    });
  }, [onSelectKeyframe]);

  // 全局点击关闭菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => closeContextMenu();
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu, closeContextMenu]);

  // 主轨道转场相关预计算，避免 toolbar 每次 render 重复 O(n*m) 计算
  const { mainTrack, mainTrackClipCount, mainTrackTransitionCount, mainTrackAddableCount } = useMemo(() => {
    const mt = getMainVideoTrack(tracks);
    return {
      mainTrack: mt,
      mainTrackClipCount: mt ? mt.clips.length : 0,
      mainTrackTransitionCount: mt ? getExistingTransitionCount(mt) : 0,
      mainTrackAddableCount: mt ? getAddableTransitionCount(mt) : 0,
    };
  }, [tracks]);

  // 生成刻度（动态间隔）
  const markers = useMemo(() => {
    const result = [];
    for (let i = 0; i < totalSeconds; i += markerInterval) {
      result.push(
        <div
          key={i}
          className={`${styles.marker} absolute top-0 h-full flex flex-col justify-end pb-1 select-none pointer-events-none`}
          style={cssVars({ '--marker-left': `${i * pixelsPerSecond}px` })}
        >
          <div className="h-3 border-l border-border" />
          <span className="text-[10px] text-text-tertiary pl-1 whitespace-nowrap">{formatTime(i)}</span>
        </div>
      );
      // 添加中间小刻度
      if (markerInterval >= 5) {
        for (let j = 1; j < markerInterval && i + j < totalSeconds; j++) {
          if (j === markerInterval / 2) {
            result.push(
              <div
                key={`${i}-${j}`}
                className={`${styles.marker} absolute top-0 h-full flex flex-col justify-end pb-1 select-none pointer-events-none`}
                style={cssVars({ '--marker-left': `${(i + j) * pixelsPerSecond}px` })}
              >
                <div className="h-2 border-l border-border" />
              </div>
            );
          }
        }
      }
    }
    return result;
  }, [totalSeconds, markerInterval, pixelsPerSecond]);

  return (
    <div className={`${styles.root} flex flex-col h-full select-none`}>
      {/* 工具栏 */}
      <div className={`${styles.toolbar} h-10 flex items-center px-4 justify-between flex-shrink-0 z-50 overflow-x-auto gap-2`}>
        <div className="flex items-center gap-4">
          <button onClick={togglePlay} className="text-text-secondary hover:text-text-primary transition-colors">
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="text-xs font-mono text-status-info">{formatTime(currentTime)}</span>
          <span className="text-xs text-text-muted">/</span>
          <span className="text-xs font-mono text-text-tertiary">{formatTime(duration)}</span>
        </div>

        {/* 缩放和吸附控件 */}
        <div className="flex items-center gap-3">
          {/* 一键转场 */}
          <button
            type="button"
            disabled={mainTrackAddableCount === 0}
            onClick={() => mainTrack && onAddAllTransitions?.(mainTrack.id)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-bg-hover hover:bg-bg-hover text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            title={mainTrackClipCount <= 1 ? '需要至少 2 个相邻片段' : mainTrackAddableCount === 0 ? '暂无可添加转场的切点' : '一键转场'}
          >
            <Wand2 size={14} />
            一键转场
          </button>

          {/* 清除转场 */}
          <Popconfirm
            title="删除所有转场"
            description={`将删除该轨道上的 ${mainTrackTransitionCount} 个转场，无法撤销`}
            onConfirm={() => mainTrack && onDeleteAllTransitions?.(mainTrack.id)}
            okButtonProps={{ danger: true }}
            placement="topRight"
            disabled={mainTrackTransitionCount === 0}
          >
            <button
              type="button"
              disabled={mainTrackTransitionCount === 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-tertiary hover:text-status-error disabled:opacity-40 disabled:cursor-not-allowed"
              title={mainTrackTransitionCount === 0 ? '无转场可清除' : '清除转场'}
            >
              <Eraser size={14} />
              清除转场
            </button>
          </Popconfirm>

          {/* 吸附开关 */}
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              snapEnabled
                ? 'bg-status-info/20 text-status-info border border-status-info/50'
                : 'bg-bg-elevated text-text-tertiary hover:text-text-secondary'
            }`}
            title="吸附对齐"
          >
            <Magnet size={12} />
            <span>吸附</span>
          </button>

          {/* 缩放控件 */}
          <div className="flex items-center gap-1 bg-bg-elevated rounded px-1">
            <button
              onClick={handleZoomOut}
              className="p-1 text-text-secondary hover:text-text-primary transition-colors"
              title="缩小"
            >
              <ZoomOut size={14} />
            </button>

            {/* 缩放滑块 */}
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-20 h-1 accent-status-info cursor-pointer"
            />

            <button
              onClick={handleZoomIn}
              className="p-1 text-text-secondary hover:text-text-primary transition-colors"
              title="放大"
            >
              <ZoomIn size={14} />
            </button>

            <span className="text-xs text-text-secondary w-10 text-center">{Math.round(zoom * 100)}%</span>
          </div>

          {/* 缩放预设 */}
          <div className="hidden lg:flex gap-0.5">
            {ZOOM_PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => handleZoomPreset(preset)}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  Math.abs(zoom - preset) < 0.05
                    ? 'bg-status-info/30 text-status-info'
                    : 'bg-bg-elevated text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {preset}x
              </button>
            ))}
          </div>

          <span className="text-xs text-text-secondary">{tracks.length} 轨道</span>

          {/* 导出按钮 */}
          {onExport && (
            <button
              onClick={onExport}
              className="ml-2 px-3 py-1 bg-status-info hover:bg-status-info text-on-status text-xs rounded transition-colors"
            >
              导出
            </button>
          )}
        </div>
      </div>

      {/* 滚动区域 */}
      <div
        className={`${styles.scroller} flex-1 overflow-auto relative`}
        ref={containerRef}
        onDragOver={(e) => handleDragOver(e)}
        onDrop={(e) => handleDrop(e)}
      >
        <div className={`${styles.content} min-w-max pb-32`} style={cssVars({ '--timeline-min-width': `${totalWidth + HEADER_WIDTH}px` })}>
          {/* 时间标尺 */}
          <div ref={rulerRef} className={`${styles.ruler} sticky top-0 z-30 flex`} style={cssVars({ '--ruler-height': `${RULER_HEIGHT}px` })}>
            <div className={`${styles.trackHeaderSpacer} sticky left-0 w-[200px] flex-shrink-0 z-40`} />
            <div className={`${styles.rulerTrack} relative flex-1 h-full`} style={cssVars({ '--timeline-track-width': `${totalWidth}px` })}>
              {markers}
              {/* 播放头手柄 */}
              <div className={`${styles.playheadHandlePosition} absolute top-0 z-50`} style={cssVars({ '--playhead-left': `${currentTime * pixelsPerSecond}px` })}>
                <div
                  className={`absolute top-0 left-0 -translate-x-1/2 transition-transform ${isDraggingPlayhead ? 'scale-110 cursor-grabbing' : 'hover:scale-105 cursor-grab'}`}
                  onMouseDown={handlePlayheadMouseDown}
                >
                  <svg width="12" height="16" viewBox="0 0 12 16" className="text-status-info">
                    <path d="M1 1C1 0.447715 1.44772 0 2 0H10C10.5523 0 11 0.447715 11 1V11.382C11 11.7607 10.786 12.107 10.4472 12.2764L6.44721 14.2764C6.16569 14.4172 5.83431 14.4172 5.55279 14.2764L1.55279 12.2764C1.214 12.107 1 11.7607 1 11.382V1Z" fill="currentColor" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* 轨道列表 */}
          {tracks.map((track, index) => (
            <div
              key={track.id}
              data-track-id={track.id}
              className={`${styles.trackRow} flex group/track relative transition-all ${
                highlightedTrackId === track.id ? 'bg-status-info/20 ring-1 ring-status-info/50' : 'bg-bg-surface/20 hover:bg-bg-surface/40'
              } ${track.isMainTrack ? 'border-l-4 border-l-blue-500' : ''}`}
              style={cssVars({ '--track-height': `${TRACK_HEIGHT}px` })}
              onDragOver={(e) => handleDragOver(e, track.id)}
              onDrop={(e) => handleDrop(e, track.id)}
            >
              {/* 轨道头部 */}
              <div
                className={`${styles.trackHeader} sticky left-0 w-[200px] flex-shrink-0 z-30 flex flex-col justify-center px-3`}
                onContextMenu={(e) => handleTrackContextMenu(e, track)}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 text-text-secondary text-xs font-medium flex-1 min-w-0">
                    {track.type === 'video' && <Film size={14} className="text-status-info flex-shrink-0" />}
                    {track.type === 'audio' && <Music size={14} className="text-status-success flex-shrink-0" />}
                    {track.type === 'text' && <Type size={14} className="text-accent flex-shrink-0" />}
                    {editingTrackId === track.id ? (
                      <input
                        type="text"
                        value={editingTrackName}
                        onChange={(e) => setEditingTrackName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onUpdateTrack?.(track.id, { name: editingTrackName });
                            setEditingTrackId(null);
                          } else if (e.key === 'Escape') {
                            setEditingTrackId(null);
                          }
                        }}
                        onBlur={() => {
                          onUpdateTrack?.(track.id, { name: editingTrackName });
                          setEditingTrackId(null);
                        }}
                        autoFocus
                        className="bg-bg-hover text-text-primary text-xs px-1 py-0.5 rounded w-full outline-none border border-status-info"
                      />
                    ) : (
                      <span
                        className="truncate cursor-pointer hover:text-text-primary"
                        onDoubleClick={() => {
                          if (onUpdateTrack) {
                            setEditingTrackId(track.id);
                            setEditingTrackName(track.name || (track.isMainTrack ? '主轨道' : `${track.type.toUpperCase()} ${index + 1}`));
                          }
                        }}
                      >
                        {track.name || (track.isMainTrack ? '主轨道' : `${track.type.toUpperCase()} ${index + 1}`)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    {/* 静音按钮 - 视频和音频轨道 */}
                    {(track.type === 'video' || track.type === 'audio') && onUpdateTrack && (
                      <button
                        onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                        className={`p-1 rounded transition-colors ${
                          track.muted ? 'text-status-error bg-status-error/20' : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                        title={track.muted ? '取消静音' : '静音'}
                      >
                        {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
                    )}
                    {/* 隐藏按钮 - 非主轨道 */}
                    {!track.isMainTrack && onUpdateTrack && (
                      <button
                        onClick={() => onUpdateTrack(track.id, { hidden: !track.hidden })}
                        className={`p-1 rounded transition-colors ${
                          track.hidden ? 'text-status-warning bg-status-warning/20' : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                        title={track.hidden ? '显示轨道' : '隐藏轨道'}
                      >
                        {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    )}
                    {/* 删除按钮 - 非主轨道 */}
                    {!track.isMainTrack && (
                      <button
                        onClick={() => onDeleteTrack(track.id)}
                        className="opacity-0 group-hover/track:opacity-100 text-status-error hover:text-status-error p-1 rounded"
                        title="删除轨道"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 轨道内容 */}
              <div className={`${styles.trackLane} relative flex-1 h-full overflow-clip`} style={cssVars({ '--timeline-track-width': `${totalWidth}px` })}>
                {(() => {
                  const resolvedTrack = resolvedTracksMap.get(track.id);
                  const clipWindows = new Map(
                    (resolvedTrack?.clipWindows ?? []).map((window) => [window.clipId, window])
                  );

                  return (
                    <TransitionOverlay
                      track={track}
                      resolvedClipWindows={clipWindows}
                      pixelsPerSecond={pixelsPerSecond}
                      selectedTransitionId={selectedTransitionId ?? null}
                      onSelectTransition={onSelectTransition}
                      onAddTransition={onAddTransition}
                      onUpdateTransitionDuration={onUpdateTransitionDuration}
                      onDeleteTransition={onDeleteTransition}
                      invalidTransitions={resolvedTrack?.invalidTransitions ?? []}
                      isDragging={!!dragState?.isDragging}
                    />
                  );
                })()}
                {track.clips.map(clip => (
                  (() => {
                    const resolvedWindow = resolvedTracksMap
                      .get(track.id)
                      ?.clipWindows.find((window) => window.clipId === clip.id);
                    const clipLeft = (resolvedWindow?.resolvedStart ?? clip.start) * pixelsPerSecond;

                    return (
                      <div
                        key={clip.id}
                        onMouseDown={(e) => handleClipMouseDown(e, clip)}
                        onContextMenu={(e) => handleClipContextMenu(e, clip)}
                        className={`${styles.clipBlock} absolute top-2 bottom-2 rounded-md overflow-hidden transition-shadow border shadow-sm group/clip select-none
                          ${selectedClipId === clip.id ? 'border-status-info ring-2 ring-status-info/20 z-10' : 'border-transparent hover:border-border z-0'}
                          ${dragState?.clipId === clip.id ? 'cursor-grabbing opacity-90 shadow-xl' : 'cursor-grab'}
                          ${dragState?.clipId === clip.id && dragState.hasCollision ? 'border-status-error ring-2 ring-status-error/50' : ''}
                        `}
                        style={cssVars({
                          '--clip-left': `${clipLeft}px`,
                          '--clip-width': `${clip.duration * pixelsPerSecond}px`,
                        })}
                      >
                        <Filmstrip clip={clip} frames={frameMap.get(clip.id)?.frames} pixelsPerSecond={pixelsPerSecond} />

                        {/* 关键帧标记 */}
                        {clip.keyframes?.map(kf => (
                          <div
                            key={kf.id}
                            className={`${styles.keyframeMarker} absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 cursor-pointer z-30 ${selectedKeyframeId === kf.id ? 'scale-125' : 'hover:scale-110'}`}
                            style={cssVars({ '--keyframe-left': `${kf.time * pixelsPerSecond}px` })}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectKeyframe?.(clip.id, kf.id);
                              onSeek((resolvedWindow?.resolvedStart ?? clip.start) + kf.time);
                            }}
                            onContextMenu={(e) => handleKeyframeContextMenu(e, clip.id, kf)}
                          >
                            <svg viewBox="0 0 12 12" className="w-full h-full drop-shadow">
                              <path
                                className={selectedKeyframeId === kf.id ? styles.selectedKeyframeIcon : styles.keyframeIcon}
                                d="M6 0L12 6L6 12L0 6Z"
                                strokeWidth="1"
                              />
                            </svg>
                          </div>
                        ))}

                        {selectedClipId === clip.id && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-3 cursor-w-resize hover:bg-status-info/50 z-20 flex items-center justify-center" onMouseDown={(e) => handleResizeMouseDown(e, clip, 'start')}>
                              <div className="w-1 h-4 bg-white/80 rounded-full" />
                            </div>
                            <div className="absolute right-0 top-0 bottom-0 w-3 cursor-e-resize hover:bg-status-info/50 z-20 flex items-center justify-center" onMouseDown={(e) => handleResizeMouseDown(e, clip, 'end')}>
                              <div className="w-1 h-4 bg-white/80 rounded-full" />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()
                ))}
              </div>
            </div>
          ))}

          {/* 新建轨道区域 */}
          <div className="flex h-24 group" onDragOver={(e) => handleDragOver(e)} onDrop={(e) => handleDrop(e)}>
            <div className={`${styles.trackHeaderSpacer} sticky left-0 w-[200px] flex-shrink-0 z-20`} />
            <div className="flex-1 border-t-2 border-dashed border-border-subtle m-2 rounded flex items-center justify-center text-text-muted transition-colors group-hover:border-border">
              拖入素材创建新轨道
            </div>
          </div>
        </div>
      </div>

      {/* 播放头竖线 */}
      {playheadX > 0 && playheadPositionRef.current.lineTop > 0 && (
        <div
          className={`${styles.playheadLine} fixed bg-status-info pointer-events-none z-20`}
          style={cssVars({
            '--line-left': `${playheadX}px`,
            '--line-top': `${playheadPositionRef.current.lineTop}px`,
          })}
        />
      )}

      {/* 吸附对齐线 */}
      {snapLine && playheadPositionRef.current.lineTop > 0 && (
        <div
          className={`${styles.snapLine} ${snapLine.type === 'playhead' ? styles.snapLinePlayhead : styles.snapLineClip} fixed pointer-events-none z-30`}
          style={cssVars({
            '--line-left': `${playheadPositionRef.current.viewportX + snapLine.x - (containerRef.current?.scrollLeft || 0)}px`,
            '--line-top': `${playheadPositionRef.current.lineTop}px`,
          })}
        />
      )}

      {/* 素材拖拽预览 */}
      {draggingAsset && (
        <div
          className={`${styles.dragPreview} fixed pointer-events-none z-[9999] transform -translate-x-1/2 -translate-y-1/2`}
          style={cssVars({ '--preview-left': `${mousePos.x}px`, '--preview-top': `${mousePos.y}px` })}
        >
          <div className="bg-status-info/90 text-on-status text-xs px-3 py-2 rounded-lg shadow-xl flex items-center gap-2 whitespace-nowrap">
            {(draggingAsset.type === MediaType.VIDEO || draggingAsset.type === MediaType.IMAGE) && <Film size={14} />}
            {draggingAsset.type === MediaType.AUDIO && <Music size={14} />}
            {draggingAsset.type === MediaType.TEXT && <Type size={14} />}
            <span className="font-medium">{draggingAsset.name}</span>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className={`${styles.contextMenu} fixed z-[10000] bg-bg-surface border border-border rounded-lg shadow-2xl py-1 min-w-[160px]`}
          style={cssVars({ '--menu-left': `${contextMenu.x}px`, '--menu-top': `${contextMenu.y}px` })}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'clip' && (
            <>
              {/* 添加关键帧 */}
              {onAddKeyframe && contextMenu.clipLocalTime !== undefined && (
                <button
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated flex items-center gap-2"
                  onClick={() => {
                    onAddKeyframe(contextMenu.clipId!, contextMenu.clipLocalTime!);
                    closeContextMenu();
                  }}
                >
                  <svg viewBox="0 0 12 12" className="w-3 h-3">
                    <path d="M6 0L12 6L6 12L0 6Z" fill="currentColor" className="text-status-warning" />
                  </svg>
                  添加关键帧
                </button>
              )}

              {/* 复制片段 */}
              {onDuplicateClip && (
                <button
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated flex items-center gap-2"
                  onClick={() => {
                    onDuplicateClip(contextMenu.clipId!);
                    closeContextMenu();
                  }}
                >
                  <Copy size={12} />
                  复制片段
                </button>
              )}

              <div className="my-1 border-t border-border-subtle" />

              {/* 转场操作 */}
              {(() => {
                const clip = tracks.flatMap(t => t.clips).find(c => c.id === contextMenu.clipId);
                if (!clip) return null;

                const track = tracks.find(t => t.id === clip.trackId);
                if (!track || track.type !== 'video') return null;

                const sortedClips = getSortedTrackClips(track);
                const clipIndex = sortedClips.findIndex(c => c.id === clip.id);
                const nextClip = clipIndex >= 0 && clipIndex < sortedClips.length - 1 ? sortedClips[clipIndex + 1] : null;

                if (!nextClip) return null;

                const existingTransition = track.transitions?.find(
                  t => t.fromClipId === clip.id && t.toClipId === nextClip.id
                );
                const canAddTransition = getAddableTransitionDuration(track, clip.id, nextClip.id) > 0;

                return (
                  <>
                    {!existingTransition && canAddTransition && onAddTransition && (
                      <button
                        className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated flex items-center gap-2"
                        onClick={() => {
                          onAddTransition(track.id, clip.id, nextClip.id);
                          closeContextMenu();
                        }}
                      >
                        <Wand2 size={12} />
                        为此切点添加转场
                      </button>
                    )}
                    {existingTransition && onDeleteTransition && (
                      <button
                        className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated flex items-center gap-2"
                        onClick={() => {
                          onDeleteTransition(track.id, existingTransition.id);
                          closeContextMenu();
                        }}
                      >
                        <Eraser size={12} />
                        删除此转场
                      </button>
                    )}
                    <div className="my-1 border-t border-border-subtle" />
                  </>
                );
              })()}

              {/* 删除片段 */}
              {onDeleteClip && (
                <button
                  className="w-full px-3 py-1.5 text-left text-xs text-status-error hover:bg-status-error/12 flex items-center gap-2"
                  onClick={() => {
                    onDeleteClip(contextMenu.clipId!);
                    closeContextMenu();
                  }}
                >
                  <Trash2 size={12} />
                  删除片段
                </button>
              )}
            </>
          )}

          {contextMenu.type === 'track' && contextMenu.trackId && (() => {
            const track = tracks.find((item) => item.id === contextMenu.trackId);
            if (!track) return null;

            const isMainVideoTrack = track.id === mainTrack?.id && track.type === 'video';
            const addableCount = isMainVideoTrack ? getAddableTransitionCount(track) : 0;
            const existingCount = isMainVideoTrack ? getExistingTransitionCount(track) : 0;

            return (
              <>
                {onUpdateTrack && (
                  <button
                    className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated"
                    onClick={() => {
                      setEditingTrackId(track.id);
                      setEditingTrackName(track.name || (track.isMainTrack ? '主轨道' : track.type.toUpperCase()));
                      closeContextMenu();
                    }}
                  >
                    重命名轨道
                  </button>
                )}

                {isMainVideoTrack && (
                  <>
                    <div className="my-1 border-t border-border-subtle" />
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated disabled:text-text-tertiary disabled:hover:bg-transparent"
                      disabled={addableCount === 0}
                      onClick={() => {
                        onAddAllTransitions?.(track.id);
                        closeContextMenu();
                      }}
                    >
                      一键转场 ({addableCount})
                    </button>
                    <Popconfirm
                      title="删除所有转场"
                      description={`将删除该轨道上的 ${existingCount} 个转场，无法撤销`}
                      onConfirm={() => {
                        onDeleteAllTransitions?.(track.id);
                        closeContextMenu();
                      }}
                      okButtonProps={{ danger: true }}
                      placement="right"
                      disabled={existingCount === 0}
                    >
                      <button
                        className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated disabled:text-text-tertiary disabled:hover:bg-transparent"
                        disabled={existingCount === 0}
                      >
                        清除转场 ({existingCount})
                      </button>
                    </Popconfirm>
                  </>
                )}
              </>
            );
          })()}

          {contextMenu.type === 'keyframe' && contextMenu.keyframeId && (
            <>
              {/* 缓动类型 */}
              <div className="px-3 py-1 text-[10px] text-text-tertiary uppercase tracking-wider">缓动类型</div>
              {EASING_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-elevated"
                  onClick={() => {
                    onUpdateKeyframeEasing?.(contextMenu.clipId!, contextMenu.keyframeId!, opt.value);
                    closeContextMenu();
                  }}
                >
                  {opt.label}
                </button>
              ))}

              <div className="my-1 border-t border-border-subtle" />

              {/* 删除关键帧 */}
              {onDeleteKeyframe && (
                <button
                  className="w-full px-3 py-1.5 text-left text-xs text-status-error hover:bg-status-error/12 flex items-center gap-2"
                  onClick={() => {
                    onDeleteKeyframe(contextMenu.clipId!, contextMenu.keyframeId!);
                    closeContextMenu();
                  }}
                >
                  <Trash2 size={12} />
                  删除关键帧
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SimpleTimeline;
