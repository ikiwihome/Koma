import type { SemanticTokens } from '../types';
import { tokenVarNames, type CssVarName } from './varNames';

export type CssVarMap = Record<CssVarName, string>;

function px(value: number): string {
  return `${value}px`;
}

export function themeToCssVars(tokens: SemanticTokens): CssVarMap {
  return {
    [tokenVarNames.bg.app]: tokens.bg.app,
    [tokenVarNames.bg.surface]: tokens.bg.surface,
    [tokenVarNames.bg.elevated]: tokens.bg.elevated,
    [tokenVarNames.bg.card]: tokens.bg.card,
    [tokenVarNames.bg.hover]: tokens.bg.hover,

    [tokenVarNames.border.base]: tokens.border.base,
    [tokenVarNames.border.subtle]: tokens.border.subtle,
    [tokenVarNames.border.focus]: tokens.border.focus,

    [tokenVarNames.text.primary]: tokens.text.primary,
    [tokenVarNames.text.secondary]: tokens.text.secondary,
    [tokenVarNames.text.tertiary]: tokens.text.tertiary,
    [tokenVarNames.text.muted]: tokens.text.muted,

    [tokenVarNames.accent.base]: tokens.accent.base,
    [tokenVarNames.accent.hover]: tokens.accent.hover,
    [tokenVarNames.accent.glow]: tokens.accent.glow,
    [tokenVarNames.accent.onAccent]: tokens.accent.onAccent,

    [tokenVarNames.status.success]: tokens.status.success,
    [tokenVarNames.status.info]: tokens.status.info,
    [tokenVarNames.status.warning]: tokens.status.warning,
    [tokenVarNames.status.error]: tokens.status.error,
    [tokenVarNames.status.onStatus]: tokens.status.onStatus,

    [tokenVarNames.radius.sm]: px(tokens.radius.sm),
    [tokenVarNames.radius.base]: px(tokens.radius.base),
    [tokenVarNames.radius.lg]: px(tokens.radius.lg),

    [tokenVarNames.shadow.sm]: tokens.shadow.sm,
    [tokenVarNames.shadow.md]: tokens.shadow.md,
    [tokenVarNames.shadow.lg]: tokens.shadow.lg,
    [tokenVarNames.shadow.glow]: tokens.shadow.glow,

    [tokenVarNames.space.xs]: px(tokens.space.xs),
    [tokenVarNames.space.sm]: px(tokens.space.sm),
    [tokenVarNames.space.md]: px(tokens.space.md),
    [tokenVarNames.space.lg]: px(tokens.space.lg),
    [tokenVarNames.space.xl]: px(tokens.space.xl),

    [tokenVarNames.z.base]: String(tokens.z.base),
    [tokenVarNames.z.modal]: String(tokens.z.modal),
    [tokenVarNames.z.dropdown]: String(tokens.z.dropdown),
    [tokenVarNames.z.tooltip]: String(tokens.z.tooltip),

    [tokenVarNames.overlay.onBg]: tokens.overlay.onBg,
  };
}
