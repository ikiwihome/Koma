/**
 * 项目级素材库类型
 *
 * 由阶段 1 清理从 frontend/src/types.ts 拆出。
 * 这是"项目级素材库"概念（Project asset library，存于 SQLite + 文件系统），
 * 与 types/editor.ts 中的 Asset（编辑器内素材项，含位置/媒体属性）是
 * **两个不同的实体**，名字相同纯属历史巧合。
 */

/**
 * 项目素材库条目。
 * 由 store/project/assets.ts 维护，对应 electronService.asset.* IPC。
 */
export interface Asset {
  id: string;
  name: string;
  /** 'video' | 'audio' | 'image' 等媒体小类（与 types/editor.ts 的 Asset.type enum 不同） */
  type: 'video' | 'audio' | 'image' | 'text' | 'subtitle' | 'sticker';
  /** 文件路径 */
  path: string;
  thumbnailPath?: string;
  /** 视频/音频时长（毫秒） */
  duration?: number;
  /** 文件大小（字节） */
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
  /** 用于去重 */
  md5?: string;
  /** 引用计数 */
  refCount: number;
}
