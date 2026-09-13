/**
 * 分镜布局常量
 * 确保表头与内容列宽同步
 * 左侧操作列固定宽度，内容区域使用 flex 分配
 */

// 左侧操作列宽度 — 头部需要同时容纳 全选 checkbox + 批量删除按钮，原 64px 在
// hasSelected 时会变形（按钮被挤出去）。提到 80px 给两个元素留够呼吸空间。
export const COL_ACTION_WIDTH = 'w-20'; // 80px 操作列

// 内容区域列宽度 (使用 flex 比例避免横向滚动)
//
// Phase: 把原来 4 个独立的媒体列 (图像设计 / 图像结果 / 视频设计 / 视频结果)
// 收成 1 个 colMedia，内部用 CSS 2×2 grid 渲染。释放出的横向空间分配给 colAssets，
// 同时分镜行高度提到 480px 让媒体单格有合理空间。
export const SHOT_LAYOUT = {
  // 剧本列：字幕块列表（媒体列扩张后稍收窄）
  colScript: 'flex-[18] min-w-[170px]',
  // 资产列：纵向角色 / 场景 / 道具 三段
  colAssets: 'flex-[14] min-w-[180px]',
  // 媒体列：内部 2×2 grid（图像设计 / 图像结果 / 视频设计 / 视频结果）
  colMedia: 'flex-[38] min-w-[440px]',
};

export const ASSET_TYPES = {
  CHARACTER: { label: '角色', icon: 'UserOutlined', color: 'text-blue-400' },
  SCENE: { label: '场景', icon: 'EnvironmentOutlined', color: 'text-green-400' },
  PROP: { label: '道具', icon: 'ToolOutlined', color: 'text-orange-400' },
} as const;
