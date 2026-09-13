import type { CSSProperties } from 'react';

export type CssVarStyle = Record<`--${string}`, string | number | undefined>;

export function cssVars(vars: CssVarStyle): CSSProperties {
  return vars as CSSProperties;
}
