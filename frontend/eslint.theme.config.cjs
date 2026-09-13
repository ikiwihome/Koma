const tsParser = require('@typescript-eslint/parser');
const komaThemeDiscipline = require('./eslint-plugin-koma-theme-discipline/index.cjs');

module.exports = [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
      'src/components/chat/ChatPromptEditor.tsx',
      'src/hooks/useTasks.ts',
      'src/hooks/useChannelChangesVersion.ts',
      'src/providers/tti/GeminiNativeTTIProvider.ts',
      'src/services/simpleExportRenderer.ts',
      'src/types/editor.ts',
      'src/components/common/AppLogo.tsx',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'koma-theme-discipline': komaThemeDiscipline,
    },
    rules: {
      'koma-theme-discipline/forbid-inline-style-values': 'error',
      'koma-theme-discipline/forbid-business-tokens-import': 'error',
      'koma-theme-discipline/forbid-dark-flag-literal': 'error',
    },
  },
];
