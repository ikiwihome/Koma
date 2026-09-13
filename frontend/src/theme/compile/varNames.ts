export const TOKEN_VAR_PREFIX = '--token-' as const;

export const tokenVarNames = {
  bg: {
    app: '--token-bg-app',
    surface: '--token-bg-surface',
    elevated: '--token-bg-elevated',
    card: '--token-bg-card',
    hover: '--token-bg-hover',
  },
  border: {
    base: '--token-border-base',
    subtle: '--token-border-subtle',
    focus: '--token-border-focus',
  },
  text: {
    primary: '--token-text-primary',
    secondary: '--token-text-secondary',
    tertiary: '--token-text-tertiary',
    muted: '--token-text-muted',
  },
  accent: {
    base: '--token-accent-base',
    hover: '--token-accent-hover',
    glow: '--token-accent-glow',
    onAccent: '--token-on-accent',
  },
  status: {
    success: '--token-status-success',
    info: '--token-status-info',
    warning: '--token-status-warning',
    error: '--token-status-error',
    onStatus: '--token-on-status',
  },
  radius: {
    sm: '--token-radius-sm',
    base: '--token-radius-base',
    lg: '--token-radius-lg',
  },
  shadow: {
    sm: '--token-shadow-sm',
    md: '--token-shadow-md',
    lg: '--token-shadow-lg',
    glow: '--token-shadow-glow',
  },
  space: {
    xs: '--token-space-xs',
    sm: '--token-space-sm',
    md: '--token-space-md',
    lg: '--token-space-lg',
    xl: '--token-space-xl',
  },
  z: {
    base: '--token-z-base',
    modal: '--token-z-modal',
    dropdown: '--token-z-dropdown',
    tooltip: '--token-z-tooltip',
  },
  overlay: {
    onBg: '--token-overlay-on-bg',
  },
} as const;

export type CssVarName = {
  [K in keyof typeof tokenVarNames]: (typeof tokenVarNames)[K][keyof (typeof tokenVarNames)[K]];
}[keyof typeof tokenVarNames];
