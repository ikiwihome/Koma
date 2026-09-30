/**
 * FFmpeg 服务层
 * 负责视频处理任务：抽帧、波形生成、音视频分离、媒体信息获取等
 */
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import { getFfmpegBinDir, getFfmpegCacheDir } from './paths';

// 媒体信息接口
export interface MediaInfo {
  duration: number;      // 毫秒
  width?: number;
  height?: number;
  fps?: number;
  format: string;
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

// 抽帧选项
export interface ExtractFramesOptions {
  input: string;
  outputDir: string;
  fps?: number;         // 每秒抽取帧数，默认 1
  startTime?: number;   // 开始时间（秒）
  endTime?: number;     // 结束时间（秒）
  width?: number;       // 输出宽度
  quality?: number;     // JPEG 质量 1-31（越小越好）
}

// 宫格图片分割选项（支持 2×2 / 3×3 / 4×4 / 5×5）
export interface SplitGridImageOptions {
  input: string;
  outputDir: string;
  aspectRatio?: string;
  gridSize?: 2 | 3 | 4 | 5;
  // 目标单格最小尺寸，用于放大保证切割后清晰度（默认 16:9 -> 1280x720; 9:16 -> 720x1280）
  minCellWidth?: number;
  minCellHeight?: number;
  // 输出单格目标尺寸；若传入则在裁切后放大到该尺寸
  targetWidth?: number;
  targetHeight?: number;
  // 锐化强度（0~2），默认 0.9
  sharpenAmount?: number;
  // 输出格式，默认 png（无损）
  format?: 'png' | 'jpg' | 'webp';
}

// 波形生成选项
export interface WaveformOptions {
  input: string;
  output: string;
  width?: number;       // 波形图宽度
  height?: number;      // 波形图高度
  color?: string;       // 波形颜色
  backgroundColor?: string;
}

// 视频合成选项
export interface ComposeVideoOptions {
  frameDir: string;           // 帧文件目录
  framePattern: string;       // 帧文件模式，如 'frame_%05d.png'
  fps: number;
  width: number;
  height: number;
  format: 'mp4' | 'webm' | 'gif';
  videoCodec?: 'h264' | 'h265' | 'vp9';
  videoBitrate: number;       // kbps
  audioBitrate: number;       // kbps
  audioTracks: Array<{
    src: string;
    start: number;            // 输出时间线开始时间（秒）
    duration: number;         // 持续时间（秒）
    offset: number;           // 源素材偏移（秒）
    volume: number;           // 音量 0-1
    fadeInDuration?: number;  // 淡入时长（秒）
    fadeOutDuration?: number; // 淡出时长（秒）
  }>;
  outputPath: string;
}

// 任务类型
type TaskType = 'getInfo' | 'extractFrames' | 'splitGridImage' | 'waveform' | 'splitAudio' | 'export' | 'composeVideo';

// 任务定义
interface Task {
  id: string;
  type: TaskType;
  args: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onProgress?: (progress: number) => void;
}

// 进度回调
export type ProgressCallback = (progress: number) => void;

/** 探测二进制是否可执行时匹配 `ffmpeg -version` / `ffprobe -version` 的输出特征。 */
const VERSION_OUTPUT_PATTERN = /\b(?:ffmpeg|ffprobe) version\b/i;

/** 二进制探测超时（毫秒），防止一个卡死的二进制拖住整个服务初始化。 */
const PROBE_TIMEOUT_MS = 5000;

/**
 * FFmpeg 二进制缺失 / 不可执行时的统一错误文案。
 *
 * 这条消息会经过 IPC 一路冒泡到导出对话框，所以要写清「为什么失败」和「怎么修」，
 * 而不是让用户只看到「导出失败，请检查输出路径和磁盘空间」这类无法定位的提示。
 */
const FFMPEG_UNAVAILABLE_MESSAGE =
  'FFmpeg 不可用：未找到可执行的 ffmpeg 二进制（resources/ffmpeg 下的文件缺失或已损坏，系统 PATH 中也没有 ffmpeg）';

/** 只保留 stderr 末尾若干行：完整编码日志可能有几十 KB，塞进错误消息毫无价值。 */
function tailLines(text: string, count = 8): string {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-count).join('\n');
}

