/**
 * FFmpeg IPC 控制器
 * 处理前端发来的 FFmpeg 相关请求
 */
import { IpcMainInvokeEvent } from 'electron';
import { services } from '../service';
import { ensureServicesReady } from '../service';
import type { ExtractFramesOptions, SplitGridImageOptions, WaveformOptions, ComposeVideoOptions } from '../service/ffmpeg';

/**
 * 把异常统一转成渲染端可消费的失败结果。
 *
 * **为什么需要它**：ee-core 的 `ipcMain.handle`（node_modules/ee-core/socket/ipcServer.js）
 * 在 catch 之后只 `coreLogger.error` 而不 rethrow —— 渲染端 `await` 得到的是 `undefined`
 * 而不是 rejection。于是 FFmpeg 失败（二进制损坏、参数错误、磁盘满……）在渲染端看起来
 * 完全成功，弹出「导出完成」而输出文件压根不存在。
 * 因此在 controller 层统一返回 `{ success: false, error }`（与 plugin controller 一致）。
 */
function toFailureResult(scope: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? '未知错误');
  console.error(`[FFmpegController] ${scope} failed:`, err);
  return { success: false as const, error: message };
}

class FFmpegController {
  /**
   * 检查 FFmpeg 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      await ensureServicesReady();
      return services.ffmpeg.isAvailable();
    } catch (err) {
      console.error('[FFmpegController] isAvailable failed:', err);
      return false;
    }
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
   *
   * 返回值统一为 `{ success: true, outputPath }` 或 `{ success: false, error }`，
   * 绝不能靠 throw 传递失败（会被 ee-core 吞掉）。service 层已经校验过输出文件确实落盘，
   * 所以 `success: true` 就代表磁盘上真的多了一个非空文件。
   */
  async composeVideo(args: ComposeVideoOptions, _event: IpcMainInvokeEvent) {
    try {
      await ensureServicesReady();
      const outputPath = await services.ffmpeg.composeVideo(args);
      return { success: true as const, outputPath };
    } catch (err) {
      return toFailureResult('composeVideo', err);
    }
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
   *
   * 成功时仍返回字符串（内部调用方都用字符串），失败时返回 `{ success: false, error }`，
   * 由渲染端统一识别。
   */
  async getTempDir(_args: {}, _event: IpcMainInvokeEvent) {
    try {
      await ensureServicesReady();
      return await services.ffmpeg.getTempDir();
    } catch (err) {
      return toFailureResult('getTempDir', err);
    }
  }

  /**
   * 确保目录存在
   */
  async ensureDir(args: { dirPath: string }, _event: IpcMainInvokeEvent) {
    try {
      await ensureServicesReady();
      await services.ffmpeg.ensureDir(args.dirPath);
      return { success: true as const };
    } catch (err) {
      return toFailureResult('ensureDir', err);
    }
  }

  /**
   * 保存帧图片
   */
  async saveFrame(args: { filePath: string; dataUrl: string }, _event: IpcMainInvokeEvent) {
    try {
      await ensureServicesReady();
      await services.ffmpeg.saveFrame(args.filePath, args.dataUrl);
      return { success: true as const };
    } catch (err) {
      return toFailureResult('saveFrame', err);
    }
  }

  /**
   * 清理临时目录
   *
   * 清理失败不应让已经成功的导出变成失败，因此这里只记录日志并返回 success，
   * 让渲染端能区分「导出失败」和「导出成功但临时文件没清完」。
   */
  async cleanupTemp(args: { tempDir: string }, _event: IpcMainInvokeEvent) {
    try {
      await ensureServicesReady();
      await services.ffmpeg.cleanupTemp(args.tempDir);
      return { success: true as const };
    } catch (err) {
      console.warn('[FFmpegController] cleanupTemp failed:', err);
      return { success: false as const, error: err instanceof Error ? err.message : String(err) };
    }
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
