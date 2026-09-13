/**
 * StagePlayer - 分镜舞台视频播放器
 * 基于 xgplayer 封装，支持 Electron 本地文件
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Player from 'xgplayer';
import 'xgplayer/dist/index.min.css';
import { electronService } from '../../services/electronService';
import { Button, Empty, Typography } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { createLogger } from '../../store/logger';
import styles from './StagePlayer.module.scss';

const logger = createLogger('StagePlayer');

const { Text } = Typography;

function prefersNativeVideoPlayback(source: string): boolean {
  return source.startsWith('koma-local://');
}

function resolveMediaSource(source?: string): string {
  if (!source) return '';
  if (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('data:') ||
    source.startsWith('blob:') ||
    source.startsWith('koma-local://')
  ) {
    return source;
  }
  return electronService.fs.toLocalUrl(source);
}

export interface StagePlayerProps {
  source?: string;
  videoPath?: string;
  videoUrl?: string;
  poster?: string;
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  autoPlay?: boolean;
  emptyDescription?: React.ReactNode;
  showStopButton?: boolean;
  stopButtonLabel?: React.ReactNode;
}

export const StagePlayer: React.FC<StagePlayerProps> = ({
  source,
  videoPath,
  videoUrl,
  poster,
  className,
  onTimeUpdate,
  onEnded,
  autoPlay = false,
  emptyDescription,
  showStopButton = false,
  stopButtonLabel = '停止',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const nativeVideoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedSrc = useMemo(
    () => resolveMediaSource(source ?? videoPath ?? videoUrl),
    [source, videoPath, videoUrl],
  );
  const resolvedPoster = useMemo(() => resolveMediaSource(poster), [poster]);
  const useNativeVideo = useMemo(() => prefersNativeVideoPlayback(resolvedSrc), [resolvedSrc]);

  useEffect(() => {
    setError(null);
  }, [resolvedSrc, resolvedPoster, useNativeVideo]);

  // 初始化播放器
  useEffect(() => {
    if (useNativeVideo || !containerRef.current || !resolvedSrc) {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      return;
    }

    // 销毁旧实例
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    try {
      playerRef.current = new Player({
        el: containerRef.current,
        url: resolvedSrc,
        poster: resolvedPoster || undefined,
        width: '100%',
        height: '100%',
        autoplay: autoPlay,
        playbackRate: [0.5, 0.75, 1, 1.25, 1.5, 2],
        pip: true,
        cssFullscreen: true,
        lang: 'zh-cn',
        controls: true,
        videoInit: true,
      });

      // 事件监听
      if (onTimeUpdate) {
        playerRef.current.on('timeupdate', () => {
          if (playerRef.current) {
            onTimeUpdate(playerRef.current.currentTime);
          }
        });
      }

      if (onEnded) {
        playerRef.current.on('ended', onEnded);
      }

      playerRef.current.on('error', (err: unknown) => {
        logger.error('播放错误', err);
        setError('视频加载失败');
      });
    } catch (err: unknown) {
      logger.error('初始化失败', err);
      setError(err instanceof Error ? err.message : '播放器初始化失败');
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [autoPlay, onEnded, onTimeUpdate, resolvedPoster, resolvedSrc, useNativeVideo]);

  const handleNativeTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    onTimeUpdate?.(event.currentTarget.currentTime);
  }, [onTimeUpdate]);

  const handleNativeEnded = useCallback(() => {
    onEnded?.();
  }, [onEnded]);

  const handleNativeError = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    logger.error('播放错误', {
      playerType: 'native-video',
      src: video.currentSrc || resolvedSrc,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : undefined,
      ended: video.ended,
      readyState: video.readyState,
      networkState: video.networkState,
      mediaError: video.error,
      errorCode: video.error?.code,
      errorMessage: video.error?.message,
    });
    setError('视频加载失败');
  }, [resolvedSrc]);

  const handleStop = useCallback(() => {
    try {
      if (useNativeVideo) {
        const video = nativeVideoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
        return;
      }

      const player = playerRef.current;
      if (!player) {
        return;
      }

      player.pause();
      player.currentTime = 0;
    } catch (err: unknown) {
      logger.warn('停止播放失败', err);
    }
  }, [useNativeVideo]);

  const hasVideo = Boolean(resolvedSrc);

  return (
    <div
      className={`${styles.root} stagePlayer ${className || ''}`}
    >
      {error ? (
        <div className={styles.error}>
          <Text type="danger">{error}</Text>
        </div>
      ) : hasVideo ? (
        <>
          {useNativeVideo ? (
            <video
              key={`${resolvedSrc}|${resolvedPoster}`}
              ref={nativeVideoRef}
              src={resolvedSrc}
              poster={resolvedPoster || undefined}
              autoPlay={autoPlay}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={handleNativeTimeUpdate}
              onEnded={handleNativeEnded}
              onError={handleNativeError}
              className={styles.nativeVideo}
            />
          ) : (
            <div
              key={`${resolvedSrc}|${resolvedPoster}`}
              ref={containerRef}
              className={styles.media}
            />
          )}
          {showStopButton ? (
            <div className={styles.stopButton}>
              <Button size="small" onClick={handleStop}>
                {stopButtonLabel}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <Empty
          image={<PlayCircleOutlined className={styles.emptyIcon} />}
          description={
            emptyDescription || <Text type="secondary">选择分镜以预览视频</Text>
          }
          className={styles.empty}
        />
      )}
    </div>
  );
};

export default StagePlayer;
