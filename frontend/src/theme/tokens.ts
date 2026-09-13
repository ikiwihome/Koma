import { DEFAULT_THEME_ID, getThemeById } from './themes';

const defaultTokens = getThemeById(DEFAULT_THEME_ID).tokens;

export const tokens = {
  colors: {
    bg: defaultTokens.bg,
    border: defaultTokens.border,
    text: defaultTokens.text,
    accent: defaultTokens.accent,
    status: defaultTokens.status,
  },
  layout: {
    sidebarWidth: 72,
    headerHeight: 56,
    headerHeightLg: 64,
  },
  radius: defaultTokens.radius,
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: {
      xs: 12,
      sm: 13,
      base: 14,
      lg: 16,
      xl: 18,
    },
  },
} as const;
