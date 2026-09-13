/**
 * 视频帧提取 Hook
 * 使用 ffmpegManager 异步提取视频帧用于时间线预览
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ffmpegManager } from '../../services/ffmpegManager';
import { toKomaLocalUrl } from '../../utils/urlUtils';
import { createLogger } from '../../store/logger';

const logger = createLogger('useVideoFrames');

interface FrameCache {
  frames: string[];
  loading: boolean;
  error: string | null;
}

interface UseVideoFramesOptions {
  maxConcurrent?: number;  // 最大并发提取数
  fps?: number;            // 帧率
  frameWidth?: number;     // 帧宽度
}

// 全局帧缓存
const globalFrameCache = new Map<string, FrameCache>();
// 正在提取的任务
const pendingTasks = new Map<string, Promise<string[]>>();

/**
 * 提取视频帧
 */
async function extractVideoFrames(
  videoPath: string,
  resourceId: string,
  fps: number = 1,
  width: number = 320
): Promise<string[]> {
  // 检查缓存
  const cacheKey = `${videoPath}:${fps}:${width}`;
  const cached = globalFrameCache.get(cacheKey);
  if (cached && cached.frames.length > 0) {
    return cached.frames;
  }

  // 检查是否已在提取中
  const pending = pendingTasks.get(cacheKey);
  if (pending) {
    return pending;
  }

  // 开始提取
  logger.info('[extractVideoFrames] start', { videoPath, resourceId, fps, width });
  const task = (async () => {
    try {
      await ffmpegManager.init();

      // 检查 ffmpeg 是否可用
      const available = await ffmpegManager.isAvailable();
      if (!available) {
        logger.warn('[extractVideoFrames] FFmpeg 不可用，跳过帧提取', { videoPath, resourceId });
        return [];
      }

      const frames = await ffmpegManager.getFrames(videoPath, resourceId);
      // Some ffmpeg adapters may return `undefined` on failure instead of throwing.
      // Keep the hook resilient and avoid crashing on `.map`.
      const safeFrames = Array.isArray(frames) ? frames : [];

      // 将帧路径转换为可用的 URL
      const frameUrls = safeFrames.map(f => toKomaLocalUrl(f));

      logger.info('[extractVideoFrames] done', {
        videoPath,
        resourceId,
        rawCount: safeFrames.length,
        urlCount: frameUrls.length,
        firstRaw: safeFrames[0],
        firstUrl: frameUrls[0],
      });

      globalFrameCache.set(cacheKey, {
        frames: frameUrls,
        loading: false,
        error: null
      });

      return frameUrls;
    } catch (err) {
      logger.error('[extractVideoFrames] 帧提取失败', { videoPath, resourceId, err });
      globalFrameCache.set(cacheKey, {
        frames: [],
        loading: false,
        error: err instanceof Error ? err.message : '提取失败'
      });
      return [];
    } finally {
      pendingTasks.delete(cacheKey);
    }
  })();

  pendingTasks.set(cacheKey, task);
  return task;
}

/**
 * 获取单个视频的帧
 */
export function useVideoFrames(
  videoPath: string | null,
  resourceId: string,
  options: UseVideoFramesOptions = {}
): { frames: string[]; loading: boolean; error: string | null } {
  const { fps = 1, frameWidth = 320 } = options;

  const [state, setState] = useState<FrameCache>({
    frames: [],
    loading: false,
    error: null
  });

  useEffect(() => {
    if (!videoPath) {
      setState({ frames: [], loading: false, error: null });
      return;
    }

    const cacheKey = `${videoPath}:${fps}:${frameWidth}`;
    const cached = globalFrameCache.get(cacheKey);

    if (cached && cached.frames.length > 0) {
      setState(cached);
      return;
    }

    setState({ frames: [], loading: true, error: null });

    extractVideoFrames(videoPath, resourceId, fps, frameWidth)
      .then(frames => {
        setState({ frames, loading: false, error: null });
      })
      .catch(err => {
        setState({
          frames: [],
          loading: false,
          error: err instanceof Error ? err.message : '提取失败'
        });
      });
  }, [videoPath, resourceId, fps, frameWidth]);

  return state;
}

/**
 * 批量管理视频帧的 Hook
 * 用于时间线组件批量预加载帧
 *
 * 重构要点（修"第一次没图，第二次才显示"的 bug）：
 * - 用 ref 持有最新 clips / fps / frameWidth，避免 useCallback 因 clips 引用变化反复重建
 * - processQueue 是稳定引用（useCallback deps 只 maxConcurrent）→ useEffect 不会因 callback 重建反复触发
 * - useEffect 内对每个新 clip：缓存命中立即 set；否则入队 + setLoading + 触发 processQueue
 * - 已经在缓存里的（即使空帧/错误）也会立即同步到 frameMap
 */
