/**
 * 角色 / 场景 / 道具 / 分镜 等剧本/资产相关类型
 *
 * 由 P1#4 从 frontend/src/types.ts 拆出，types.ts 现仅 re-export 本文件。
 * 调用方继续 `import { Character } from '../types'` 不变。
 */
import type {
  CharacterMediaSlots,
  PropMediaSlots,
  SceneMediaSlots,
  ShotMediaState,
  ShotVersionMediaState,
  StoredMediaAsset,
} from './media';
import type { EpisodeRef } from './project';

// 资产时间戳范围（用于 Sora2 角色提取）
export interface AssetTimestampRange {
  start: number; // 起始时间（秒）
  end: number;   // 结束时间（秒），与 start 间隔不超过 3 秒
}

export type CharacterGender = 'male' | 'female' | 'neutral' | 'unknown';

// 角色接口定义
export interface Character {
  id: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting'; // 主角 | 反派 | 配角
  prompt: string;      // 核心视觉提示词

  age?: string;
  gender?: CharacterGender;
  description?: string;
  appearance?: string;
  /** 该人物在原文中的全部代称，多个用英文逗号分隔；无代称为空字符串 */
  aliases?: string;

  voiceId?: string;    // TTS 音色 ID
  media?: CharacterMediaSlots; // 结构化媒体槽位
  sora2CharacterId?: string;  // 角色提取API返回的ID
  timestampRange?: AssetTimestampRange; // Sora2 提取时间范围
  // 剧集引用追踪
  episodeRefs?: EpisodeRef[];
  fingerprint?: string;       // 资产指纹（用于去重）
}

// 场景接口定义
export interface Scene {
  id: string;
  name: string;
  prompt: string;     // 核心提示词

  location?: string;
  time?: 'day' | 'night' | 'twilight';
  mood?: string;
  description?: string;
  /** 该场景在原文中的全部代称，多个用英文逗号分隔；无代称为空字符串 */
  aliases?: string;

  media?: SceneMediaSlots; // 结构化媒体槽位
  // 剧集引用追踪
  episodeRefs?: EpisodeRef[];
  fingerprint?: string;
}

// 道具接口定义
export interface Prop {
  id: string;
  name: string;
  prompt: string;     // 核心提示词

  type?: string;
  description?: string;
  /** 该道具在原文中的全部代称，多个用英文逗号分隔；无代称为空字符串 */
  aliases?: string;

  media?: PropMediaSlots; // 结构化媒体槽位
  // Sora2 绑定相关
  sora2PropId?: string;        // Sora2 道具 ID
  timestampRange?: AssetTimestampRange; // Sora2 提取时间范围
  // 剧集引用追踪
  episodeRefs?: EpisodeRef[];
  fingerprint?: string;
}

// 分镜视频版本
export interface ShotVideo {
  path: string;
  url?: string;        // 远程URL
  thumbnailPath?: string;
  prompt?: string;
  seed?: number;
  model?: string;
  asset?: StoredMediaAsset;
  createdAt: number;
}

// 分镜视频推理模式：
// - multi-ref：多参照模式，提示词内会出现 @角色/@场景/@道具 映射，依赖映射基准库
// - first-frame：首帧延展模式，以单图为锚做微动延展，提示词不出现 @ 映射
export type ShotVideoMode = 'multi-ref' | 'first-frame';

/**
 * 分镜内的字幕行块。
 * 剧本步骤推文文案化后，剧本被切分成"一行一句字幕"格式；分镜步骤把这些行
 * 按归属切片到每个分镜，每行成为一个独立可编辑、可拖拽（支持跨分镜）的块。
 * scriptLines 是分镜内"剧本"的唯一来源，下游 image / video prompt 推理用 join('\n') 还原文本。
 */
export interface ShotScriptLine {
  id: string;
  text: string;
}

export type ShotImageMode = 'normal' | 'grid' | 'grid-9' | 'grid-4' | 'storyboard';

// 分镜/镜头接口定义
export interface Shot {
  id: string;
  scriptLines: ShotScriptLine[]; // 字幕行块列表（取代旧 scriptContent + tweetCopy）
  shotType: 'close-up' | 'medium' | 'wide' | 'extreme-wide'; // 特写 | 中景 | 全景 | 大全景
  cameraMovement: 'static' | 'pan' | 'zoom-in' | 'tracking' | 'handheld'; // 固定 | 摇镜 | 推镜 | 跟随 | 手持
  duration: number;      // 持续时长(秒)
  imagePrompt?: string;  // 图片生成提示词
  videoPrompt?: string;  // 视频生成提示词
  /**
   * 图片生成模式（默认 normal）：
   *  - 'normal'   普通单图模式
   *  - 'grid-9'   3×3 九宫格（9 帧时序）
   *  - 'grid-4'   2×2 四宫格（4 帧时序，更细的镜头控制 / 更少切换）
   *  - 'storyboard' 电影故事板 / 制作方案板（多面板叙事参考）
   *  - 'grid'     旧值，等价于 'grid-9'，仅向后兼容老数据
   */
  imageMode?: ShotImageMode;
  /** 故事板模式下是否把上一张故事板图片作为连续性参考；未设置时默认继承。 */
  inheritPreviousStoryboard?: boolean;
  videoMode?: ShotVideoMode; // 视频推理模式（默认 'multi-ref'）
  media?: ShotMediaState; // 结构化媒体槽位
  // 关联资产
  characters: string[];  // 涉及的角色ID
  scenes?: string[];     // 涉及的场景ID（可在 UI 中编辑）
  dialogue?: string;     // 台词（用于 TTS）
  emotion?: string;      // 情绪标签
  props?: string[];      // 涉及的道具ID
  confirmed?: boolean;   // 是否已确认（用于入轨）
  seed?: number;         // 生成种子（用于复现）
  currentVersion?: number; // 当前版本号（兼容旧数据）
}

// 剧本分析结果接口
export interface ScriptAnalysisResult {
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  shots: Shot[];
}

export interface ShotVersion {
  version: number;
  media?: ShotVersionMediaState; // 结构化媒体槽位
  prompt: string;
  seed: number;
  model: string;
  createdAt: number;
}

export interface ShotMeta {
  id: string;
  prompt: string;
  seed: number;
  model: string;
  currentVersion: number;
  versions: ShotVersion[];
}
