import { themeToAntdConfig } from './compile';
import { DEFAULT_THEME_ID, getThemeById } from './themes';

const defaultTheme = getThemeById(DEFAULT_THEME_ID);

export const antdTheme = themeToAntdConfig(defaultTheme.tokens, defaultTheme.meta.mode);
