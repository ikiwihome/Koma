# Theme Development Guide

This guide is the day-to-day companion for `THEME_ARCHITECTURE.md`.

## Add A Theme

1. Add one file in `frontend/src/theme/themes/`.
2. Export a `Theme` object with complete `SemanticTokens`.
3. Default-export the same `Theme` object.

`frontend/src/theme/themes/index.ts` discovers `themes/*.ts` with
`import.meta.glob`, so adding a preset does not require editing a central
registry. The Settings theme cards derive names, descriptions, and swatches
from discovered theme metadata. Do not add a second list of color values in
Settings.

## Add A Token

1. Add the field to `SemanticTokens` in `frontend/src/theme/types.ts`.
2. Add its CSS variable name in `frontend/src/theme/compile/varNames.ts`.
3. Add it to `themeToCssVars`.
4. Fill the field in every theme file.
5. Consume it as `var(--token-...)` in SCSS or `useThemeValue(...)` in JS.

## Style Rules

- Custom styles live in `.scss` or `.module.scss`.
- JSX layout can use Tailwind semantic utilities such as `bg-bg-app`,
  `text-text-primary`, `border-border-subtle`, and `bg-accent`.
- Business files must not import `theme/tokens` directly.
- Business files must not contain `#hex`, `rgb()`, `rgba()`, or `hsl()` UI
  color literals.
- `style={{}}` is only allowed for CSS variable bridges where every key starts
  with `--`.
- Third-party CSS imports are allowed only when listed in
  `frontend/scripts/check-style-discipline.ts`.

## Dynamic Values

Use CSS variable bridges:

```tsx
import { cssVars } from '@/theme/runtime';

<div
  className={styles.progress}
  style={cssVars({ '--progress': `${progress}%` })}
/>
```

```scss
.progress {
  width: var(--progress);
  background: var(--token-accent-base);
}
```

Do not pass layout or color values directly through inline style.

## Validation

Run these before merging theme work:

```bash
cd frontend
npm run lint:theme
npm run build
```

Useful spot checks:

```bash
find src -type f \( -name '*.css' -o -name '*.module.css' \)
rg 'darkTheme=\{true\}|colorMode="dark"' src -g '*.ts' -g '*.tsx'
rg '(?:bg|text|border|shadow|from|to|via|ring|outline)-\[#' src -g '*.ts' -g '*.tsx'
```
