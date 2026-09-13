const themeAuthorPath = /(?:^|\/)src\/theme\/(?:palettes|themes)\//u;
const tokenImportPath = /(?:^|\/)src\/theme\//u;

function getImportSource(node) {
  return typeof node.source?.value === 'string' ? node.source.value : '';
}

function isCssVarKey(node) {
  if (!node) return false;
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && node.value.startsWith('--');
  }
  if (node.type === 'TemplateLiteral') {
    return node.quasis[0]?.value?.cooked?.startsWith('--') === true;
  }
  return false;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current
    && (
      current.type === 'TSAsExpression'
      || current.type === 'TSTypeAssertion'
      || current.type === 'TSNonNullExpression'
    )
  ) {
    current = current.expression;
  }
  return current;
}

function validateStyleObject(node) {
  const expression = unwrapExpression(node);
  if (!expression || expression.type !== 'ObjectExpression') return false;
  return expression.properties.every((property) => {
    if (property.type === 'SpreadElement') return false;
    if (property.type !== 'Property') return false;
    return isCssVarKey(property.key);
  });
}

function containsCssVarsCall(node) {
  if (!node || typeof node !== 'object') return false;
  const expression = unwrapExpression(node);
  if (!expression || typeof expression !== 'object') return false;

  if (
    expression.type === 'CallExpression'
    && expression.callee?.type === 'Identifier'
    && expression.callee.name === 'cssVars'
  ) {
    return true;
  }

  switch (expression.type) {
    case 'CallExpression':
      return expression.arguments.some(argument => containsCssVarsCall(argument));
    case 'VariableDeclarator':
      return containsCssVarsCall(expression.init);
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'FunctionDeclaration':
      return containsCssVarsCall(expression.body);
    case 'BlockStatement':
    case 'Program':
      return expression.body.some(child => containsCssVarsCall(child));
    case 'ReturnStatement':
      return containsCssVarsCall(expression.argument);
    case 'ConditionalExpression':
      return containsCssVarsCall(expression.consequent) || containsCssVarsCall(expression.alternate);
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
      return containsCssVarsCall(expression.expression);
    default:
      return false;
  }
}

module.exports = {
  rules: {
    'forbid-inline-style-values': {
      meta: {
        type: 'problem',
        messages: {
          invalidStyle: 'Inline style may only be a CSS variable bridge; use cssVars({ "--token": value }) or move static styles to SCSS.',
        },
      },
      create(context) {
        const allowedStyleExpressions = new Set();

        function collectAllowedStyleExpressions(node) {
          const visited = new WeakSet();

          const visit = (current) => {
            if (!current || typeof current !== 'object') return;
            if (visited.has(current)) return;
            visited.add(current);

            if (current.type === 'VariableDeclarator') {
              if (
                current.id?.type === 'Identifier'
                && containsCssVarsCall(current.init)
              ) {
                allowedStyleExpressions.add(current.id.name);
              }
            }

            if (
              current.type === 'FunctionDeclaration'
              && current.id?.name
              && containsCssVarsCall(current.body)
            ) {
              allowedStyleExpressions.add(current.id.name);
            }

            for (const [key, value] of Object.entries(current)) {
              if (
                key === 'parent'
                || key === 'loc'
                || key === 'range'
                || key === 'tokens'
                || key === 'comments'
                || key === 'leadingComments'
                || key === 'trailingComments'
              ) {
                continue;
              }

              if (!value) continue;
              if (Array.isArray(value)) {
                value.forEach(visit);
                continue;
              }
              if (typeof value === 'object') {
                visit(value);
              }
            }
          };

          visit(node);
        }

        function isAllowedStyleExpression(node) {
          const expression = unwrapExpression(node);
          if (!expression) return false;

          if (validateStyleObject(expression)) {
            return true;
          }

          if (
            expression.type === 'CallExpression'
            && expression.callee?.type === 'Identifier'
            && (
              expression.callee.name === 'cssVars'
              || allowedStyleExpressions.has(expression.callee.name)
            )
          ) {
            return true;
          }

          if (expression.type === 'Identifier') {
            return allowedStyleExpressions.has(expression.name);
          }

          if (expression.type === 'ConditionalExpression') {
            return isAllowedStyleExpression(expression.consequent)
              && (
                isAllowedStyleExpression(expression.alternate)
                || expression.alternate.type === 'Identifier' && expression.alternate.name === 'undefined'
                || expression.alternate.type === 'Literal' && expression.alternate.value === null
              );
          }

          return false;
        }

        return {
          Program: collectAllowedStyleExpressions,
          JSXAttribute(node) {
            if (node.name?.name !== 'style') return;
            const expression = node.value?.expression;
            if (!expression) return;

            if (isAllowedStyleExpression(expression)) {
              return;
            }

            context.report({ node, messageId: 'invalidStyle' });
          },
        };
      },
    },
    'forbid-business-tokens-import': {
      meta: {
        type: 'problem',
        messages: {
          tokensImport: 'Business code must not import theme/tokens directly; use CSS variables or useThemeValue().',
        },
      },
      create(context) {
        const filename = context.getFilename().replaceAll('\\', '/');
        return {
          ImportDeclaration(node) {
            if (tokenImportPath.test(filename)) return;
            if (getImportSource(node).includes('/theme/tokens')) {
              context.report({ node, messageId: 'tokensImport' });
            }
          },
        };
      },
    },
    'forbid-dark-flag-literal': {
      meta: {
        type: 'problem',
        messages: {
          darkFlag: 'Do not hard-code dark mode flags; derive them from useTheme().theme.meta.mode.',
        },
      },
      create(context) {
        return {
          JSXAttribute(node) {
            const name = node.name?.name;
            if (name === 'colorMode' && node.value?.type === 'Literal' && node.value.value === 'dark') {
              context.report({ node, messageId: 'darkFlag' });
            }
            if (name === 'darkTheme') {
              if (!node.value) {
                context.report({ node, messageId: 'darkFlag' });
              }
              if (
                node.value?.type === 'JSXExpressionContainer'
                && node.value.expression?.type === 'Literal'
                && node.value.expression.value === true
              ) {
                context.report({ node, messageId: 'darkFlag' });
              }
            }
          },
          Property(node) {
            if (node.key?.name !== 'darkTheme') return;
            if (node.value?.type === 'Literal' && node.value.value === true) {
              context.report({ node, messageId: 'darkFlag' });
            }
          },
        };
      },
    },
    'forbid-business-color-literals': {
      meta: {
        type: 'problem',
        messages: {
          colorLiteral: 'Business UI code must not add color literals outside theme author files.',
        },
      },
      create(context) {
        const filename = context.getFilename().replaceAll('\\', '/');
        if (themeAuthorPath.test(filename)) {
          return {};
        }

        function checkString(node, value) {
          if (/#(?:[0-9a-fA-F]{3,8})\b|rgba?\(|hsla?\(/u.test(value)) {
            context.report({ node, messageId: 'colorLiteral' });
          }
        }

        return {
          Literal(node) {
            if (typeof node.value === 'string') {
              checkString(node, node.value);
            }
          },
          TemplateElement(node) {
            checkString(node, node.value.raw);
          },
        };
      },
    },
  },
};
