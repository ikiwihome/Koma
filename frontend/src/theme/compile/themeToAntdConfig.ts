import { theme as antdThemeAlgorithms } from 'antd';
import type { ThemeConfig } from 'antd';
import type { SemanticTokens, ThemeMode } from '../types';

export function themeToAntdConfig(tokens: SemanticTokens, mode: ThemeMode): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? antdThemeAlgorithms.darkAlgorithm : antdThemeAlgorithms.defaultAlgorithm,
    token: {
      colorPrimary: tokens.accent.base,
      colorSuccess: tokens.status.success,
      colorInfo: tokens.status.info,
      colorWarning: tokens.status.warning,
      colorError: tokens.status.error,

      // **不**覆盖 colorTextLightSolid（Antd 默认 '#fff'）。
      // 这个 token 同时影响 Antd Tooltip / Notification / Message 等"反向高对比"组件——
      // 它们的背景固定深色，文字必须是 '#fff' 才可读。如果跟 accent.onAccent 绑定，
      // 在 high-contrast 主题（onAccent='#000'）下会把 Tooltip 文字也改成黑色，黑底黑字看不见。
      // 需要的"实色 accent 背景上的对比文字"通过 Tailwind class `text-on-accent` 走 CSS 变量解决，
      // 不混入 Antd 全局 token。

      colorBgContainer: tokens.bg.surface,
      colorBgElevated: tokens.bg.elevated,
      colorBgLayout: tokens.bg.app,
      // **不**覆盖 colorBgSpotlight。Antd Tooltip 默认走"反向高对比"：light → 黑底白字、dark → 略亮深底白字。
      // 之前覆盖成 bg.elevated（亮主题下 ≈ 极浅白），与默认白色 colorTextLightSolid 形成"浅白底+白字"，
      // 所有 Tooltip 在亮主题下完全不可读。

      colorBorder: tokens.border.base,
      colorBorderSecondary: tokens.border.subtle,

      colorText: tokens.text.primary,
      colorTextSecondary: tokens.text.secondary,
      colorTextTertiary: tokens.text.tertiary,
      colorTextQuaternary: tokens.text.muted,

      borderRadius: tokens.radius.base,
      borderRadiusLG: tokens.radius.lg,
      borderRadiusSM: tokens.radius.sm,

      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: tokens.shadow.md,
      boxShadowSecondary: tokens.shadow.sm,
    },
    components: {
      Card: {
        colorBgContainer: tokens.bg.surface,
      },
      Modal: {
        contentBg: tokens.bg.surface,
        headerBg: tokens.bg.surface,
        colorBgElevated: tokens.bg.surface,
      },
      Dropdown: {
        colorBgElevated: tokens.bg.elevated,
        zIndexPopup: tokens.z.dropdown,
      },
      Menu: {
        colorBgContainer: 'transparent',
        itemSelectedBg: tokens.accent.glow,
        itemSelectedColor: tokens.accent.base,
        itemHoverBg: tokens.bg.hover,
      },
      Input: {
        colorBgContainer: tokens.bg.elevated,
        colorBorder: tokens.border.base,
        hoverBorderColor: tokens.accent.base,
        activeBorderColor: tokens.accent.base,
      },
      Select: {
        colorBgContainer: tokens.bg.elevated,
        colorBgElevated: tokens.bg.elevated,
        optionSelectedBg: tokens.accent.glow,
      },
      Button: {
        primaryShadow: 'none',
        defaultBorderColor: tokens.border.base,
      },
      Tabs: {
        colorBgContainer: 'transparent',
        itemSelectedColor: tokens.accent.base,
        inkBarColor: tokens.accent.base,
      },
      Tooltip: {
        // **不要**覆盖 colorBgSpotlight。
        // Antd Tooltip 默认走"反向高对比"：light algorithm → 深色底+白字，dark algorithm → 略亮深色+白字。
        // 之前把 colorBgSpotlight 覆盖成 bg.elevated（亮主题下 = 极浅白），与默认白色 colorTextLightSolid
        // 形成"白底白字"，所有 Tooltip 不可读。
        zIndexPopup: tokens.z.tooltip,
      },
      Popover: {
        colorBgElevated: tokens.bg.elevated,
        zIndexPopup: tokens.z.dropdown,
      },
      Drawer: {
        colorBgElevated: tokens.bg.surface,
        zIndexPopup: tokens.z.modal,
      },
      Table: {
        colorBgContainer: tokens.bg.surface,
        headerBg: tokens.bg.elevated,
      },
      Form: {
        labelColor: tokens.text.primary,
      },
      Tag: {
        colorBgContainer: tokens.bg.elevated,
      },
      Spin: {
        colorPrimary: tokens.accent.base,
      },
      Empty: {
        colorText: tokens.text.muted,
        colorTextDescription: tokens.text.muted,
      },
      Progress: {
        defaultColor: tokens.accent.base,
      },
      Segmented: {
        colorBgLayout: tokens.bg.elevated,
        itemSelectedBg: tokens.bg.surface,
      },
      // 主题适配补全 —— 这些组件在亮/暗主题下默认色差异大，必须显式接 token
      Alert: {
        colorInfoBg: 'transparent',
        colorSuccessBg: 'transparent',
        colorWarningBg: 'transparent',
        colorErrorBg: 'transparent',
        // Alert 用 status 色画底色 + 边框；让 description 跟 secondary
        colorTextDescription: tokens.text.secondary,
      },
      Notification: {
        colorBgElevated: tokens.bg.elevated,
        zIndexPopup: tokens.z.tooltip,
      },
      Message: {
        colorBgElevated: tokens.bg.elevated,
        zIndexPopup: tokens.z.tooltip,
      },
      Steps: {
        // Steps 进度状态色：当前/已完成 = accent；待办 = muted
        colorPrimary: tokens.accent.base,
      },
      // 撤销 Switch.colorTextLightSolid 覆盖；Antd Switch 内部圆点用 #fff 默认即可
      Slider: {
        // 拉条颜色对齐 accent；轨道色用 hover bg
        railBg: tokens.bg.hover,
        railHoverBg: tokens.bg.hover,
        trackBg: tokens.accent.base,
        trackHoverBg: tokens.accent.hover,
        handleColor: tokens.accent.base,
        handleActiveColor: tokens.accent.hover,
        dotBorderColor: tokens.border.base,
        dotActiveBorderColor: tokens.accent.base,
      },
      Radio: {
        buttonSolidCheckedBg: tokens.accent.base,
        buttonSolidCheckedHoverBg: tokens.accent.hover,
        // Radio Button solid 选中：实色 accent 上的文字必须是 onAccent
        // （它是 Antd 单组件 token，不污染全局 colorTextLightSolid）
        buttonSolidCheckedColor: tokens.accent.onAccent,
      },
      Checkbox: {
        colorBgContainer: tokens.bg.elevated,
      },
      DatePicker: {
        colorBgContainer: tokens.bg.elevated,
        colorBgElevated: tokens.bg.elevated,
      },
      InputNumber: {
        colorBgContainer: tokens.bg.elevated,
      },
      Pagination: {
        colorBgContainer: tokens.bg.elevated,
        itemActiveBg: tokens.accent.glow,
      },
      Anchor: {
        colorPrimary: tokens.accent.base,
      },
      Collapse: {
        colorBgContainer: tokens.bg.surface,
        headerBg: tokens.bg.elevated,
      },
      Divider: {
        colorSplit: tokens.border.subtle,
      },
      List: {
        colorBgContainer: 'transparent',
        itemPaddingSM: '8px 12px',
      },
    },
  };
}
