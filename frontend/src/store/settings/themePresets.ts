/**
 * 自定义视觉风格预设 CRUD
 */
import { loadSettings, saveSettings } from './core';
import type { ThemePreset } from '../../types';

export async function getCustomThemePresets(): Promise<ThemePreset[]> {
  const settings = await loadSettings();
  return settings.customThemePresets || [];
}

export async function addCustomThemePreset(
  preset: Omit<ThemePreset, 'id'>
): Promise<ThemePreset> {
  const settings = await loadSettings();
  const newPreset: ThemePreset = {
    ...preset,
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  };

  if (!settings.customThemePresets) {
    settings.customThemePresets = [];
  }
  settings.customThemePresets.push(newPreset);
  await saveSettings(settings);
  return newPreset;
}

export async function updateCustomThemePreset(
  id: string,
  updates: Partial<Omit<ThemePreset, 'id'>>
): Promise<ThemePreset | null> {
  const settings = await loadSettings();
  if (!settings.customThemePresets) return null;

  const index = settings.customThemePresets.findIndex((p) => p.id === id);
  if (index === -1) return null;

  settings.customThemePresets[index] = {
    ...settings.customThemePresets[index],
    ...updates,
  };
  await saveSettings(settings);
  return settings.customThemePresets[index];
}

export async function deleteCustomThemePreset(id: string): Promise<boolean> {
  const settings = await loadSettings();
  if (!settings.customThemePresets) return false;

  const index = settings.customThemePresets.findIndex((p) => p.id === id);
  if (index === -1) return false;

  settings.customThemePresets.splice(index, 1);
  await saveSettings(settings);
  return true;
}
