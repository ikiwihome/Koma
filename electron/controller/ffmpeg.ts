/**
 * FFmpeg IPC 控制器
 * 处理前端发来的 FFmpeg 相关请求
 */
import { IpcMainInvokeEvent } from 'electron';
import { services } from '../service';
import { ensureServicesReady } from '../service';
import type { ExtractFramesOptions, SplitGridImageOptions, WaveformOptions, ComposeVideoOptions } from '../service/ffmpeg';

class FFmpegController {
  /**
   * 检查 FFmpeg 是否可用
   */
  async isAvailable(): Promise<boolean> {
    await ensureServicesReady();
    return services.ffmpeg.isAvailable();
  }

  /**
   * 获取媒体信息
   */
  async getInfo(args: { input: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.getMediaInfo(args.input);
  }

  /**
   * 抽取视频帧
   */
  async extractFrames(args: ExtractFramesOptions, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.extractFrames(args);
  }

  /**
   * 宫格图片分割（支持 2×2 / 3×3 / 4×4 / 5×5）
   */
  async splitGridImage(args: SplitGridImageOptions, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.splitGridImage(args);
  }

  /**
   * 生成音频波形
   */
  async waveform(args: WaveformOptions, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.generateWaveform(args);
  }

  /**
   * 分离音频
   */
  async splitAudio(args: { input: string; output: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.splitAudio(args.input, args.output);
  }

  /**
   * 合成视频
   */
  async composeVideo(args: ComposeVideoOptions, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.composeVideo(args);
  }

  /**
   * 获取缓存目录
   */
  async getCacheDir(args: { subDir?: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.getCacheDir(args.subDir);
  }

  /**
   * 获取临时目录
   */
  async getTempDir(_args: {}, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.getTempDir();
  }

  /**
   * 确保目录存在
   */
  async ensureDir(args: { dirPath: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.ensureDir(args.dirPath);
  }

  /**
   * 保存帧图片
   */
  async saveFrame(args: { filePath: string; dataUrl: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.saveFrame(args.filePath, args.dataUrl);
  }

  /**
   * 清理临时目录
   */
  async cleanupTemp(args: { tempDir: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.cleanupTemp(args.tempDir);
  }

  /**
   * 清理缓存
   */
  async clearCache(args: { subDir?: string }, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    return services.ffmpeg.clearCache(args.subDir);
  }

  /**
   * 取消当前任务
   */
  async cancelTask(_args: {}, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    services.ffmpeg.cancelCurrentTask();
    return { success: true };
  }

  /**
   * 清空任务队列
   */
  async clearQueue(_args: {}, _event: IpcMainInvokeEvent) {
    await ensureServicesReady();
    services.ffmpeg.clearQueue();
    return { success: true };
  }
}

export = FFmpegController;
