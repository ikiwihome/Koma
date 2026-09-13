import type { Theme } from '../types';
import { amber, blue, emerald, red } from '../palettes';

export const highContrastTheme = {
  meta: {
    id: 'high-contrast',
    name: '高对比',
    mode: 'dark',
    description: '高对比无障碍主题，强化边界、文字和焦点可见度。',
  },
  tokens: {
    bg: {
      app: '#000000',
      surface: '#050505',
      elevated: '#101010',
      card: '#050505',
      hover: '#1f1f1f',
    },
    border: {
      base: '#ffffff',
      subtle: '#8a8a8a',
      focus: amber[300],
    },
    text: {
      primary: '#ffffff',
      secondary: '#f5f5f5',
      tertiary: '#d4d4d4',
      muted: '#b5b5b5',
    },
    accent: {
      base: amber[300],
      hover: amber[200],
      glow: 'rgba(252, 211, 77, 0.34)',
      // accent 是亮黄色，白底白文不可读 → 用纯黑做对比文字（21:1）
      onAccent: '#000000',
    },
    status: {
      success: emerald[300],
      info: blue[300],
      warning: amber[300],
      error: red[300],
      // 高对比所有 status 用 300 档（浅亮色），实色背景上须配深文字
      onStatus: '#000000',
    },
    radius: {
      sm: 4,
      base: 4,
      lg: 6,
    },
    shadow: {
      sm: '0 0 0 1px rgba(255, 255, 255, 0.8)',
      md: '0 0 0 2px rgba(255, 255, 255, 0.72)',
      lg: '0 0 0 3px rgba(255, 255, 255, 0.64)',
      glow: '0 0 0 3px rgba(252, 211, 77, 0.9), 0 0 24px rgba(252, 211, 77, 0.42)',
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
      onBg: 'rgba(255, 255, 255, 0.16)',
    },
  },
} satisfies Theme;

export default highContrastTheme;
