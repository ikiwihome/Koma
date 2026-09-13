/**
 * SimpleEditor 导出渲染服务
 * 将 SimpleEditor 时间线渲染为视频文件
 */
import type { Track, Clip } from '../types/editor';
import { getAnimatedProperties } from '../engine/simpleKeyframe';
import {
  getClipOpacityFromPlans,
  normalizeTimelineTracks,
  type NormalizedTransitionPlan,
  type ResolvedClipWindow,
  resolveTimelineTracks,
} from '../features/transition/core';
import { toKomaLocalUrl, fromKomaLocalUrl } from '../utils/urlUtils';

export interface SimpleExportConfig {
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'webm' | 'gif';
  quality: 'low' | 'medium' | 'high' | 'custom';
  videoBitrate?: number;
  audioBitrate?: number;
  outputPath: string;
}

export interface SimpleExportProgress {
  stage: 'preparing' | 'rendering' | 'encoding' | 'audio' | 'finalizing' | 'done' | 'error';
  progress: number;
  currentFrame: number;
  totalFrames: number;
  estimatedTimeRemaining?: number;
  message?: string;
}

export type SimpleExportProgressCallback = (progress: SimpleExportProgress) => void;

// 质量预设
const QUALITY_PRESETS: Record<string, { videoBitrate: number; audioBitrate: number }> = {
  low: { videoBitrate: 2000, audioBitrate: 128 },
  medium: { videoBitrate: 5000, audioBitrate: 192 },
  high: { videoBitrate: 10000, audioBitrate: 320 },
};

// FFmpeg API 接口
const getFFmpegAPI = (): any => {
  if (typeof window !== 'undefined' && window.electronAPI?.ffmpeg) {
    return window.electronAPI.ffmpeg;
  }
  return null;
};

/**
 * SimpleEditor 导出渲染器
 */
export class SimpleExportRenderer {
  private config: SimpleExportConfig;
  private tracks: Track[] = [];
  private resolvedWindows: Map<string, ResolvedClipWindow> = new Map();
  private transitionPlansByTrack: Map<string, NormalizedTransitionPlan[]> = new Map();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mediaCache: Map<string, HTMLVideoElement | HTMLImageElement> = new Map();
  private aborted = false;
  private progressCallback: SimpleExportProgressCallback | null = null;
  private duration: number = 0;

