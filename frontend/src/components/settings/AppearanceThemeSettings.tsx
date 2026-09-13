import React, { useCallback } from 'react';
import { App, Card } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import type { AppSettings, AppThemeId } from '../../types';
import {
  APP_THEME_OPTIONS,
  normalizeAppThemeId,
  saveSettings,
} from '../../store/globalStore';
import { cssVars, useTheme } from '../../theme/runtime';

interface AppearanceThemeSettingsProps {
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
}

export const AppearanceThemeSettings: React.FC<AppearanceThemeSettingsProps> = ({
  settings,
  onSave,
}) => {
  const { message } = App.useApp();
  const { themeId: runtimeThemeId, setTheme } = useTheme();
  const activeThemeId = normalizeAppThemeId(settings.uiThemeId ?? runtimeThemeId);

  const handleSelectTheme = useCallback(async (themeId: AppThemeId) => {
    if (themeId === activeThemeId) return;

    const nextSettings: AppSettings = {
      ...settings,
      uiThemeId: themeId,
    };

    onSave(nextSettings);
    setTheme(themeId);

    try {
      await saveSettings(nextSettings);
      message.success('主题已切换');
    } catch {
      onSave(settings);
      setTheme(activeThemeId);
      message.error('主题设置保存失败');
    }
  }, [activeThemeId, message, onSave, setTheme, settings]);

  return (
    <div className="settings-manager settings-appearance-theme">
      <Card
        size="small"
        title="应用主题"
        className="settings-config-card"
      >
        <div className="settings-theme-grid">
          {APP_THEME_OPTIONS.map(theme => {
            const isActive = activeThemeId === theme.id;

            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => void handleSelectTheme(theme.id)}
                className={`settings-theme-card${isActive ? ' is-active' : ''}`}
              >
                {isActive && (
                  <span className="settings-theme-check">
                    <CheckOutlined />
                  </span>
                )}

                <div className="settings-theme-swatches">
                  {theme.swatches.map((color, index) => (
                    <span
                      key={color}
                      className="settings-theme-swatch"
                      style={cssVars({
                        [`--swatch-${index}`]: color,
                      })}
                    />
                  ))}
                </div>

                <div>
                  <div className="settings-theme-name">
                    {theme.name}
                  </div>
                  <div className="settings-theme-desc">
                    {theme.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default AppearanceThemeSettings;