/**
 * 把 asar 虚拟路径映射到对应的 `app.asar.unpacked` 真实路径。
 *
 * Electron 只给 `fs`（含 `fs.promises`）打了 asar 补丁：访问 asar 内标记为 unpacked
 * 的文件会自动重定向到 `app.asar.unpacked/`。但 `child_process.spawn` / `execFile`
 * 的**可执行文件路径**不做这个重定向，传 asar 路径只会拿到 ENOENT。
 *
 * 实测（Electron 39，win-unpacked 打包产物）：
 *   fs.accessSync('.../app.asar/resources/ffmpeg/ffmpeg.exe')  → OK
 *   spawn('.../app.asar/resources/ffmpeg/ffmpeg.exe')          → ENOENT
 *
 * 所以凡是「要 spawn 的来源文件」都必须先过这个函数；非 asar 路径原样返回
 * （开发模式下 `app.getAppPath()` 就是项目根，不受影响）。
 */
export function toUnpackedPath(target: string): string {
  return target.replace(/([\\/])app\.asar(?=$|[\\/])/, '$1app.asar.unpacked');
}

/**
 * FFmpeg 服务
 */
export class FFmpegService {
  private ffmpegPath: string = '';
  private ffprobePath: string = '';
  private workDir: string = '';
  private taskQueue: Task[] = [];
  private runningTask: Task | null = null;
  private runningProcess: ChildProcess | null = null;
  private initialized: boolean = false;

  /**
   * 初始化服务
   */
  async init(workDir?: string): Promise<void> {
    const nextWorkDir = workDir || getFfmpegCacheDir();
    if (this.initialized && this.workDir === nextWorkDir) return;

    // 设置工作目录
    this.workDir = nextWorkDir;
    await fs.promises.mkdir(this.workDir, { recursive: true });

    // 检测 FFmpeg 路径
    this.ffmpegPath = await this.detectFFmpegPath('ffmpeg');
    this.ffprobePath = await this.detectFFmpegPath('ffprobe');

    if (!this.ffmpegPath) {
      console.error(
        '[FFmpegService] FFmpeg not found: 视频导出/抽帧/波形等功能将不可用。' +
          '请确认 resources/ffmpeg 下的二进制未损坏，或把 ffmpeg 加入系统 PATH。'
      );
    }

    this.initialized = true;
    console.log('[FFmpegService] Initialized', {
      ffmpeg: this.ffmpegPath || '(未找到)',
      ffprobe: this.ffprobePath || '(未找到)',
      workDir: this.workDir
    });
  }

  /**
   * 收集可能的 FFmpeg 二进制根目录（每个根目录下按下文布局放置二进制）。
   *
   * **为什么不能直接用 `app.getAppPath()` 拼路径**：打包后它是 `.../resources/app.asar`。
   * Electron 只给 `fs` 打了 asar 补丁（把 asar 内文件重定向到 `app.asar.unpacked`），
   * **不会**重定向 `child_process.spawn` 的可执行文件路径。于是
   * `fs.accessSync('.../app.asar/resources/ffmpeg/ffmpeg.exe')` 返回成功、`spawn` 却抛
   * ENOENT，`probeBinary` 永远探测失败、`ffmpegPath` 留空，用户看到的就是
   * 「导出失败：FFmpeg 不可用（resources/ffmpeg 下的文件缺失或已损坏）」——而磁盘上二进制
   * 明明存在且能跑。所以 spawn 前必须换成 unpacked 真实路径（见 toUnpackedPath）。
   */
  private getFFmpegBinRoots(): string[] {
    const roots: string[] = [];
    const resourcesPath = process.resourcesPath;

    if (resourcesPath) {
      // 打包（asarUnpack）：electron-builder 把 resources/ffmpeg/** 解到
      // resources/app.asar.unpacked/resources/ffmpeg/**
      roots.push(path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'ffmpeg'));
      // 打包（extraResources 布局，`to: 'ffmpeg'`）
      roots.push(path.join(resourcesPath, 'ffmpeg'));
    }

    // 开发模式 / asar:false：app.getAppPath() 就是真实目录；打包时它是 app.asar，
    // 必须映射到 app.asar.unpacked 才 spawn 得动。
    roots.push(path.join(toUnpackedPath(app.getAppPath()), 'resources', 'ffmpeg'));

    // 用户自备的二进制目录（优先级最低）
    roots.push(getFfmpegBinDir());

