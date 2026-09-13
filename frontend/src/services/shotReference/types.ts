/**
 * 分镜统一引用集合（ShotReferenceBundle）
 *
 * 让生图（TTI）和生视频（ITV multi-ref）共用同一份 references 数组、同一套
 * @Image N 索引协议。bundle 是单一事实来源；下游构造 provider 请求时严格按 items
 * 的位置顺序展开 references[0..N]。
 *
 * 设计决策：
 * - grid 模式不拆分。3×3 整图存于 `shot.media.images[currentImageIndex]`（老
 *   `shot.media.gridImage` 字段已被 normalizeShotMediaState 合并进来），bundle
 *   把它当作单一锚点（grid-anchor），9 帧时序由提示词模板的
 *   {{gridSequenceNotice}} 段引导 LLM 描述。
 * - 拆分子图（`shot.media.images` 中带 `metadata.gridCell` 的项）属于历史路径，
 *   bundle builder 显式过滤不读取它们。
 */
import type { MediaAssetSource } from '../../types';

/**
 * 引用项的语义类别。用于 priority 排序、配额裁剪、提示词模板分支判断。
 */
export type ShotReferenceKind =
  | 'shot-anchor'    // normal 模式的已生成分镜首帧（shot.media.images[currentImageIndex]）
  | 'grid-anchor'    // grid 模式的 3×3 九宫格整图（shot.media.gridImage，不拆分）
  | 'storyboard-anchor' // storyboard 模式的当前故事板整图
  | 'previous-storyboard-anchor' // 上一分镜故事板整图，用于故事板连续性
  | 'scene'          // 场景资产图（按 shot.scenes 顺序）
  | 'character'      // 角色资产图（按 shot.characters 顺序，主角在前）
  | 'prop'           // 道具资产图（按 shot.props 顺序）
  | 'user-upload';   // 用户挂在 shot.media.references[] 上的额外参考图

export interface ShotReferenceItem {
  kind: ShotReferenceKind;
  /** 稳定标识，用于裁剪日志、跨镜头连续性比对 */
  id: string;
  /** UI 显示用的人类可读标签（如 "周明（角色）" / "分镜锚点" / "宿舍（场景）"） */
  label: string;
  /** 实际参考图源——StoredMediaAsset 或 string（远程 URL / data URL / koma-local://） */
  source: MediaAssetSource;
  /**
   * Mention token，用于在提示词中引用该项的标记。Provider 端的
   * grok-image-index 协议编译时会把 token 替换为具体的 `@Image N`，N 严格
   * 对应 references 数组的位置。
   *
   * 约定：
   *  - shot-anchor: '@shot_anchor'
   *  - grid-anchor: '@grid_anchor'
   *  - storyboard-anchor: '@storyboard_anchor'
   *  - previous-storyboard-anchor: '@previous_storyboard_anchor'
   *  - scene:       '@scene_<sceneId>'
   *  - character:   '@char_<characterId>'
   *  - prop:        '@prop_<propId>'
   *  - user-upload: '@user_<index>'
   */
  mentionToken: string;
  /** 配额裁剪用的优先级。数值越大越保留。 */
  priority: number;
  /**
   * 该项的源资产 ID（仅 character/scene/prop 有效，用于诊断和跨流程对齐）。
   * shot-anchor / grid-anchor / user-upload 留空。
   */
  assetId?: string;
}

export interface ShotReferenceBundle {
  /** 严格按位置排序，对应 references[0], [1], ... 全 bundle 共享同一索引空间。 */
  items: ReadonlyArray<ShotReferenceItem>;
  /**
   * 资产 mention 的可读降级表。资产存在但没有可用参考图、或因模型引用图上限被裁掉时，
   * compile 层用这里的标签替换 raw `@char_*` / `@scene_*` / `@prop_*`，避免把机器 ID
   * 泄漏给 provider。
   */
  mentionFallbacks?: ReadonlyArray<{ mentionToken: string; label: string }>;
  /**
   * bundle 是否含 grid-anchor。提示词模板用此 flag 决定是否渲染
   * {{gridSequenceNotice}} 段（九宫格时序约定）。
   */
  hasGridAnchor: boolean;
  /**
   * 当 hasGridAnchor=true 时，描述网格 cell 数：
   *  - 9 → 3×3 九宫格
   *  - 4 → 2×2 四宫格
   * hasGridAnchor=false 时为 undefined。下游渲染（gridSequenceNotice / shotsSection）
   * 据此决定渲染 9 帧还是 4 帧时序骨架。
   */
  gridCellCount?: 4 | 9;
  /** 是否含当前分镜图锚点之一（用于决定能否走 image-to-video 兼容降级）。 */
  hasShotImage: boolean;
  /** 配额信息：实际产出的 items 数量、被裁掉的数量。用于诊断日志。 */
  capacity: {
    maxRefs: number;
    truncatedCount: number;
    truncatedKinds: ShotReferenceKind[];
  };
}

/**
 * 提供给 buildShotReferenceBundle 的辅助参数：当前 ITV / TTI 模型的引用图上限。
 * 没传时按 DEFAULT_MAX_REFS 兜底。
 */
export interface ShotReferenceBundleOptions {
  /** 模型可接受的最大引用图数量。grok2 multipart edit ≤ 4，gemini 较多，seedance 视模型而定。 */
  maxRefs?: number;
}

/** 没声明 maxRefs 时的安全兜底。多数 provider 实测 4-6 张可靠。 */
export const DEFAULT_MAX_REFS = 6;
