import type { ReactNode } from 'react';
import type { ConfigProviderProps } from 'antd';

export interface SemanticTokens {
  bg: { app: string; surface: string; elevated: string; card: string; hover: string };
  border: { base: string; subtle: string; focus: string };
  text: { primary: string; secondary: string; tertiary: string; muted: string };
  /**
   * 品牌主色族：
   *  - base / hover：实色
   *  - glow：半透明光晕（按钮/标签底等）
   *  - onAccent：在 accent base / hover 实色上叠加的对比文字色
   *    （多数主题为 #fff，但浅色 accent 主题或高对比主题需要单独配置）
   */
  accent: { base: string; hover: string; glow: string; onAccent: string };
  /**
   * 状态色族：每档语义独立，加 onStatus 作为"状态实色背景上的文字色"。
   * 与 accent.onAccent 同理，多数主题为 #fff。
   */
  status: { success: string; info: string; warning: string; error: string; onStatus: string };
  radius: { sm: number; base: number; lg: number };
  shadow: { sm: string; md: string; lg: string; glow: string };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  z: { base: number; modal: number; dropdown: number; tooltip: number };
  overlay: { onBg: string };
}

export type ThemeMode = 'dark' | 'light';

export type ThemeId = string;

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  mode: ThemeMode;
  description?: string;
}

export interface Theme {
  meta: ThemeMeta;
  tokens: SemanticTokens;
}

export type ThemeRegistry = Record<string, Theme>;

export interface ThemePersistence {
  loadThemeId?: () => ThemeId | null | undefined;
  saveThemeId?: (themeId: ThemeId) => void;
}

export interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  antdTheme: import('antd').ThemeConfig;
  setTheme: (themeId: ThemeId) => void;
}

export interface ThemeProviderProps extends ThemePersistence {
  children: ReactNode;
  initialThemeId?: ThemeId;
  locale?: ConfigProviderProps['locale'];
}
