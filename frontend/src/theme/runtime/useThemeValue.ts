import type { SemanticTokens } from '../types';
import { useTheme } from './useTheme';

export function useThemeValue<K extends keyof SemanticTokens, P extends keyof SemanticTokens[K]>(
  scope: K,
  key: P,
): SemanticTokens[K][P] {
  const { theme } = useTheme();
  return theme.tokens[scope][key];
}