    return [...new Set(roots)];
  }

  /**
   * 检测 FFmpeg 可执行文件路径。
   *
   * 平台 / 架构布局（每个二进制根目录内）：
   *   ffmpeg.exe                                    Windows x64
   *   ffmpeg                                        macOS x64（M1/M2 走 Rosetta）
   *   ffprobe/win32/x64/ffprobe.exe                 Windows x64
   *   ffprobe/win32/ia32/ffprobe.exe                Windows ia32
   *   ffprobe/darwin/x64/ffprobe                    macOS x64
   *   ffprobe/darwin/arm64/ffprobe                  macOS arm64
   */
  private async detectFFmpegPath(name: 'ffmpeg' | 'ffprobe'): Promise<string> {
    const platform = process.platform;
    const arch = process.arch;
    const isWin = platform === 'win32';
    const ext = isWin ? '.exe' : '';
    const execName = name + ext;

    const candidates: string[] = [];

    for (const root of this.getFFmpegBinRoots()) {
      // 优先级 1：固定文件名（ffmpeg 直接落根目录，没有平台子目录）
      candidates.push(path.join(root, execName));

      // 优先级 2：ffprobe 按 platform/arch 命中正确子目录
      if (name !== 'ffprobe') continue;

      if (platform === 'darwin') {
        candidates.push(path.join(root, 'ffprobe', 'darwin', arch, execName));
        // arm64 缺失时回退 x64（Rosetta 翻译）
        if (arch === 'arm64') {
          candidates.push(path.join(root, 'ffprobe', 'darwin', 'x64', execName));
        }
      } else if (platform === 'win32') {
        if (arch === 'x64' || arch === 'arm64') {
          candidates.push(path.join(root, 'ffprobe', 'win32', 'x64', execName));
        }
        // ia32 / arm64 兜底（Win 仿真层会处理）
        candidates.push(path.join(root, 'ffprobe', 'win32', 'ia32', execName));
      }
    }

    // 检查候选路径：既要求文件存在，也要求**真的能跑起来**（见 isRunnable）。
    // 只看存在性会踩到一个坑：被截断 / 架构不匹配的二进制同样「存在」，
    // 却会在 spawn 时异步失败，最终表现为「导出声称成功但文件不存在」。
    for (const p of candidates) {
      if (await this.isRunnable(p, isWin)) {
        return p;
      }
    }

    // 兜底：系统 PATH（`where` / `which` 可能返回多行，逐个探测，第一个能跑的胜出）
    try {
      const result = await this.execCommand(isWin ? 'where' : 'which', [execName]);
      const systemPaths = result
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      for (const systemPath of systemPaths) {
        if (await this.isRunnable(systemPath, isWin)) {
          console.log('[FFmpegService] 回退到系统 PATH 中的二进制', { name, systemPath });
          return systemPath;
        }
      }
    } catch {
      // 系统中也没有
    }

    // 把探测过的候选路径一起打出来：用户报「FFmpeg 不可用」时，日志里能直接看到
    // 是路径不对还是二进制损坏，不用再猜。
    console.warn('[FFmpegService] 未找到可用的 ffmpeg 二进制', { name, candidates });
    return '';
  }

  /**
   * 校验一个候选路径能否真的作为 ffmpeg/ffprobe 执行。
   *
   * 1. 文件必须存在（*nix 下还要求可执行位）；
   * 2. 实际跑一次 `-version`，只有输出版本号才算通过。
   *
   * 第 2 步是关键：Windows 上损坏（被截断）的 PE 文件通过 access 检查毫无问题，
   * 但 spawn 会以 ERROR_BAD_EXE_FORMAT 异步失败，而 ee-core 的 `ipcMain.handle`
   * 会吞掉该异常，于是前端看到「导入/导出成功」而磁盘上根本没有文件。
   */
  private async isRunnable(candidate: string, isWin: boolean): Promise<boolean> {
    try {
      await fs.promises.access(candidate, isWin ? fs.constants.F_OK : fs.constants.X_OK);
    } catch {
      return false;
    }

    if (await this.probeBinary(candidate)) {
      return true;
    }

    console.warn('[FFmpegService] 候选二进制存在但无法执行，跳过', { candidate });
    return false;
  }

  /**
   * 实际执行 `<binary> -version` 探测二进制是否可用。
   *
   * 超时、spawn error、非 0 退出码、输出不含版本号，都视为不可用。
   */
  private probeBinary(execPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!execPath) {
        resolve(false);
        return;
      }

      let settled = false;
      let output = '';

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          proc.kill();
        } catch {
          // 进程可能已经退出
        }
        resolve(ok);
      };

      const proc = spawn(execPath, ['-version']);
      const timer = setTimeout(() => {
        console.warn('[FFmpegService] 二进制探测超时', { execPath });
        finish(false);
      }, PROBE_TIMEOUT_MS);

      proc.stdout?.on('data', (data) => { output += data.toString(); });
      proc.stderr?.on('data', (data) => { output += data.toString(); });
      proc.on('error', (err) => {
        console.warn('[FFmpegService] 二进制探测失败', { execPath, error: err.message });
        finish(false);
      });
      proc.on('close', (code) => {
        finish(code === 0 && VERSION_OUTPUT_PATTERN.test(output));
      });
    });
  }

  /**
   * 执行命令并返回输出
   */
  private execCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { shell: true });
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * 检查 FFmpeg 是否可用。
   *
   * 这里为真代表检测阶段已经成功执行过该二进制的 `-version`，
   * 也就是「文件存在且真的能跑」，而不是「文件存在」而已。
   */
  isAvailable(): boolean {
    return !!this.ffmpegPath;
  }

  /**
   * 获取媒体信息
   */
  async getMediaInfo(input: string): Promise<MediaInfo> {
    return this.queueTask<MediaInfo>('getInfo', { input });
  }

  /**
   * 抽取视频帧
   */
  async extractFrames(options: ExtractFramesOptions): Promise<string[]> {
    return this.queueTask<string[]>('extractFrames', options);
  }

  /**
   * 宫格图片分割（支持 2×2 / 3×3 / 4×4 / 5×5）
   */
  async splitGridImage(options: SplitGridImageOptions): Promise<string[]> {
    return this.queueTask<string[]>('splitGridImage', options);
  }

  /**
   * 生成音频波形图
   */
  async generateWaveform(options: WaveformOptions): Promise<string> {
    return this.queueTask<string>('waveform', options);
  }

  /**
   * 分离音频
   */
  async splitAudio(input: string, output: string): Promise<string> {
    return this.queueTask<string>('splitAudio', { input, output });
  }

  /**
   * 合成视频（图片序列 + 音频 -> 视频文件）
   */
  async composeVideo(options: ComposeVideoOptions, onProgress?: ProgressCallback): Promise<string> {
    return this.queueTask<string>('composeVideo', options, onProgress);
  }

  /**
   * 添加任务到队列
   */
  private queueTask<T>(type: TaskType, args: any, onProgress?: ProgressCallback): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        args,
        resolve,
        reject,
        onProgress
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  /**
   * 处理任务队列
   */
  private async processQueue(): Promise<void> {
    if (this.runningTask || this.taskQueue.length === 0) return;

    const task = this.taskQueue.shift()!;
    this.runningTask = task;

    try {
      let result: any;
      switch (task.type) {
        case 'getInfo':
          result = await this.doGetMediaInfo(task.args.input);
          break;
        case 'extractFrames':
          result = await this.doExtractFrames(task.args);
          break;
        case 'splitGridImage':
          result = await this.doSplitGridImage(task.args);
          break;
        case 'waveform':
          result = await this.doGenerateWaveform(task.args);
          break;
        case 'splitAudio':
          result = await this.doSplitAudio(task.args.input, task.args.output);
          break;
        case 'composeVideo':
          result = await this.doComposeVideo(task.args, task.onProgress);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.runningTask = null;
      this.runningProcess = null;
      // 继续处理队列
      this.processQueue();
    }
  }

  /**
   * 实际获取媒体信息
   */
  private async doGetMediaInfo(input: string): Promise<MediaInfo> {
    if (!this.ffprobePath) {
      throw new Error('FFprobe not available');
    }

    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      input
    ];

    const output = await this.runFFprobe(args);
    const data = JSON.parse(output);

    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
    const format = data.format;

    // 解析帧率
    let fps: number | undefined;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      fps = den ? num / den : num;
    }

    return {
      duration: parseFloat(format?.duration || '0') * 1000,
      width: videoStream?.width,
      height: videoStream?.height,
      fps,
      format: format?.format_name || '',
      videoCodec: videoStream?.codec_name,
      audioCodec: audioStream?.codec_name,
      bitrate: parseInt(format?.bit_rate || '0'),
      audioChannels: audioStream?.channels,
      audioSampleRate: parseInt(audioStream?.sample_rate || '0'),
      hasVideo: !!videoStream,
      hasAudio: !!audioStream
    };
  }

  /**
   * 实际抽帧
   */
  private async doExtractFrames(options: ExtractFramesOptions): Promise<string[]> {
    if (!this.ffmpegPath) {
      console.warn('[FFmpegService] extractFrames: FFmpeg not available', { input: options.input });
      throw new Error(FFMPEG_UNAVAILABLE_MESSAGE);
    }

    const {
      input,
      outputDir,
      fps = 1,
      startTime,
      endTime,
      width,
      quality = 5
    } = options;

    console.log('[FFmpegService] extractFrames start', { input, outputDir, fps, startTime, endTime, width });

    // 确保输出目录存在
    await fs.promises.mkdir(outputDir, { recursive: true });

    const args: string[] = [];

    // 输入选项
    if (startTime !== undefined) {
      args.push('-ss', startTime.toString());
    }
    args.push('-i', input);
    if (endTime !== undefined) {
      args.push('-t', (endTime - (startTime || 0)).toString());
    }

    // 视频过滤器
    const filters: string[] = [`fps=${fps}`];
    if (width) {
      filters.push(`scale=${width}:-1`);
    }
    args.push('-vf', filters.join(','));

    // 输出选项
    args.push('-q:v', quality.toString());
    args.push('-f', 'image2');
    args.push(path.join(outputDir, 'frame_%06d.jpg'));

    try {
      await this.runFFmpeg(args);
    } catch (err) {
      console.error('[FFmpegService] extractFrames ffmpeg failed', { input, outputDir, err: err instanceof Error ? err.message : err });
      throw err;
    }

    // 返回生成的帧文件列表
    const files = await fs.promises.readdir(outputDir);
    const frameFiles = files
      .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort()
      .map(f => path.join(outputDir, f));

    console.log('[FFmpegService] extractFrames done', { input, outputDir, count: frameFiles.length, first: frameFiles[0] });

    return frameFiles;
  }

  private buildGridSplitBounds(total: number, gridSize: number): number[] {
    if (gridSize <= 1) {
      return [0, Math.max(0, total)];
    }

    const bounds = [0];
    for (let index = 1; index < gridSize; index += 1) {
      const next = Math.round((total * index) / gridSize);
      bounds.push(Math.max(bounds[bounds.length - 1], next));
    }
    bounds.push(Math.max(0, total));
    return bounds;
  }

  /**
   * 宫格图片分割（支持 2×2 / 3×3 / 4×4 / 5×5）
   *
   * - 通过“目标单格尺寸”或最小单格尺寸进行预放大
   * - 使用统一边界算法精确切割，避免预览与实际输出错位
   * - 可在切块后直接缩放到 targetWidth / targetHeight
   */
  private async doSplitGridImage(options: SplitGridImageOptions): Promise<string[]> {
    if (!this.ffmpegPath) {
      throw new Error(FFMPEG_UNAVAILABLE_MESSAGE);
    }

    const {
      input,
      outputDir,
      aspectRatio = '16:9',
      gridSize = 3,
      minCellWidth,
      minCellHeight,
      targetWidth,
      targetHeight,
      sharpenAmount = 0.9,
      format = 'png',
    } = options;

    await fs.promises.mkdir(outputDir, { recursive: true });

    let inputWidth = 0;
    let inputHeight = 0;
    try {
      if (this.ffprobePath) {
        const info = await this.doGetMediaInfo(input);
        inputWidth = info.width || 0;
        inputHeight = info.height || 0;
      }
    } catch {
      // ignore
    }

    const defaultCell = aspectRatio === '16:9'
      ? { w: 1280, h: 720 }
      : { w: 720, h: 1280 };
    const desiredCellW = targetWidth || minCellWidth || defaultCell.w;
    const desiredCellH = targetHeight || minCellHeight || defaultCell.h;
    const desiredTotalW = desiredCellW * gridSize;
    const desiredTotalH = desiredCellH * gridSize;

    // 先整体等比放大到足够精细，再按统一边界切块。
    const hasDimensions = inputWidth > 0 && inputHeight > 0;
    const scaleFactor = hasDimensions
      ? Math.max(desiredTotalW / inputWidth, desiredTotalH / inputHeight, 1)
      : 1;
    const scaledW = hasDimensions ? Math.max(1, Math.round(inputWidth * scaleFactor)) : desiredTotalW;
    const scaledH = hasDimensions ? Math.max(1, Math.round(inputHeight * scaleFactor)) : desiredTotalH;
    const xBounds = this.buildGridSplitBounds(scaledW, gridSize);
    const yBounds = this.buildGridSplitBounds(scaledH, gridSize);

    // 基础处理：
    // 1) 如需放大：高质量插值（lanczos）
    // 2) 锐化，保证切割后单格观感更清晰
    // 3) split 后按统一边界裁切，确保和预览使用同一套坐标
    const baseFilters: string[] = [
      `scale=${scaledW}:${scaledH}:flags=lanczos`,
    ];

    baseFilters.push(
      `unsharp=5:5:${Math.max(0, Math.min(2, sharpenAmount))}:3:3:0.0`,
      `split=${gridSize * gridSize}${Array.from({ length: gridSize * gridSize }, (_, index) => `[v${index}]`).join('')}`,
    );

    const cropFilters: string[] = [];
    let outIndex = 0;
    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const x = xBounds[col];
        const y = yBounds[row];
        const cellW = Math.max(1, xBounds[col + 1] - xBounds[col]);
        const cellH = Math.max(1, yBounds[row + 1] - yBounds[row]);
        const scaleFilter = targetWidth && targetHeight
          ? `,scale=${targetWidth}:${targetHeight}:flags=lanczos,unsharp=5:5:${Math.max(0, Math.min(2, sharpenAmount))}:3:3:0.0`
          : '';
        cropFilters.push(`[v${outIndex}]crop=${cellW}:${cellH}:${x}:${y}${scaleFilter}[o${outIndex}]`);
        outIndex += 1;
      }
    }

    const filterComplex = `[0:v]${baseFilters.join(',')};${cropFilters.join(';')}`;

    const outputPaths: string[] = [];
    const args: string[] = [
      '-i', input,
      '-filter_complex', filterComplex,
      '-y',
    ];

    for (let i = 0; i < gridSize * gridSize; i += 1) {
      const filename = `cell_${String(i + 1).padStart(2, '0')}.${format}`;
      const outPath = path.join(outputDir, filename);
      outputPaths.push(outPath);
      args.push('-map', `[o${i}]`, '-frames:v', '1', outPath);
    }

    await this.runFFmpeg(args);
    return outputPaths;
  }

  /**
   * 实际生成波形
   */
  private async doGenerateWaveform(options: WaveformOptions): Promise<string> {
    if (!this.ffmpegPath) {
      throw new Error(FFMPEG_UNAVAILABLE_MESSAGE);
    }

    const {
      input,
      output,
      width = 1800,
      height = 140,
      color = '0x4a9eff',
    } = options;

    // 确保输出目录存在
    await fs.promises.mkdir(path.dirname(output), { recursive: true });

    const args = [
      '-i', input,
      '-filter_complex',
      `aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=${color}:split_channels=0`,
      '-frames:v', '1',
      '-y',
      output
    ];

    await this.runFFmpeg(args);
    return output;
  }

  /**
   * 实际分离音频
   */
  private async doSplitAudio(input: string, output: string): Promise<string> {
    if (!this.ffmpegPath) {
      throw new Error(FFMPEG_UNAVAILABLE_MESSAGE);
    }

    // 确保输出目录存在
    await fs.promises.mkdir(path.dirname(output), { recursive: true });

    const args = [
      '-i', input,
      '-vn',              // 不要视频
      '-acodec', 'copy',  // 音频直接复制
      '-y',
      output
    ];

    await this.runFFmpeg(args);
    return output;
  }

  /**
   * 实际合成视频
   */
  private async doComposeVideo(options: ComposeVideoOptions, onProgress?: ProgressCallback): Promise<string> {
    if (!this.ffmpegPath) {
      throw new Error(FFMPEG_UNAVAILABLE_MESSAGE);
    }

    const {
      frameDir,
      framePattern,
      fps,
      width,
      height,
      format,
      videoCodec = 'h264',
      videoBitrate,
      audioBitrate,
      audioTracks,
      outputPath
    } = options;

    // 确保输出目录存在
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    const args: string[] = [];
    const filterInputs: string[] = [];
    let inputIndex = 0;

    // 输入图片序列
    args.push('-framerate', fps.toString());
    args.push('-i', path.join(frameDir, framePattern));
    filterInputs.push(`[${inputIndex}:v]`);
    inputIndex++;

    // 添加音频输入
    for (const audio of audioTracks) {
      args.push('-i', audio.src);
      inputIndex++;
    }

    // 构建滤镜图
    const filterComplex: string[] = [];

    // 视频缩放（确保尺寸正确）
    filterComplex.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[vout]`);

    // 音频混合
    if (audioTracks.length > 0) {
      const audioFilters: string[] = [];
      for (let i = 0; i < audioTracks.length; i++) {
        const audio = audioTracks[i];
        const audioIdx = i + 1;
        const audioFiltersForTrack = [`atrim=start=${Math.max(0, audio.offset)}:duration=${audio.duration}`];
        if (audio.fadeInDuration && audio.fadeInDuration > 0) {
          audioFiltersForTrack.push(`afade=t=in:st=0:d=${audio.fadeInDuration}`);
        }
        if (audio.fadeOutDuration && audio.fadeOutDuration > 0) {
          const fadeOutStart = Math.max(0, audio.duration - audio.fadeOutDuration);
          audioFiltersForTrack.push(`afade=t=out:st=${fadeOutStart}:d=${audio.fadeOutDuration}`);
        }
        audioFiltersForTrack.push(`volume=${audio.volume}`);
        audioFiltersForTrack.push(`adelay=${Math.round(audio.start * 1000)}|${Math.round(audio.start * 1000)}`);
        audioFilters.push(`[${audioIdx}:a]${audioFiltersForTrack.join(',')}[a${i}]`);
      }
      filterComplex.push(...audioFilters);

      // 混合所有音频
      const mixInputs = audioTracks.map((_, i) => `[a${i}]`).join('');
      filterComplex.push(`${mixInputs}amix=inputs=${audioTracks.length}:duration=longest[aout]`);
    }

    // 应用滤镜
    if (filterComplex.length > 0) {
      args.push('-filter_complex', filterComplex.join(';'));
      args.push('-map', '[vout]');
      if (audioTracks.length > 0) {
        args.push('-map', '[aout]');
      }
    }

    // 视频编码设置
    // 关键：恒定帧率 + 显式输出 fps + GOP 控制，否则导出后播放会卡顿
    // - `-r {fps}` 显式输出帧率，避免与输入 -framerate 不一致导致时间戳错乱
    // - `-vsync cfr` 强制恒定帧率，避免 FFmpeg 自动插帧/丢帧引入 stutter
    // - `-g {fps*2}` 限制关键帧间隔最大 2 秒，避免长 GOP 在 seek/解码时卡
    // - `-movflags +faststart` mp4 metadata 前置，加快 video element 起播
    if (format === 'mp4') {
      const codec = videoCodec === 'h265' ? 'libx265' : 'libx264';
      args.push('-c:v', codec);
      args.push('-preset', 'medium');
      args.push('-b:v', `${videoBitrate}k`);
      args.push('-pix_fmt', 'yuv420p');
      args.push('-r', String(fps));
      args.push('-vsync', 'cfr');
      args.push('-g', String(Math.max(2, Math.round(fps * 2))));
      args.push('-movflags', '+faststart');
      if (audioTracks.length > 0) {
        args.push('-c:a', 'aac');
        args.push('-b:a', `${audioBitrate}k`);
      }
    } else if (format === 'webm') {
      args.push('-c:v', 'libvpx-vp9');
      args.push('-b:v', `${videoBitrate}k`);
      args.push('-r', String(fps));
      args.push('-vsync', 'cfr');
      args.push('-g', String(Math.max(2, Math.round(fps * 2))));
      if (audioTracks.length > 0) {
        args.push('-c:a', 'libopus');
        args.push('-b:a', `${audioBitrate}k`);
      }
    } else if (format === 'gif') {
      // GIF 需要特殊处理
      args.push('-vf', `fps=${Math.min(fps, 15)},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
    }

    // 输出
    args.push('-y', outputPath);

    // 运行 FFmpeg
    await this.runFFmpegWithProgress(args, onProgress);

    // 校验输出文件确实落盘。
    //
    // 这是「导出的文件不存在」这个 bug 的最后一道防线：ee-core 的
    // `ipcMain.handle` 会吞掉 IPC 处理函数抛出的异常（只打日志、不 rethrow），
    // 渲染端 `await` 会正常 resolve，于是弹出「导出完成」而磁盘上什么都没有。
    // 在这里直接 stat 输出文件，能保证「FFmpeg 正常退出」和「文件真的存在」是同一件事。
    try {
      const stat = await fs.promises.stat(outputPath);
      if (stat.size === 0) {
        throw new Error(`FFmpeg 生成的输出文件为空: ${outputPath}`);
      }
      console.log('[FFmpegService] composeVideo 完成', { outputPath, bytes: stat.size });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('FFmpeg 生成的输出文件为空')) {
        throw err;
      }
      console.error('[FFmpegService] composeVideo 未生成输出文件', { outputPath, err });
      throw new Error(`FFmpeg 已退出但未生成输出文件: ${outputPath}`);
    }

    return outputPath;
  }

  /**
   * 运行 FFmpeg 命令（带进度回调）
   */
  private runFFmpegWithProgress(args: string[], onProgress?: ProgressCallback): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log('[FFmpegService] Running:', this.ffmpegPath, args.join(' '));

      const proc = spawn(this.ffmpegPath, args);
      this.runningProcess = proc;

      let stderr = '';
      let totalDuration = 0;

      proc.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;

        // 解析总时长
        if (!totalDuration) {
          const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (durationMatch) {
            const [, h, m, s, ms] = durationMatch.map(Number);
            totalDuration = h * 3600 + m * 60 + s + ms / 100;
          }
        }

        // 解析当前进度
        if (onProgress && totalDuration > 0) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (timeMatch) {
            const [, h, m, s, ms] = timeMatch.map(Number);
            const currentTime = h * 3600 + m * 60 + s + ms / 100;
            const progress = Math.min(100, (currentTime / totalDuration) * 100);
            onProgress(progress);
          }
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          onProgress?.(100);
          resolve('');
        } else {
          reject(new Error(`FFmpeg 合成视频失败（退出码 ${code}）:\n${tailLines(stderr) || '(无 stderr 输出)'}`));
        }
      });

      proc.on('error', (err) => {
        // 二进制损坏 / 架构不匹配会走到这里（例如 Windows 的 ERROR_BAD_EXE_FORMAT）
        reject(new Error(`FFmpeg 无法启动（${this.ffmpegPath}）: ${err.message}`));
      });
    });
  }

  /**
   * 运行 FFmpeg 命令
   */
  private runFFmpeg(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log('[FFmpegService] Running:', this.ffmpegPath, args.join(' '));

      const proc = spawn(this.ffmpegPath, args);
      this.runningProcess = proc;

      let stderr = '';

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
        // 解析进度
        this.parseProgress(data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve('');
        } else {
          reject(new Error(`FFmpeg 执行失败（退出码 ${code}）:\n${tailLines(stderr) || '(无 stderr 输出)'}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`FFmpeg 无法启动（${this.ffmpegPath}）: ${err.message}`));
      });
    });
  }

  /**
   * 运行 FFprobe 命令
   */
  private runFFprobe(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      console.log('[FFmpegService] Running:', this.ffprobePath, args.join(' '));

      const proc = spawn(this.ffprobePath, args);
      this.runningProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`FFprobe failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * 解析 FFmpeg 进度输出
   */
  private parseProgress(output: string): void {
    if (!this.runningTask?.onProgress) return;

    // 解析 time=00:01:23.45 格式
    const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    if (timeMatch) {
      // 这里需要知道总时长才能计算进度，暂时不实现
    }
  }

  /**
   * 取消当前任务
   */
  cancelCurrentTask(): void {
    if (this.runningProcess) {
      this.runningProcess.kill('SIGKILL');
      this.runningProcess = null;
    }
  }

  /**
   * 清空任务队列
   */
  clearQueue(): void {
    for (const task of this.taskQueue) {
      task.reject(new Error('Task cancelled'));
    }
    this.taskQueue = [];
    this.cancelCurrentTask();
  }

  /**
   * 获取缓存目录
   */
  getCacheDir(subDir?: string): string {
    const dir = subDir ? path.join(this.workDir, subDir) : this.workDir;
    return dir;
  }

  /**
   * 清理缓存
   */
  async clearCache(subDir?: string): Promise<void> {
    const dir = this.getCacheDir(subDir);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (err) {
      console.error('[FFmpegService] Clear cache failed:', err);
    }
  }

  /**
   * 获取临时目录
   */
  getTempDir(): string {
    return path.join(this.workDir, 'export-temp');
  }

  /**
   * 确保目录存在
   */
  async ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  /**
   * 保存帧图片（从 base64 data URL）
   */
  async saveFrame(filePath: string, dataUrl: string): Promise<void> {
    // 确保目录存在
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    // 解析 data URL
    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid data URL format');
    }

    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.promises.writeFile(filePath, buffer);
  }

  /**
   * 清理临时目录
   */
  async cleanupTemp(tempDir: string): Promise<void> {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[FFmpegService] Cleanup temp failed:', err);
    }
  }
}

// 单例
export const ffmpegService = new FFmpegService();
