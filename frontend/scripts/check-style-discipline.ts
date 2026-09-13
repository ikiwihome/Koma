import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type Finding = {
  file: string;
  line: number;
  text: string;
};

type CheckResult = {
  name: string;
  findings: Finding[];
  budget?: number;
};

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

const THIRD_PARTY_CSS_IMPORTS = new Set([
  'ds-markdown/style.css',
  'xgplayer/dist/index.min.css',
  '@xyflow/react/dist/style.css',
]);

const BUSINESS_COLOR_BUDGET = 0;

const COLOR_LITERAL_EXCEPTION_PATHS = [
  'src/components/common/AppLogo.tsx',
  'src/engine/simpleEngine.ts',
  'src/services/draftExport/JianyingExporter.ts',
  'src/services/simpleExportRenderer.ts',
];

const INLINE_STYLE_EXPRESSION_EXCEPTIONS = new Set<string>([]);

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      walk(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function toRepoPath(file: string): string {
  return relative(ROOT, file).replaceAll('\\', '/');
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function collectLineRegex(files: string[], pattern: RegExp, skip?: (file: string) => boolean): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    if (skip?.(file)) {
      continue;
    }

    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) {
        continue;
      }
      const line = lineNumber(content, match.index);
      findings.push({
        file: toRepoPath(file),
        line,
        text: content.split('\n')[line - 1]?.trim() ?? '',
      });
    }
  }

  return findings;
}

