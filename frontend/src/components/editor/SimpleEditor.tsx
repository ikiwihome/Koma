/**
 * 简洁版视频编辑器
 * 迁移自 electron-egg，完整功能版
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { App } from 'antd';
import { Track, Clip, Asset, MediaType, EasingType, Keyframe } from '../../types/editor';
import { SimpleTimeline } from './SimpleTimeline';
import { SimplePlayer } from './SimplePlayer';
import { getCanvasSize } from './aspectRatio';
import type { AspectRatio } from './aspectRatio';
import { SimplePropertiesPanel } from './SimplePropertiesPanel';
import { SimpleAssetPanel } from './SimpleAssetPanel';
import { SimpleExportDialog } from './SimpleExportDialog';
import { useAssets } from './useAssets';
import { addKeyframe, updateKeyframe, removeKeyframe, getKeyframeAtTime, getAnimatedProperties } from '../../engine/simpleKeyframe';
import { findNextAvailablePosition } from '../../utils/trackCollision';
import { saveEpisodeTimeline, loadEpisodeTimeline } from '../../store/projectStore';
import { uploadFiles } from '../../services/uploadService';
import {
  getTimelineDuration,
  normalizeTimelineTracks,
  CURRENT_TIMELINE_VERSION,
} from '../../features/transition/core';
import { useTransitionHandlers } from '../../features/transition/editor';
import { useDefaultTransition } from '../../features/transition/hooks/useDefaultTransition';
import type { Shot } from '../../types';
import { getShotScriptText } from '../../types';
import { createLogger } from '../../store/logger';
import {
  getShotCurrentImageSource,
  getShotCurrentVideoSource,
  getShotCurrentAudioAsset,
  getShotCurrentAudioSource,
} from '../../utils/mediaSelectors';
import styles from './SimpleEditor.module.scss';

const logger = createLogger('SimpleEditor');

interface SimpleEditorProps {
  shots?: Shot[];
  onShotsChange?: (shots: Shot[]) => void;
  projectId?: string;
  episodeId?: string;
  aspectRatio?: '16:9' | '9:16';
}

import { generateId } from '../../utils/generateId';

// Shot 转换为 Tracks
//
// 时间线为空时由 SimpleEditor 调用，把每个 shot 的"当前选中版本"自动落到 3 条轨道：
//   video-main：getShotCurrentVideoSource → 没有则降级 image
//   audio-main：getShotCurrentAudioAsset / Source（配音 wav / mp3）
//   text-main：shot.dialogue
//
// 三条轨道时间轴对齐 currentTime（按 shot.duration 累加），保证视频 / 音频 / 字幕同步起点。
// 音频 clip 时长优先用 asset.durationMs（实际 TTS 输出长度），缺失时回退 shot.duration。
function shotsToTracks(shots: Shot[]): Track[] {
  const videoTrack: Track = { id: 'video-main', type: 'video', clips: [], order: 0, isMainTrack: true };
  const audioTrack: Track = { id: 'audio-main', type: 'audio', clips: [], order: -1 };
  const textTrack: Track = { id: 'text-main', type: 'text', clips: [], order: 1 };

  let currentTime = 0;

  for (const shot of shots) {
    const shotDuration = shot.duration || 3;
    const videoPath = getShotCurrentVideoSource(shot);
    const imagePath = getShotCurrentImageSource(shot);
    const mediaPath = videoPath || imagePath;
    const mediaType = videoPath ? MediaType.VIDEO : MediaType.IMAGE;

    if (mediaPath) {
      videoTrack.clips.push({
        id: `clip-${shot.id}`,
        assetId: `asset-${shot.id}`,
        trackId: videoTrack.id,
        start: currentTime,
        duration: shotDuration,
        offset: 0,
        sourceDuration: shotDuration, // 源素材时长
        name: getShotScriptText(shot).slice(0, 20) || `镜头 ${shot.id}`,
        type: mediaType,
        src: mediaPath,
        x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      });
    }

    // 配音：从选中的音频版本生成 audio clip。durationMs 优先（TTS 真实长度），
    // 没拿到时按 shot.duration 兜底（与视频同窗口）。clip.start 与视频对齐，
    // 后续用户可在剪辑里手动微调（移轨 / 切片 / 增减前后留白）。
    const audioAsset = getShotCurrentAudioAsset(shot);
    const audioPath = getShotCurrentAudioSource(shot);
    if (audioPath) {
      const audioDurationSec = audioAsset?.durationMs && audioAsset.durationMs > 0
        ? audioAsset.durationMs / 1000
        : shotDuration;
      audioTrack.clips.push({
        id: `audio-clip-${shot.id}`,
        assetId: `audio-asset-${shot.id}`,
        trackId: audioTrack.id,
        start: currentTime,
        duration: audioDurationSec,
        offset: 0,
        sourceDuration: audioDurationSec,
        name: `${(getShotScriptText(shot).slice(0, 16) || shot.id)} - 配音`,
        type: MediaType.AUDIO,
        src: audioPath,
        x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      });
    }

    if (shot.dialogue) {
      textTrack.clips.push({
        id: `text-${shot.id}`,
        assetId: `text-asset-${shot.id}`,
        trackId: textTrack.id,
        start: currentTime,
        duration: shotDuration,
        offset: 0,
        name: shot.dialogue.slice(0, 10),
        type: MediaType.TEXT,
        src: shot.dialogue,
        x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      });
    }

    currentTime += shotDuration;
  }

  return [videoTrack, audioTrack, textTrack].filter(t => t.clips.length > 0 || t.isMainTrack);
}

function resolveShotVisualSelection(shot: Shot): { src: string; type: MediaType; duration: number; name: string } | null {
  const shotDuration = shot.duration || 3;
  const videoPath = getShotCurrentVideoSource(shot);
  const imagePath = getShotCurrentImageSource(shot);
  const src = videoPath || imagePath;
  if (!src) return null;

  return {
    src,
    type: videoPath ? MediaType.VIDEO : MediaType.IMAGE,
    duration: shotDuration,
    name: getShotScriptText(shot).slice(0, 20) || `镜头 ${shot.id}`,
  };
}

function resolveShotAudioSelection(shot: Shot): { src: string; duration: number; name: string } | null {
  const shotDuration = shot.duration || 3;
  const audioAsset = getShotCurrentAudioAsset(shot);
  const audioPath = getShotCurrentAudioSource(shot);
  if (!audioPath) return null;

  return {
    src: audioPath,
    duration: audioAsset?.durationMs && audioAsset.durationMs > 0
      ? audioAsset.durationMs / 1000
      : shotDuration,
    name: `${(getShotScriptText(shot).slice(0, 16) || shot.id)} - 配音`,
  };
}

export function syncShotSelectionsIntoTracks(tracks: Track[], shots: Shot[]): Track[] {
  if (!tracks.length || !shots.length) return tracks;
  const shotById = new Map(shots.map(shot => [shot.id, shot]));
  let changed = false;

  const nextTracks = tracks.map(track => {
    let trackChanged = false;
    const clips = track.clips.map(clip => {
      if (clip.id.startsWith('clip-')) {
        const shotId = clip.id.slice('clip-'.length);
        const shot = shotById.get(shotId);
        const selection = shot ? resolveShotVisualSelection(shot) : null;
        if (!selection) return clip;
        if (
          clip.src === selection.src
          && clip.type === selection.type
          && clip.sourceDuration === selection.duration
        ) {
          return clip;
        }
        trackChanged = true;
        changed = true;
        return {
          ...clip,
          src: selection.src,
          type: selection.type,
          sourceDuration: selection.duration,
          name: clip.name || selection.name,
        };
      }

      if (clip.id.startsWith('audio-clip-')) {
        const shotId = clip.id.slice('audio-clip-'.length);
        const shot = shotById.get(shotId);
        const selection = shot ? resolveShotAudioSelection(shot) : null;
        if (!selection) return clip;
        if (clip.src === selection.src && clip.sourceDuration === selection.duration) {
          return clip;
        }
        trackChanged = true;
        changed = true;
        return {
          ...clip,
          src: selection.src,
          sourceDuration: selection.duration,
          name: clip.name || selection.name,
        };
      }

      return clip;
    });

    return trackChanged ? { ...track, clips } : track;
  });

  return changed ? nextTracks : tracks;
}

export const SimpleEditor: React.FC<SimpleEditorProps> = ({ shots = [], projectId, episodeId, aspectRatio: projectAspectRatio }) => {
  const { message } = App.useApp();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [draggingAsset, setDraggingAsset] = useState<Asset | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [aspectRatio] = useState<AspectRatio>(projectAspectRatio || '16:9');
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(true);
  const [hasBlockingTimelineError, setHasBlockingTimelineError] = useState(false);
  const timelineCreatedAtRef = useRef<number>(Date.now());

  const isDraggingRef = useRef(false);

  const updateTracks = useCallback((updater: (prev: Track[]) => Track[]) => {
    setTracks((prev) => {
      const updated = updater(prev);
      if (updated === prev) return prev;
      return isDraggingRef.current ? updated : normalizeTimelineTracks(updated);
    });
  }, []);

  const normalizeNow = useCallback(() => {
    setTracks((prev) => normalizeTimelineTracks(prev));
  }, []);

  const handleDragStateChange = useCallback((isDragging: boolean) => {
    isDraggingRef.current = isDragging;
    if (!isDragging) {
      normalizeNow();
    }
  }, [normalizeNow]);

  const prevTransitionCountRef = useRef<number>(0);
  const isUserDeletingRef = useRef(false);
  const { defaultDuration } = useDefaultTransition();

  const {
    handleSelectTransition,
    handleAddTransition,
    handleUpdateTransitionDuration,
    handleDeleteTransition,
    handleAddAllTransitions,
    handleDeleteAllTransitions,
  } = useTransitionHandlers({
    updateTracks,
    selectedTransitionId,
    setSelectedTransitionId,
    setSelectedClipId,
    setSelectedKeyframeId,
    message,
    isUserDeletingRef,
    defaultDuration,
  });

  useEffect(() => {
    const currentCount = tracks.reduce(
      (sum, t) => sum + (t.transitions?.length ?? 0), 0
    );
    const prevCount = prevTransitionCountRef.current;
    prevTransitionCountRef.current = currentCount;

    if (prevCount > 0 && currentCount < prevCount && !isUserDeletingRef.current) {
      const removed = prevCount - currentCount;
      message.warning(`已自动清理 ${removed} 条失效转场`);
    }
    isUserDeletingRef.current = false;
  }, [tracks, message]);

  // 素材库
  const { assets: assetItems, addUploadedAsset } = useAssets({
    projectId: projectId || '',
    episodeId: episodeId || '',
  });

  // 处理文件上传
  const handleUpload = useCallback(async (files: File[]) => {
    if (!projectId) {
      message.warning('请先创建项目');
      return;
    }

    message.loading({ content: `正在上传 ${files.length} 个文件...`, key: 'upload' });

    try {
      const results = await uploadFiles(files, projectId, episodeId, (current, total) => {
        message.loading({ content: `上传中 ${current}/${total}...`, key: 'upload' });
      });

      let successCount = 0;
      let failCount = 0;

      for (const result of results) {
        if (result.success && result.asset) {
          addUploadedAsset(result.asset);
          successCount++;
        } else {
          failCount++;
          logger.warn('上传失败', result.error);
        }
      }

      if (successCount > 0 && failCount === 0) {
        message.success({ content: `成功上传 ${successCount} 个文件`, key: 'upload' });
      } else if (successCount > 0 && failCount > 0) {
        message.warning({ content: `上传完成：${successCount} 成功，${failCount} 失败`, key: 'upload' });
      } else {
        message.error({ content: '上传失败', key: 'upload' });
      }
    } catch (err) {
      logger.error('上传出错', err);
      message.error({ content: '上传出错', key: 'upload' });
    }
  }, [projectId, episodeId, addUploadedAsset]);

  // 获取选中的 Clip
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const track of tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId);
      if (clip) return clip;
    }
    return null;
  }, [tracks, selectedClipId]);

  // 计算总时长（基于实际内容）
  const duration = useMemo(() => {
    const hasClips = tracks.some((track) => track.clips.length > 0);
    return hasClips ? getTimelineDuration(tracks) : 1;
  }, [tracks]);

  const shotSelectionSignature = useMemo(
    () => shots.map(shot => [
      shot.id,
      shot.currentVersion ?? '',
      getShotCurrentVideoSource(shot) ?? '',
      getShotCurrentImageSource(shot) ?? '',
      getShotCurrentAudioSource(shot) ?? '',
      shot.duration ?? '',
    ].join('\u001f')).join('\u001e'),
    [shots],
  );

  // 加载已保存的时间线
  useEffect(() => {
    const loadTimeline = async () => {
      if (!projectId || !episodeId) {
        // 没有 projectId 或 episodeId，使用 shots 初始化
        if (shots.length > 0) {
          setTracks(normalizeTimelineTracks(shotsToTracks(shots)));
        }
        setIsLoadingTimeline(false);
        return;
      }

      setIsLoadingTimeline(true);
      setHasBlockingTimelineError(false);
      try {
        const savedData = await loadEpisodeTimeline(projectId, episodeId);
        const savedTracks = savedData?.tracks || [];
        // "时间线非空" = 至少存在一个 clip。仅有空 track 骨架（用户全删了）也视为空，
        // 让"从分镜入剪辑→已选版本自动落轨"在重进时仍然生效。
        const savedHasClips = savedTracks.some((t) => Array.isArray(t.clips) && t.clips.length > 0);
        if (savedHasClips) {
          setTracks(normalizeTimelineTracks(syncShotSelectionsIntoTracks(savedTracks, shots)));
          timelineCreatedAtRef.current = savedData!.createdAt || Date.now();
        } else if (shots.length > 0) {
          // 没保存过 OR 保存过但已被清空 → 从 shots 选中版本初始化（视频 / 音频 / 字幕全落轨）
          setTracks(normalizeTimelineTracks(shotsToTracks(shots)));
          timelineCreatedAtRef.current = savedData?.createdAt || Date.now();
        }
      } catch (err) {
        logger.error('加载时间线失败', err);
        if (err instanceof Error && err.message.startsWith('Unsupported timeline version:')) {
          setHasBlockingTimelineError(true);
          message.error({
            content: '当前时间线版本过高，无法安全加载。已阻止回退初始化和自动保存，请先完成兼容迁移。',
            key: 'timeline-version-incompatible',
            duration: 6,
          });
          return;
        }
        if (shots.length > 0) {
          setTracks(normalizeTimelineTracks(shotsToTracks(shots)));
        }
      } finally {
        setIsLoadingTimeline(false);
      }
    };

    loadTimeline();
  }, [projectId, episodeId, shots, shotSelectionSignature]); // 分镜当前版本变更时同步自动生成的 clip 源

  // 自动保存（防抖 1 秒）
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 跳过首次渲染和加载中状态
    if (isFirstRender.current || isLoadingTimeline || hasBlockingTimelineError) {
      isFirstRender.current = false;
      return;
    }

    // 没有 projectId 或 episodeId 时不保存
    if (!projectId || !episodeId) return;

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 设置防抖保存
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveEpisodeTimeline(projectId, episodeId, {
          version: CURRENT_TIMELINE_VERSION,
          tracks,
          createdAt: timelineCreatedAtRef.current,
        });
      } catch (err) {
        logger.error('自动保存失败', err);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tracks, projectId, episodeId, isLoadingTimeline, hasBlockingTimelineError]);

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const handleSeek = useCallback((time: number) => {
    // 限制 seek 不超过内容时长
    setCurrentTime(Math.min(Math.max(0, time), duration));
  }, [duration]);

  const handleTimeUpdate = useCallback((time: number) => {
    // 播放到末尾时停止
    if (time >= duration) {
      setCurrentTime(duration);
      setIsPlaying(false);
    } else {
      setCurrentTime(time);
    }
  }, [duration]);

  const handleSelectClip = useCallback((id: string | null) => {
    setSelectedClipId(id);
    setSelectedTransitionId(null);
    setSelectedKeyframeId(null);
  }, []);

  const handleUpdateClip = useCallback((clipId: string, updates: Partial<Clip>) => {
    updateTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip =>
        clip.id === clipId ? { ...clip, ...updates } : clip
      )
    })));
  }, [updateTracks]);

  const handleMoveClip = useCallback((clipId: string, newStart: number, newTrackId: string) => {
    updateTracks(prev => {
      const currentTrack = prev.find(t => t.clips.some(c => c.id === clipId));
      const currentClip = currentTrack?.clips.find(c => c.id === clipId);
      if (currentClip && currentClip.start === newStart && currentTrack?.id === newTrackId) {
        return prev;
      }

      let movedClip: Clip | null = null;
      const tracksWithoutClip = prev.map(track => {
        const clipIndex = track.clips.findIndex(c => c.id === clipId);
        if (clipIndex >= 0) {
          movedClip = { ...track.clips[clipIndex], start: newStart, trackId: newTrackId };
          const isLeavingTrack = track.id !== newTrackId;
          return {
            ...track,
            clips: track.clips.filter(c => c.id !== clipId),
            transitions: isLeavingTrack
              ? (track.transitions ?? []).filter(
                  t => t.fromClipId !== clipId && t.toClipId !== clipId
                )
              : track.transitions,
          };
        }
        return track;
      });

      if (!movedClip) return prev;

      return tracksWithoutClip.map(track =>
        track.id === newTrackId
          ? { ...track, clips: [...track.clips, movedClip!] }
          : track
      );
    });
  }, [updateTracks]);

  const handleUpdateTrack = useCallback((trackId: string, updates: Partial<Track>) => {
    updateTracks(prev => prev.map(track =>
      track.id === trackId ? { ...track, ...updates } : track
    ));
  }, [updateTracks]);

  const handleAssetDrop = useCallback((asset: Asset, time: number, trackId?: string) => {
    updateTracks(prev => {
      // 找到目标轨道
      let targetTrack = trackId ? prev.find(t => t.id === trackId) : null;
      const trackType = asset.type === MediaType.AUDIO ? 'audio' : asset.type === MediaType.TEXT ? 'text' : 'video';

      // 使用碰撞检测找到安全的起始位置
      const existingClips = targetTrack?.clips || [];
      const safeStart = findNextAvailablePosition(existingClips, asset.duration, Math.max(0, time));

      const newClip: Clip = {
        id: generateId(),
        assetId: asset.id,
        trackId: trackId || '',
        start: safeStart,
        duration: asset.duration,
        offset: 0,
        sourceDuration: asset.duration,
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        name: asset.name,
        type: asset.type,
        src: asset.src,
        x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      };

      if (trackId && targetTrack) {
        return prev.map(track =>
          track.id === trackId
            ? { ...track, clips: [...track.clips, { ...newClip, trackId }] }
            : track
        );
      }

      // 创建新轨道
      const newTrackId = generateId();
      const newTrack: Track = {
        id: newTrackId,
        type: trackType,
        clips: [{ ...newClip, trackId: newTrackId }],
        order: prev.length,
      };
      return [...prev, newTrack];
    });

    message.success(`已添加: ${asset.name}`);
  }, [message, updateTracks]);

  const handleDeleteClip = useCallback((clipId?: string) => {
    const targetId = clipId || selectedClipId;
    if (!targetId) return;

    isUserDeletingRef.current = true;
    updateTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.filter(c => c.id !== targetId),
      transitions: (track.transitions ?? []).filter(
        t => t.fromClipId !== targetId && t.toClipId !== targetId
      ),
    })));
    if (selectedClipId === targetId) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, updateTracks]);

  const handleDeleteTrack = useCallback((trackId: string) => {
    updateTracks(prev => prev.filter(t => t.id !== trackId));
  }, [updateTracks]);

  // 添加关键帧
  const handleAddKeyframe = useCallback((clipId: string, clipLocalTime: number) => {
    updateTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.id !== clipId) return clip;
        return addKeyframe(clip, clipLocalTime, undefined, EasingType.EASE_IN_OUT);
      })
    })));
    message.success('已添加关键帧');
  }, [message, updateTracks]);

  // 更新关键帧
  const handleUpdateKeyframe = useCallback((clipId: string, keyframeId: string, updates: Partial<Keyframe>) => {
    updateTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.id !== clipId) return clip;
        return updateKeyframe(clip, keyframeId, updates);
      })
    })));
  }, [updateTracks]);

  // 选择关键帧
  const handleSelectKeyframe = useCallback((_clipId: string, keyframeId: string | null) => {
    setSelectedKeyframeId(keyframeId);
  }, []);

  // 删除关键帧
  const handleDeleteKeyframe = useCallback((clipId: string, keyframeId: string) => {
    updateTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.id !== clipId) return clip;
        return removeKeyframe(clip, keyframeId);
      })
    })));
    if (selectedKeyframeId === keyframeId) {
      setSelectedKeyframeId(null);
    }
  }, [selectedKeyframeId, updateTracks]);

  // 复制片段
  const handleDuplicateClip = useCallback((clipId: string) => {
    updateTracks(prev => prev.map(track => {
      const clipIndex = track.clips.findIndex(c => c.id === clipId);
      if (clipIndex < 0) return track;

      const clip = track.clips[clipIndex];
      const newClip: Clip = {
        ...clip,
        id: generateId(),
        start: clip.start + clip.duration,
        keyframes: clip.keyframes ? clip.keyframes.map(kf => ({ ...kf, id: generateId() })) : undefined,
      };

      return { ...track, clips: [...track.clips, newClip] };
    }));
    message.success('已复制片段');
  }, [message, updateTracks]);

  // 更新关键帧缓动
  const handleUpdateKeyframeEasing = useCallback((clipId: string, keyframeId: string, easing: EasingType) => {
    handleUpdateKeyframe(clipId, keyframeId, { easing });
  }, [handleUpdateKeyframe]);

  // 自动打帧（画布变换时调用）
  const handleAutoKeyframe = useCallback((clipId: string, clipLocalTime: number, updates: Partial<Clip>) => {
    updateTracks(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.id !== clipId) return clip;

        // 检查当前时间是否已有关键帧
        const existingKf = getKeyframeAtTime(clip, clipLocalTime, 0.01);
        if (existingKf) {
          // 更新已有关键帧
          return updateKeyframe(clip, existingKf.id, updates);
        } else {
          // 创建新关键帧，使用当前插值属性作为基础
          const currentProps = getAnimatedProperties(clip, clipLocalTime);
          return addKeyframe(clip, clipLocalTime, { ...currentProps, ...updates });
        }
      })
    })));
  }, [updateTracks]);

  return (
    <div className={styles.container}>
      {/* 上半部分：素材面板 + 播放器 + 属性面板 */}
      <div className={styles.upper}>
        {/* 素材面板 */}
        <div className={styles.assetPanel}>
          <SimpleAssetPanel
            assets={assetItems}
            onDragStart={setDraggingAsset}
            onDragEnd={() => setDraggingAsset(null)}
            onUpload={handleUpload}
          />
        </div>
        <SimplePlayer
          tracks={tracks}
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          selectedClipId={selectedClipId}
          onTimeUpdate={handleTimeUpdate}
          onUpdateClip={handleUpdateClip}
          onAutoKeyframe={handleAutoKeyframe}
          aspectRatio={aspectRatio}
        />
        <SimplePropertiesPanel
          selectedClip={selectedClip}
          selectedKeyframeId={selectedKeyframeId}
          currentTime={currentTime}
          onUpdateClip={handleUpdateClip}
          onDeleteClip={() => handleDeleteClip()}
          onAddKeyframe={handleAddKeyframe}
          onUpdateKeyframe={handleUpdateKeyframe}
        />
      </div>

      {/* 下半部分：时间线 */}
      <div className={styles.lower}>
        <SimpleTimeline
          tracks={tracks}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          selectedClipId={selectedClipId}
          onSelectClip={handleSelectClip}
          onUpdateClip={handleUpdateClip}
          onMoveClip={handleMoveClip}
          onAssetDrop={handleAssetDrop}
          onDeleteClip={handleDeleteClip}
          onAddKeyframe={handleAddKeyframe}
          onSelectKeyframe={handleSelectKeyframe}
          onDeleteKeyframe={handleDeleteKeyframe}
          onDuplicateClip={handleDuplicateClip}
          onUpdateKeyframeEasing={handleUpdateKeyframeEasing}
          selectedKeyframeId={selectedKeyframeId}
          isPlaying={isPlaying}
          togglePlay={togglePlay}
          onDeleteTrack={handleDeleteTrack}
          onUpdateTrack={handleUpdateTrack}
          selectedTransitionId={selectedTransitionId}
          onSelectTransition={handleSelectTransition}
          onAddTransition={handleAddTransition}
          onUpdateTransitionDuration={handleUpdateTransitionDuration}
          onDeleteTransition={handleDeleteTransition}
          onDragStateChange={handleDragStateChange}
          onAddAllTransitions={handleAddAllTransitions}
          onDeleteAllTransitions={handleDeleteAllTransitions}
          draggingAsset={draggingAsset}
          onExport={() => setExportDialogOpen(true)}
          onTransitionError={(errorMessage) => message.warning(errorMessage)}
        />
      </div>

      {/* 导出对话框 */}
      <SimpleExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        tracks={tracks}
        duration={duration}
        canvasSize={getCanvasSize(aspectRatio)}
      />
    </div>
  );
};

export default SimpleEditor;
