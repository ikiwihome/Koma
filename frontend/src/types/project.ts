/**
 * 项目 / 剧集 / 主题预设 / 持久化元数据等核心实体类型
 *
 * 由 P1#4 从 frontend/src/types.ts 拆出，types.ts 现仅 re-export 本文件。
 * 调用方继续 `import { Project } from '../types'` 不变。
 */
import type { MediaModelSelection } from '../providers/channel/types';
import type { Shot } from './scene-character';

export type StylePresetSourceType = 'builtin' | 'custom';

export interface ProjectStyleSnapshot {
  id: string;
  name: string;
  description: string;
  ttiStylePrefix: string;
  llmPromptSuffix: string;
  sourceType: StylePresetSourceType;
  sourcePresetId: string;
  createdAt: number;
  /**
   * 风格参考图（"画风锚"）。生成角色 / 场景 / 道具图时会作为 references[0] 注入，
   * provider 走图生图分支，让模型严格继承画风（色调 / 笔触 / 光影 / 笔法 / 整体氛围），
   * 不参考其中的人物 / 物体 / 服装 等具体内容（由 prompt 硬约束实现）。
   *
   * 优先级：
   *   1. 项目级 styleSnapshot.styleReferenceImage（用户在项目设置上传/覆盖）
   *   2. 全局风格预设默认图（从 ThemePreset.defaultStyleReferenceFile 推 userData 路径）
   *   3. 都没有 → 不注入风格图，回退到纯 text-to-image
   */
  styleReferenceImage?: import('./media').StoredMediaAsset;
}

// 项目接口定义
export interface Project {
  id: string;
  title: string;
  genre: string;     // 题材类型
  mode?: 'drama' | 'narration'; // 叙事模式：剧情模式 | 旁白解说模式
  episodes: number;  // 集数
  lastEdited: string;// 最后编辑时间
  thumbnail: string; // 封面图
  status: 'script' | 'storyboard' | 'generating' | 'completed'; // 项目状态
  mediaSelections?: Partial<Record<'llm' | 'tti' | 'itv' | 'tts', MediaModelSelection>>;
  aspectRatio?: '16:9' | '9:16'; // 项目画面比例（创建时确定，不可更改）
  stylePresetId?: string;   // 选中的全局风格 ID
  styleSnapshot?: ProjectStyleSnapshot; // 项目风格快照
  /** 项目级 TTS 音色（覆盖 channel.defaultVoice，留空时走 channel 默认） */
  ttsVoiceId?: string;
  /** 项目级 TTS 语速倍数（OpenAI 兼容 speed 字段，默认 1.2） */
  ttsSpeed?: number;
  // @deprecated 遗留字段，仅保留给未改造调用点过渡
  theme?: string;
  // @deprecated 遗留字段，仅保留给未改造调用点过渡
  stylePrompt?: string;
  episodeCount?: number;    // 实际剧集数（用于剧集管理）
}

// 剧集步骤进度 (3步流程: assets → storyboard → video)
export interface EpisodeStepProgress {
  assets: 'pending' | 'completed';
  storyboard: 'pending' | 'completed';
  video: 'pending' | 'completed';
}

// 剧集接口定义
export interface Episode {
  id: string;
  projectId: string;
  number: number;           // 集数编号
  title: string;            // 剧集标题
  scriptText?: string;      // 本集剧本
  status: 'draft' | 'script' | 'storyboard' | 'generating' | 'completed';
  stepProgress?: EpisodeStepProgress;  // 各步骤完成状态
  /**
   * 剧本是否已"推文化"（字幕行格式确认）。
   * 仅当 true 时才允许触发解析剧本与进入下一步。
   * 触发置 true 的入口：
   *  1) 点击「推文文案」按钮、流式改写完成后
   *  2) 点击工具栏「标记为字幕格式」按钮（用于直接导入字幕文件等手写场景的绕过入口）
   * 用户手编辑剧本时是否重置此标志，先暂不处理（TODO 后议）
   */
  scriptReady?: boolean;
  createdAt: number;
  updatedAt: number;
  // 剧集解析数据引用（实际数据存储在 episodes/{id}/analysis.json）
  hasAnalysis?: boolean;
}

// 剧集解析结果（存储在 episodes/{id}/analysis.json）
export interface EpisodeAnalysis {
  episodeId: string;
  // 引用项目级资产（ID 引用，非复制）
  characterRefs: string[];
  sceneRefs: string[];
  propRefs: string[];
  completedStages?: Array<'characters' | 'scenes' | 'props' | 'shots' | 'tweet'>;
  // 剧集特有的分镜
  shots: Shot[];
  createdAt: number;
  updatedAt: number;
}

// 资产引用追踪
export interface EpisodeRef {
  episodeId: string;
  episodeName: string;
  firstAppearance: boolean;
  shotIds?: string[];
}

// 主题预设接口
export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  ttiStylePrefix: string;   // TTI 提示词风格前缀
  llmPromptSuffix: string;  // LLM 提示词风格后缀
  previewImage?: string;    // 预览图
  /**
   * 默认风格参考图文件名（不带路径）。
   * 内置图打包在 electron/resources/style-references/ 下，启动时拷贝到
   * `${userData}/style-references/`；用户未上传项目级覆盖时，本字段决定从哪个
   * 默认图作画风锚。
   * 例：`'realistic.svg'` → 解析为 `${userData}/style-references/realistic.svg`
   */
  defaultStyleReferenceFile?: string;
}

// ========== 存储相关类型 ==========

export interface StorageConfig {
  rootPath: string;       // 存储根目录
  version: number;        // 存储格式版本
}

export interface ProjectMeta {
  id: string;
  title: string;
  genre: string;
  mode: 'drama' | 'narration';
  createdAt: number;
  updatedAt: number;
  thumbnailPath?: string;
  mediaSelections?: Partial<Record<'llm' | 'tti' | 'itv' | 'tts', MediaModelSelection>>;
  aspectRatio?: '16:9' | '9:16';
  stylePresetId?: string; // 选中的全局风格 ID
  styleSnapshot?: ProjectStyleSnapshot;
  /**
   * 视频提示词模板档位选择（项目级）。
   * 模板池：multi-ref 含 [6,10,15,20]、first-frame 含 [6,10,16,20]，每模式都可单独勾选。
   * 不设置 / 数组空时回退到默认全选。运行时按 shot.duration 在勾选档位中找最近的档位匹配模板，
   * 避免落空（详见 ShotPromptService.selectVideoTemplateKey）。
   */
  videoPromptDurationSelections?: {
    multiRef?: number[];
    firstFrame?: number[];
  };
  /**
   * 项目级 TTS 偏好（生成配音时使用，覆盖 channel.defaultVoice）：
   *  - voiceId: Koma TTS 内置音色 id（如 'cherry'）。空时走 channel 默认。
   *  - speed: 语速倍数（OpenAI 兼容字段 speed，0.25-4.0）。默认 1.2。
   */
  ttsVoiceId?: string;
  ttsSpeed?: number;
  // @deprecated 遗留字段，仅保留给未改造调用点过渡
  theme?: string;
  // @deprecated 遗留字段，仅保留给未改造调用点过渡
  stylePrompt?: string;
}

export interface RecentProject {
  id: string;
  title: string;
  path: string;
  lastOpened: number;
  thumbnailPath?: string;
}

// ========== 保存状态类型 ==========

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

export interface ProjectSaveState {
  projectId: string;
  status: SaveStatus;
  lastSavedAt?: number;
  error?: string;
}
