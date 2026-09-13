import { createContext, useContext } from 'react';
import { DEFAULT_THEME_ID, getThemeById } from '../themes';
import { themeToAntdConfig } from '../compile';
import type { ThemeContextValue } from '../types';

const defaultTheme = getThemeById(DEFAULT_THEME_ID);

export const ThemeContext = createContext<ThemeContextValue>({
  theme: defaultTheme,
  themeId: DEFAULT_THEME_ID,
  antdTheme: themeToAntdConfig(defaultTheme.tokens, defaultTheme.meta.mode),
  setTheme: () => undefined,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
