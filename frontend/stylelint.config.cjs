module.exports = {
  customSyntax: 'postcss-scss',
  plugins: ['stylelint-scss'],
  ignoreFiles: [
    'dist/**/*',
    'node_modules/**/*',
    'src/index.scss',
  ],
  rules: {
    'color-no-hex': true,
    'declaration-property-value-disallowed-list': {
      '/.*/': [/#(?:[0-9a-fA-F]{3,8})\b/, /rgba?\(/i, /hsla?\(/i],
    },
  },
};
