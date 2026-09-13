import type { Theme } from '../types';
import { amber, blue, emerald, red, slate } from '../palettes';

export const darkBusinessTheme = {
  meta: {
    id: 'dark-business',
    name: '暗色商务',
    mode: 'dark',
    description: '以 slate 背景和 blue 主色构成的克制商务主题。',
  },
  tokens: {
    bg: {
      app: slate[950],
      surface: slate[900],
      elevated: slate[800],
      card: slate[900],
      hover: slate[700],
    },
    border: {
      base: slate[700],
      subtle: slate[800],
      focus: blue[500],
    },
    text: {
      primary: slate[100],
      secondary: slate[400],
      tertiary: slate[500],
      muted: slate[600],
    },
    accent: {
      base: blue[500],
      hover: blue[600],
      glow: 'rgba(59, 130, 246, 0.22)',
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
      sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
      md: '0 8px 24px rgba(0, 0, 0, 0.34)',
      lg: '0 20px 48px rgba(0, 0, 0, 0.42)',
      glow: '0 0 0 1px rgba(59, 130, 246, 0.3), 0 0 24px rgba(59, 130, 246, 0.2)',
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

export default darkBusinessTheme;
