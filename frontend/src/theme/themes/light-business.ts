import type { Theme } from '../types';
import { amber, blue, emerald, red, slate } from '../palettes';

/**
 * 商务明亮主题 — 克制、正式、清晰。
 *
 * 设计取向：
 *  - **主色**：blue-800（#1e40af 深海军蓝）。比 blue-600 更克制，是经典商务用色；
 *    避开亮饱和蓝那种"产品宣传 / 营销"的活泼感。
 *  - **背景层级**：page bg 用偏冷的 #f5f7fa 而非纯白，给信息容器（卡片纯白）留对比；
 *    elevated/card 一律纯白，靠阴影表达层级。
 *  - **边框**：偏冷的浅灰 (#d6dde7 / #eaedf2)，分两档；不要太重，避免视觉吵闹。
 *  - **文字**：slate-900 接近黑但带蓝灰底；secondary 600 / tertiary 500 / muted 400 形成清晰梯度。
 *  - **状态色**：统一收敛到 7 档（更深、更稳重），亮模式下白底深色对比足。
 *  - **阴影**：基于 slate-900 微透明，分两层（弥散 + 锐利），像 Notion / Linear 那种现代企业 SaaS 的轻盈手感。
 */
export const lightBusinessTheme = {
  meta: {
    id: 'light-business',
    name: '商务明亮',
    mode: 'light',
    description: '深海军蓝主色 + 三档近白层级，克制正式的商务白底主题。',
  },
  tokens: {
    bg: {
      // 页面底（最低层级）：偏冷的 #f5f7fa，让纯白卡片有对比层
      app: '#f5f7fa',
      // 表面（侧栏 / 表格 / 列表行）：纯白，给信息容器明确边界
      surface: '#ffffff',
      // 悬浮（Modal / Popover / Dropdown / 输入框）：极浅冷白
      // 比 surface 略偏一档，让在白色卡片内的输入框 / 下拉菜单有可见边界
      elevated: '#f7f9fc',
      // 卡片：纯白
      card: '#ffffff',
      // hover：极浅冷灰，比 slate-100 更柔
      hover: '#eef2f7',
    },
    border: {
      // 主边框：输入框 / 卡片可见边框，偏冷浅灰
      base: '#d6dde7',
      // 次边框：分割线，几乎不可见
      subtle: '#eaedf2',
      // 焦点：与主色一致的深蓝
      focus: blue[800],
    },
    text: {
      // 主文字：slate-900，接近黑但有蓝灰底，比纯黑柔和
      primary: slate[900],
      // 次文字：slate-600，body 副文本
      secondary: slate[600],
      // 辅文字：slate-500，hint / 时间戳等
      tertiary: slate[500],
      // 弱文字：slate-400，禁用态 / 占位
      muted: slate[400],
    },
    accent: {
      // 主色：blue-800 深海军蓝（典型企业 SaaS 用色）
      base: blue[800],
      // hover：再深一档
      hover: blue[900],
      // glow：极淡的蓝色光晕
      glow: 'rgba(30, 64, 175, 0.10)',
      // 主色实色上叠的文字：纯白 → 深蓝底白文，对比 8.6:1 ≥ WCAG AAA
      onAccent: '#ffffff',
    },
    status: {
      // 统一往 7 档收敛，避免亮主题下浅色文字看不清
      success: emerald[700],
      info: blue[700],
      warning: amber[700],
      error: red[700],
      // 状态实色（700 档已是中深）上的文字：白色对比足
      onStatus: '#ffffff',
    },
    radius: {
      sm: 6,
      base: 8,
      lg: 12,
    },
    shadow: {
      // 弥散浅阴影 + 1px 边线感，模拟 Notion / Linear 的轻盈卡片
      sm: '0 1px 2px rgba(15, 23, 42, 0.05), 0 0 0 1px rgba(15, 23, 42, 0.04)',
      md: '0 6px 16px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)',
      lg: '0 24px 48px rgba(15, 23, 42, 0.12), 0 8px 16px rgba(15, 23, 42, 0.06)',
      // 焦点环：锐利 1px 蓝边 + 极淡光晕
      glow: '0 0 0 1px rgba(30, 64, 175, 0.55), 0 0 0 4px rgba(30, 64, 175, 0.12)',
    },
    space: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
    },
    z: {
      base: 1,
      modal: 1000,
      dropdown: 1050,
      tooltip: 1100,
    },
    overlay: {
      // 亮主题：在亮底上叠"暗向"半透明（深色叠加），用于 hover 高亮 / 蒙层
      onBg: 'rgba(15, 23, 42, 0.05)',
    },
  },
} satisfies Theme;

export default lightBusinessTheme;
