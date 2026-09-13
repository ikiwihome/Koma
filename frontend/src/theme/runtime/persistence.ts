import { loadSettings, saveSettings } from '../../store/settings/core';
import { DEFAULT_APP_THEME_ID, normalizeAppThemeId } from '../../store/settings/uiTheme';
import type { ThemeId } from '../types';

const LEGACY_STORAGE_KEY = 'koma.themeId';

function readLegacyLocalStorage(): ThemeId | null {
  if (typeof window === 'undefined') return null;
  return normalizeAppThemeId(window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? undefined);
}

export function getFallbackThemeId(): ThemeId {
  return readLegacyLocalStorage() ?? DEFAULT_APP_THEME_ID;
}

export async function loadPersistedThemeId(): Promise<ThemeId> {
  try {
    const settings = await loadSettings();
    return normalizeAppThemeId(settings.uiThemeId);
  } catch {
    return getFallbackThemeId();
  }
}

export async function savePersistedThemeId(themeId: ThemeId): Promise<void> {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, themeId);
  }

  const settings = await loadSettings();
  await saveSettings({
    ...settings,
    uiThemeId: themeId,
  });
}
