import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { themeToAntdConfig, themeToCssVars } from '../compile';
import { DEFAULT_THEME_ID, getThemeById, isThemeId } from '../themes';
import type { ThemeId, ThemeProviderProps } from '../types';
import { getFallbackThemeId, loadPersistedThemeId, savePersistedThemeId } from './persistence';
import { ThemeContext } from './useTheme';

function resolveInitialThemeId(props: ThemeProviderProps): ThemeId {
  const persisted = props.loadThemeId?.() ?? getFallbackThemeId();
  return persisted ?? props.initialThemeId ?? DEFAULT_THEME_ID;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const { children, locale, saveThemeId } = props;
  const [themeId, setThemeId] = useState<ThemeId>(() => resolveInitialThemeId(props));

  const theme = useMemo(() => getThemeById(themeId), [themeId]);
  const antdTheme = useMemo(() => themeToAntdConfig(theme.tokens, theme.meta.mode), [theme]);

  useEffect(() => {
    let disposed = false;

    loadPersistedThemeId().then((persistedThemeId) => {
      if (!disposed && isThemeId(persistedThemeId)) {
        setThemeId(persistedThemeId);
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const cssVars = themeToCssVars(theme.tokens);

    Object.entries(cssVars).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });

    root.dataset.theme = theme.meta.id;
    root.dataset.themeMode = theme.meta.mode;
  }, [theme]);

  const setTheme = useCallback(
    (nextThemeId: ThemeId) => {
      setThemeId(nextThemeId);
      saveThemeId?.(nextThemeId);
      void savePersistedThemeId(nextThemeId);
    },
    [saveThemeId],
  );

  const value = useMemo(
    () => ({
      theme,
      themeId,
      antdTheme,
      setTheme,
    }),
    [antdTheme, setTheme, theme, themeId],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={antdTheme} locale={locale ?? zhCN}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
