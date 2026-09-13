import type { Theme, ThemeId, ThemeRegistry } from '../types';

export const DEFAULT_THEME_ID = 'light-business';

const themeModules = import.meta.glob<Theme>(['./*.ts', '!./index.ts'], {
  eager: true,
  import: 'default',
});

const registeredThemes = Object.values(themeModules)
  .filter((theme): theme is Theme => Boolean(theme?.meta?.id));

export const themes = registeredThemes.reduce<ThemeRegistry>((registry, theme) => {
  registry[theme.meta.id] = theme;
  return registry;
}, {});

export const themeIds = registeredThemes.map(theme => theme.meta.id);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && value in themes;
}

export function getThemeById(themeId: ThemeId): Theme {
  return themes[themeId] ?? themes[DEFAULT_THEME_ID];
}