function collectInlineStyleLiterals(files: string[]): Finding[] {
  const findings: Finding[] = [];
  const styleObjectPattern = /style\s*=\s*\{\s*\{([^{}]*)\}\s*(?:as\s+[A-Za-z0-9_.]+)?\}/g;
  const styleAttributePattern = /(?<![\w-])style\s*=\s*\{/g;

  function splitTopLevelEntries(body: string): string[] {
    const entries: string[] = [];
    let start = 0;
    let depth = 0;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;

    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
        continue;
      }

      if (char === ')' || char === ']' || char === '}') {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (char === ',' && depth === 0) {
        entries.push(body.slice(start, index).trim());
        start = index + 1;
      }
    }

    entries.push(body.slice(start).trim());
    return entries.filter(Boolean);
  }

  function findTopLevelColon(entry: string): number {
    let depth = 0;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;

    for (let index = 0; index < entry.length; index += 1) {
      const char = entry[index];

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
        continue;
      }

      if (char === ')' || char === ']' || char === '}') {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (char === ':' && depth === 0) {
        return index;
      }
    }

    return -1;
  }

  function normalizePropertyKey(rawKey: string): string {
    let key = rawKey.trim();

    if (key.startsWith('[') && key.endsWith(']')) {
      key = key.slice(1, -1).trim();
    }

    key = key.replace(/\s+as\s+[A-Za-z0-9_.]+$/u, '').trim();

    return key.replace(/^['"]|['"]$/g, '');
  }

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const allowedStyleIdentifiers = new Set<string>();
    const allowedIdentifierPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useMemo\s*\([\s\S]{0,80})?cssVars\s*\(/g;
    const allowedConditionalIdentifierPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*useMemo\s*\([\s\S]{0,140}\?\s*cssVars\s*\(/g;
    const allowedFunctionPattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]{0,260}\breturn\s+cssVars\s*\(/g;

    for (const match of content.matchAll(allowedIdentifierPattern)) {
      const identifier = match[1];
      if (identifier) {
        allowedStyleIdentifiers.add(identifier);
      }
    }

    for (const match of content.matchAll(allowedConditionalIdentifierPattern)) {
      const identifier = match[1];
      if (identifier) {
        allowedStyleIdentifiers.add(identifier);
      }
    }

    for (const match of content.matchAll(allowedFunctionPattern)) {
      const identifier = match[1];
      if (identifier) {
        allowedStyleIdentifiers.add(identifier);
      }
    }

    for (const styleMatch of content.matchAll(styleObjectPattern)) {
      const body = styleMatch[1] ?? '';
      const badKeys = splitTopLevelEntries(body).map((entry) => {
        if (entry.startsWith('...')) {
          return entry;
        }
        const colonIndex = findTopLevelColon(entry);
        if (colonIndex < 0) {
          return entry;
        }
        const key = normalizePropertyKey(entry.slice(0, colonIndex));
        return key.startsWith('--') ? '' : key;
      }).filter(Boolean);

      if (badKeys.length === 0) {
        continue;
      }

      const index = styleMatch.index ?? 0;
      const line = lineNumber(content, index);
      findings.push({
        file: toRepoPath(file),
        line,
        text: `inline style keys: ${[...new Set(badKeys)].join(', ')}`,
      });
    }

    for (const styleMatch of content.matchAll(styleAttributePattern)) {
      const expressionStart = (styleMatch.index ?? 0) + styleMatch[0].length;
      const expressionEnd = findMatchingBrace(content, expressionStart - 1);
      if (expressionEnd < 0) {
        const line = lineNumber(content, styleMatch.index ?? 0);
        findings.push({
          file: toRepoPath(file),
          line,
          text: 'inline style expression could not be parsed',
        });
        continue;
      }

      const expression = content.slice(expressionStart, expressionEnd).trim();
      const line = lineNumber(content, styleMatch.index ?? 0);
      const exceptionKey = `${toRepoPath(file)}:${line}`;

      if (INLINE_STYLE_EXPRESSION_EXCEPTIONS.has(exceptionKey)) {
        continue;
      }
      if (expression.startsWith('{')) {
        continue;
      }
      if (expression.startsWith('cssVars(')) {
        continue;
      }
      if (expression === 'undefined' || expression === 'null') {
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(expression) && allowedStyleIdentifiers.has(expression)) {
        continue;
      }
      if (/^[A-Za-z_$][\w$]*\([^)]*\)$/.test(expression) && allowedStyleIdentifiers.has(expression.split('(')[0] ?? '')) {
        continue;
      }
      if (/^[A-Za-z_$][\w$]*\s*\?\s*cssVars\(/.test(expression)) {
        continue;
      }

      findings.push({
        file: toRepoPath(file),
        line,
        text: `inline style expression must be cssVars(...) or documented exception: ${expression.slice(0, 80)}`,
      });
    }
  }

  return findings;
}

function findMatchingBrace(content: string, openingBraceIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let index = openingBraceIndex; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function collectCssImportViolations(files: string[]): Finding[] {
  const findings: Finding[] = [];
  const importPattern = /import(?:\s+[^'";]+?\s+from\s+|\s+)['"]([^'"]+\.css)['"]/g;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1] ?? '';
      if (THIRD_PARTY_CSS_IMPORTS.has(specifier)) {
        continue;
      }

      const line = lineNumber(content, match.index ?? 0);
      findings.push({
        file: toRepoPath(file),
        line,
        text: content.split('\n')[line - 1]?.trim() ?? '',
      });
    }
  }

  return findings;
}

function isThemeAuthorFile(file: string): boolean {
  const repoPath = toRepoPath(file);
  return repoPath.startsWith('src/theme/palettes/')
    || repoPath.startsWith('src/theme/themes/');
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(file);
}

function isColorLiteralExceptionFile(file: string): boolean {
  const repoPath = toRepoPath(file);
  return COLOR_LITERAL_EXCEPTION_PATHS.includes(repoPath);
}

function isThemeFallbackSnapshot(file: string, finding: Finding): boolean {
  return finding.file === 'src/index.scss' && finding.line >= 38 && finding.line <= 88;
}

function printResults(results: CheckResult[]): number {
  let failed = false;

  for (const result of results) {
    const count = result.findings.length;
    const budget = result.budget ?? 0;
    const passed = count <= budget;
    const suffix = budget > 0 ? ` (budget ${budget})` : '';
    console.log(`${passed ? 'PASS' : 'FAIL'} ${result.name}: ${count}${suffix}`);

    if (!passed) {
      failed = true;
      for (const finding of result.findings.slice(0, 40)) {
        console.log(`  ${finding.file}:${finding.line} ${finding.text}`);
      }
      if (count > 40) {
        console.log(`  ... ${count - 40} more`);
      }
    }
  }

  return failed ? 1 : 0;
}

const allFiles = walk(SRC_DIR);
const tsFiles = allFiles.filter(file => /\.[jt]sx?$/.test(file));
const tsxFiles = allFiles.filter(file => /\.tsx$/.test(file));
const scssFiles = allFiles.filter(file => /\.s?css$/.test(file));

const plainCssFiles = allFiles
  .filter(file => file.endsWith('.css') || file.endsWith('.module.css'))
  .map(file => ({ file: toRepoPath(file), line: 1, text: 'plain CSS file' }));

const scssHardcodedColors = collectLineRegex(
  scssFiles,
  /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/g,
  isThemeAuthorFile,
).filter(finding => !isThemeFallbackSnapshot(join(ROOT, finding.file), finding));

const businessHardcodedColors = collectLineRegex(
  tsFiles,
  /#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/g,
  file => isThemeAuthorFile(file) || isTestFile(file) || isColorLiteralExceptionFile(file),
);

const results: CheckResult[] = [
  { name: 'plain-css-files', findings: plainCssFiles },
  { name: 'project-css-imports', findings: collectCssImportViolations(tsFiles) },
  { name: 'inline-style-literals', findings: collectInlineStyleLiterals(tsxFiles) },
  {
    name: 'tailwind-arbitrary-hex',
    findings: collectLineRegex(
      tsFiles,
      /(?:bg|text|border|shadow|from|to|via|ring|outline)-\[#(?:[0-9a-fA-F]{3,8})\]/g,
    ),
  },
  {
    name: 'dark-flag-literals',
    findings: collectLineRegex(
      tsFiles,
      /colorMode="dark"|darkTheme=\{true\}|darkTheme\s*:\s*true|<[^>\n]+\sdarkTheme(?:\s|>|\/)/g,
    ),
  },
  {
    name: 'business-tokens-import',
    findings: collectLineRegex(
      tsFiles,
      /from\s+['"][^'"]*\/theme\/tokens['"]/g,
      file => toRepoPath(file).startsWith('src/theme/'),
    ),
  },
  { name: 'scss-hardcoded-colors', findings: scssHardcodedColors },
  { name: 'business-hardcoded-colors', findings: businessHardcodedColors, budget: BUSINESS_COLOR_BUDGET },
];

process.exitCode = printResults(results);
