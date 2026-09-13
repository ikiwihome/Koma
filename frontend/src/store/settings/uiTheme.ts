import type { AppThemeId } from '../../types';
import { DEFAULT_THEME_ID, themes, themeIds } from '../../theme/themes';

export const DEFAULT_APP_THEME_ID: AppThemeId = DEFAULT_THEME_ID;

export interface AppThemeOption {
  id: AppThemeId;
  name: string;
  description: string;
  swatches: string[];
}

export const APP_THEME_OPTIONS: AppThemeOption[] = themeIds.map((id) => {
  const theme = themes[id];

  return {
    id,
    name: theme.meta.name,
    description: theme.meta.description ?? theme.meta.name,
    swatches: [
      theme.tokens.bg.app,
      theme.tokens.bg.surface,
      theme.tokens.accent.base,
      theme.tokens.text.primary,
    ],
  };
});

export function normalizeAppThemeId(uiThemeId?: string): AppThemeId {
  return APP_THEME_OPTIONS.some(theme => theme.id === uiThemeId)
    ? uiThemeId as AppThemeId
    : DEFAULT_APP_THEME_ID;
}