  constructor(config: SimpleExportConfig) {
    this.config = config;
    this.canvas = document.createElement('canvas');
    this.canvas.width = config.width;
    this.canvas.height = config.height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  onProgress(callback: SimpleExportProgressCallback) {
    this.progressCallback = callback;
  }

  async export(tracks: Track[], duration: number): Promise<string> {
    this.tracks = normalizeTimelineTracks(tracks);
    const resolvedTracks = resolveTimelineTracks(this.tracks);
    this.resolvedWindows = new Map(
      resolvedTracks.flatMap((track) =>
        track.clipWindows.map((window) => [window.clipId, window] as const)
      )
    );
    this.transitionPlansByTrack = new Map(
      resolvedTracks.map((resolved) => [resolved.track.id, resolved.transitionPlans])
    );
    this.duration = duration;
    this.aborted = false;

    const totalFrames = this.getTotalFrames();
    const ffmpegAPI = getFFmpegAPI();

    try {
      // 阶段1: 准备
      this.emitProgress({
        stage: 'preparing',
        progress: 0,
        currentFrame: 0,
        totalFrames,
        message: '正在预加载媒体资源...',
      });

      await this.preloadMedia();

      // 阶段2: 渲染帧到临时目录
      this.emitProgress({
        stage: 'rendering',
        progress: 0,
        currentFrame: 0,
        totalFrames,
        message: '正在渲染帧...',
      });

      const tempDir = ffmpegAPI ? await ffmpegAPI.getTempDir() : '/tmp/export';
      await this.renderAllFrames(tempDir);

      // 阶段3: FFmpeg 编码
      this.emitProgress({
        stage: 'encoding',
        progress: 60,
        currentFrame: totalFrames,
        totalFrames,
        message: '正在编码视频...',
      });

      // 收集音频信息
      const audioClips = this.collectAudioClips();

      // 调用 FFmpeg 合成
      if (ffmpegAPI) {
        const quality = this.config.quality === 'custom'
          ? { videoBitrate: this.config.videoBitrate || 5000, audioBitrate: this.config.audioBitrate || 192 }
          : QUALITY_PRESETS[this.config.quality];

        await ffmpegAPI.composeVideo({
          frameDir: tempDir,
          framePattern: 'frame_%05d.png',
          fps: this.config.fps,
          width: this.config.width,
          height: this.config.height,
          format: this.config.format,
          videoBitrate: quality.videoBitrate,
          audioBitrate: quality.audioBitrate,
          audioTracks: audioClips,
          outputPath: this.config.outputPath,
        });

        // 清理临时文件
        await ffmpegAPI.cleanupTemp(tempDir);
      }

      // 完成
      this.emitProgress({
        stage: 'done',
        progress: 100,
        currentFrame: totalFrames,
        totalFrames,
        message: '导出完成！',
      });

      return this.config.outputPath;
    } catch (err) {
      this.emitProgress({
        stage: 'error',
        progress: 0,
        currentFrame: 0,
        totalFrames,
        message: (err as Error).message,
      });
      throw err;
    }
  }

  abort() {
    this.aborted = true;
    const ffmpegAPI = getFFmpegAPI();
    if (ffmpegAPI) {
      ffmpegAPI.cancelTask?.();
    }
  }

  private async preloadMedia() {
    const loadPromises: Promise<void>[] = [];

    for (const track of this.tracks) {
      for (const clip of track.clips) {
        if (this.aborted) throw new Error('Export aborted');

        if (clip.type === 'VIDEO' || clip.type === 'IMAGE') {
          if (!this.mediaCache.has(clip.id)) {
            const promise = clip.type === 'VIDEO'
              ? this.loadVideo(clip.src).then(v => { this.mediaCache.set(clip.id, v); })
              : this.loadImage(clip.src).then(i => { this.mediaCache.set(clip.id, i); });
            loadPromises.push(promise);
          }
        }
      }
    }

    await Promise.all(loadPromises);
  }

  private loadVideo(src: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'auto';

      video.onloadeddata = () => resolve(video);
      video.onerror = () => reject(new Error(`Failed to load video: ${src}`));

      video.src = toKomaLocalUrl(src);
    });
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`));

      image.src = toKomaLocalUrl(src);
    });
  }

  private async renderAllFrames(tempDir: string): Promise<string[]> {
    const totalFrames = this.getTotalFrames();
    const frameFiles: string[] = [];
    const startTime = Date.now();
    const ffmpegAPI = getFFmpegAPI();

    // 确保临时目录存在
    if (ffmpegAPI) {
      await ffmpegAPI.ensureDir(tempDir);
    }

    for (let frame = 0; frame < totalFrames; frame++) {
      if (this.aborted) throw new Error('Export aborted');

      const time = frame / this.config.fps;
      await this.renderFrame(time);

      // 导出帧到文件
      const framePath = `${tempDir}/frame_${String(frame).padStart(5, '0')}.png`;

      if (ffmpegAPI) {
        const dataUrl = this.canvas.toDataURL('image/png');
        await ffmpegAPI.saveFrame(framePath, dataUrl);
      }

      frameFiles.push(framePath);

      // 更新进度
      const elapsed = (Date.now() - startTime) / 1000;
      const framesPerSecond = (frame + 1) / elapsed;
      const remaining = (totalFrames - frame - 1) / framesPerSecond;

      this.emitProgress({
        stage: 'rendering',
        progress: ((frame + 1) / totalFrames) * 60,
        currentFrame: frame + 1,
        totalFrames,
        estimatedTimeRemaining: remaining,
        message: `渲染帧 ${frame + 1}/${totalFrames}`,
      });
    }

    return frameFiles;
  }

  private async renderFrame(time: number) {
    const ctx = this.ctx;
    const canvas = this.canvas;

    // 清空画布
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 获取当前时间可见的片段，按 track order 排序
    const visibleClips = this.getVisibleClips(time);

    for (const { clip, order: _order } of visibleClips) {
      await this.renderClip(clip, time);
    }
  }

  private getVisibleClips(time: number): { clip: Clip; order: number }[] {
    const visible: { clip: Clip; order: number }[] = [];

    for (const track of this.tracks) {
      if (track.hidden) {
        continue;
      }

      for (const clip of track.clips) {
        if (clip.type !== 'VIDEO' && clip.type !== 'IMAGE' && clip.type !== 'TEXT') {
          continue;
        }

        const resolvedWindow = this.resolvedWindows.get(clip.id);
        const clipStart = resolvedWindow?.resolvedStart ?? clip.start;
        const clipEnd = resolvedWindow?.resolvedEnd ?? (clip.start + clip.duration);
        if (time >= clipStart && time < clipEnd) {
          visible.push({ clip, order: track.order ?? 0 });
        }
      }
    }

    return visible.sort((a, b) => a.order - b.order);
  }

  private async renderClip(clip: Clip, currentTime: number) {
    const ctx = this.ctx;
    const canvas = this.canvas;

    ctx.save();

    const resolvedWindow = this.resolvedWindows.get(clip.id);
    const clipStart = resolvedWindow?.resolvedStart ?? clip.start;
    const clipLocalTime = currentTime - clipStart;
    const props = getAnimatedProperties(clip, clipLocalTime);

    const centerX = canvas.width / 2 + props.x;
    const centerY = canvas.height / 2 + props.y;
    ctx.translate(centerX, centerY);
    ctx.rotate((props.rotation * Math.PI) / 180);
    ctx.scale(props.scale, props.scale);
    const transitionOpacity = getClipOpacityFromPlans(
      this.transitionPlansByTrack.get(clip.trackId) ?? [],
      clip.id,
      currentTime,
    );
    ctx.globalAlpha = props.opacity * transitionOpacity;

    if (clip.type === 'TEXT') {
      this.renderText(clip, {
        ...props,
        opacity: props.opacity * transitionOpacity,
      });
    } else {
      const media = this.mediaCache.get(clip.id);
      if (media) {
        if (clip.type === 'VIDEO') {
          const video = media as HTMLVideoElement;
          const videoTime = clipLocalTime + clip.offset;
          video.currentTime = videoTime;
          // 等待视频帧准备好
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        const sourceWidth = media.width || (media as HTMLVideoElement).videoWidth || canvas.width;
        const sourceHeight = media.height || (media as HTMLVideoElement).videoHeight || canvas.height;
        const aspectRatio = sourceWidth / sourceHeight;
        const canvasRatio = canvas.width / canvas.height;

        let drawWidth: number, drawHeight: number;
        if (aspectRatio > canvasRatio) {
          drawWidth = canvas.width;
          drawHeight = canvas.width / aspectRatio;
        } else {
          drawHeight = canvas.height;
          drawWidth = canvas.height * aspectRatio;
        }

        ctx.drawImage(media, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      }
    }

    ctx.restore();
  }

  private renderText(clip: Clip, props: { x: number; y: number; scale: number; rotation: number; opacity: number }) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const text = clip.text || clip.src || '';
    if (!text) return;

    // 重置变换，字幕使用绝对定位
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = props.opacity;

    const fontSize = clip.fontSize || 48;
    const fontFamily = clip.fontFamily || 'Arial, sans-serif';
    const fontColor = clip.fontColor || '#FFFFFF';
    const backgroundColor = clip.backgroundColor;
    const textPosition = clip.textPosition || 'bottom';
    const textAlign = clip.textAlign || 'center';

    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textAlign = textAlign as CanvasTextAlign;
    ctx.textBaseline = 'middle';

    const lines = text.split('\n');
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;

    let baseY: number;
    switch (textPosition) {
      case 'top':
        baseY = totalHeight / 2 + 50;
        break;
      case 'center':
        baseY = canvas.height / 2;
        break;
      case 'bottom':
      default:
        baseY = canvas.height - totalHeight / 2 - 50;
        break;
    }

    let baseX: number;
    switch (textAlign) {
      case 'left':
        baseX = 50 + props.x;
        break;
      case 'right':
        baseX = canvas.width - 50 + props.x;
        break;
      case 'center':
      default:
        baseX = canvas.width / 2 + props.x;
        break;
    }

    baseY += props.y;

    lines.forEach((line, i) => {
      const lineY = baseY + (i - (lines.length - 1) / 2) * lineHeight;

      if (backgroundColor) {
        const metrics = ctx.measureText(line);
        const padding = 10;
        const bgWidth = metrics.width + padding * 2;
        const bgHeight = lineHeight;

        let bgX = baseX - bgWidth / 2;
        if (textAlign === 'left') bgX = baseX - padding;
        if (textAlign === 'right') bgX = baseX - bgWidth + padding;

        ctx.fillStyle = backgroundColor;
        ctx.fillRect(bgX, lineY - bgHeight / 2, bgWidth, bgHeight);
      }

      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = fontColor;
      ctx.fillText(line, baseX, lineY);
    });

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  private collectAudioClips(): Array<{
    src: string;
    start: number;
    duration: number;
    offset: number;
    volume: number;
    fadeInDuration?: number;
    fadeOutDuration?: number;
  }> {
    const audioClips: Array<{
      src: string;
      start: number;
      duration: number;
      offset: number;
      volume: number;
      fadeInDuration?: number;
      fadeOutDuration?: number;
    }> = [];

    for (const track of this.tracks) {
      if (track.muted) {
        continue;
      }

      const transitionPlans = this.transitionPlansByTrack.get(track.id) ?? [];
      for (const clip of track.clips) {
        if (clip.type === 'AUDIO' || clip.type === 'VIDEO') {
          const resolvedWindow = this.resolvedWindows.get(clip.id);
          const fadeInPlan = transitionPlans.find((plan) => plan.toClipId === clip.id);
          const fadeOutPlan = transitionPlans.find((plan) => plan.fromClipId === clip.id);
          audioClips.push({
            src: fromKomaLocalUrl(clip.src),
            start: resolvedWindow?.resolvedStart ?? clip.start,
            duration: clip.duration,
            offset: clip.offset,
            volume: clip.opacity ?? 1,
            fadeInDuration: fadeInPlan?.duration,
            fadeOutDuration: fadeOutPlan?.duration,
          });
        }
      }
    }

    return audioClips;
  }

  private getTotalFrames(): number {
    return Math.ceil(this.duration * this.config.fps);
  }

  private emitProgress(progress: SimpleExportProgress) {
    this.progressCallback?.(progress);
  }

  dispose() {
    this.aborted = true;
    this.mediaCache.clear();
  }
}

export default SimpleExportRenderer;