export function useVideoFramesBatch(
  clips: Array<{ id: string; src: string; type: string }>,
  options: UseVideoFramesOptions = {}
): Map<string, FrameCache> {
  const { fps = 1, frameWidth = 320, maxConcurrent = 3 } = options;

  const [frameMap, setFrameMap] = useState<Map<string, FrameCache>>(new Map());
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef<Set<string>>(new Set());
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const frameWidthRef = useRef(frameWidth);
  frameWidthRef.current = frameWidth;

  // 处理队列（用 ref 拿最新 clips/fps/frameWidth，引用稳定避免 useEffect 抖动）
  const processQueue = useCallback(async () => {
    while (queueRef.current.length > 0 && processingRef.current.size < maxConcurrent) {
      const clipId = queueRef.current.shift();
      if (!clipId) break;

      const clip = clipsRef.current.find(c => c.id === clipId);
      if (!clip || clip.type !== 'video') {
        logger.debug('[batch] skip clip (not video or gone)', { clipId, clipType: clip?.type });
        continue;
      }

      processingRef.current.add(clipId);
      logger.info('[batch] dequeue & process', {
        clipId,
        src: clip.src,
        processing: processingRef.current.size,
        queueRemaining: queueRef.current.length,
      });

      try {
        const frames = await extractVideoFrames(clip.src, clipId, fpsRef.current, frameWidthRef.current);
        logger.info('[batch] frames extracted', { clipId, count: frames.length, first: frames[0] });
        setFrameMap(prev => {
          const next = new Map(prev);
          next.set(clipId, { frames, loading: false, error: null });
          return next;
        });
      } catch (err) {
        logger.error('[batch] extract failed', { clipId, err });
        setFrameMap(prev => {
          const next = new Map(prev);
          next.set(clipId, {
            frames: [],
            loading: false,
            error: err instanceof Error ? err.message : '提取失败'
          });
          return next;
        });
      } finally {
        processingRef.current.delete(clipId);
        // 继续处理队列（next tick，避免同步递归撑爆栈）
        Promise.resolve().then(() => processQueue());
      }
    }
  }, [maxConcurrent]);

  // 当 clips 变化时，更新队列；deps 不含 processQueue 因为它是稳定引用
  useEffect(() => {
    const videoClips = clips.filter(c => c.type === 'video');
    logger.info('[batch] clips changed', {
      total: clips.length,
      video: videoClips.length,
      ids: videoClips.map(c => c.id),
    });
    let queuedAny = false;

    for (const clip of videoClips) {
      const cacheKey = `${clip.src}:${fps}:${frameWidth}`;
      const cached = globalFrameCache.get(cacheKey);

      if (cached) {
        // 缓存里已有结果（无论是否为空）—— 直接 set 到 frameMap
        // 之前的实现只在 frames.length > 0 时同步，导致空帧/失败的 cached 永远显示 loading
        logger.info('[batch] cache hit', {
          clipId: clip.id,
          frames: cached.frames.length,
          loading: cached.loading,
          error: cached.error,
        });
        setFrameMap(prev => {
          if (prev.get(clip.id) === cached) return prev;
          const next = new Map(prev);
          next.set(clip.id, cached);
          return next;
        });
      } else if (!processingRef.current.has(clip.id) && !queueRef.current.includes(clip.id)) {
        queueRef.current.push(clip.id);
        queuedAny = true;
        logger.info('[batch] enqueue', { clipId: clip.id, src: clip.src });
        setFrameMap(prev => {
          const cur = prev.get(clip.id);
          if (cur && cur.loading) return prev;
          const next = new Map(prev);
          next.set(clip.id, { frames: [], loading: true, error: null });
          return next;
        });
      } else {
        logger.debug('[batch] already processing/queued', { clipId: clip.id });
      }
    }

    if (queuedAny || queueRef.current.length > 0) {
      processQueue();
    }
  }, [clips, fps, frameWidth, processQueue]);

  return frameMap;
}

/**
 * 清除帧缓存
 */
export function clearFrameCache(videoPath?: string): void {
  if (videoPath) {
    for (const key of globalFrameCache.keys()) {
      if (key.startsWith(videoPath)) {
        globalFrameCache.delete(key);
      }
    }
  } else {
    globalFrameCache.clear();
  }
}

export default useVideoFrames;
