import type { Theme } from '../types';
import { amber, blue, emerald, red, zinc } from '../palettes';

export const darkEmeraldTheme = {
  meta: {
    id: 'dark-emerald',
    name: '暗色翡翠',
    mode: 'dark',
    description: '深色背景搭配翡翠绿主色。',
  },
  tokens: {
    bg: {
      app: zinc[950],
      surface: zinc[900],
      elevated: zinc[800],
      card: zinc[900],
      hover: zinc[700],
    },
    border: {
      base: zinc[700],
      subtle: zinc[800],
      focus: emerald[500],
    },
    text: {
      primary: zinc[100],
      secondary: zinc[400],
      tertiary: zinc[500],
      muted: zinc[600],
    },
    accent: {
      base: emerald[500],
      hover: emerald[600],
      glow: 'rgba(16, 185, 129, 0.2)',
      onAccent: '#ffffff',
    },
    status: {
      success: emerald[500],
      info: blue[500],
      warning: amber[500],
      error: red[500],
      onStatus: '#ffffff',
    },
    radius: {
      sm: 6,
      base: 8,
      lg: 12,
    },
    shadow: {
      sm: '0 1px 2px rgba(0, 0, 0, 0.28)',
      md: '0 8px 24px rgba(0, 0, 0, 0.32)',
      lg: '0 20px 48px rgba(0, 0, 0, 0.4)',
      glow: '0 0 0 1px rgba(16, 185, 129, 0.3), 0 0 24px rgba(16, 185, 129, 0.18)',
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
      onBg: 'rgba(255, 255, 255, 0.08)',
    },
  },
} satisfies Theme;

export default darkEmeraldTheme;
