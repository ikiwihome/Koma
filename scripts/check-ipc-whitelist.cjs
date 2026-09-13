#!/usr/bin/env node
/**
 * IPC 白名单对账：electron/controller/*.ts 中暴露的 method 与
 * electron/preload/bridge.ts 中 ALLOWED_INVOKE_CHANNELS 的 controller/* 项是否一致。
 *
 * 约定：electron-egg 把 controller 类/对象的 method 自动暴露为
 *   controller/<file-stem>/<method-name>
 *
 * 校验项：
 *  1. 每个 controller method 都应在 ALLOWED_INVOKE_CHANNELS 出现
 *  2. ALLOWED_INVOKE_CHANNELS 中以 controller/ 开头的项都应有对应 method
 *
 * 失败时返回非零退出码。
 *
 * 用法：node scripts/check-ipc-whitelist.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTROLLER_DIR = path.join(ROOT, 'electron/controller');
const PRELOAD_FILE = path.join(ROOT, 'electron/preload/bridge.ts');

// 不对外暴露的文件
const NON_CONTROLLER_FILES = new Set(['base.ts']);

function listControllerFiles() {
  return fs
    .readdirSync(CONTROLLER_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !NON_CONTROLLER_FILES.has(f))
    .map((f) => path.join(CONTROLLER_DIR, f));
}

function basename(file) {
  return path.basename(file, '.ts');
}

/** 在 src 中找到 className/objName body 的 {...} 区段。 */
function findBlockBody(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return '';
}

/**
 * 提取一个 controller 文件中所有"对外 method"的名字。
 *
 * 同时支持：
 *   class XxxController extends BaseController { async foo() {...} foo() {...} }
 *   const xxxController = { async foo() {...}, foo: async (args) => {...}, foo: (args) => {...} }
 *
 * 跳过：
 *   - 以 _ 开头的 helper（约定私有）
 *   - constructor / 静态属性 / Symbol method
 *   - 嵌套 lambda 调用（仅扫描 body 顶层）
 */
function extractControllerMethods(src) {
  const methods = new Set();

  // 1) class-based controllers
  const classMatch = src.match(/class\s+\w+(?:\s+extends\s+\w+)?\s*\{/);
  if (classMatch) {
    const open = classMatch.index + classMatch[0].length - 1;
    const body = findBlockBody(src, open);
    collectFromBody(body, methods);
  }

  // 2) object-literal controller: const xxxController = { ... }
  const objMatch = src.match(/const\s+\w+\s*=\s*\{/);
  if (objMatch) {
    const open = objMatch.index + objMatch[0].length - 1;
    const body = findBlockBody(src, open);
    collectFromBody(body, methods);
  }

  return methods;
}

function collectFromBody(body, methods) {
  // 顶层 method 提取：lineDepth=0 的标识符行
  let depth = 0;
  let lineStart = 0;
  let lineDepthAtStart = 0;
  const flush = (endIdx) => {
    const line = body.slice(lineStart, endIdx)
      .replace(/\/\/.*$/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (lineDepthAtStart !== 0) return;
    if (!line || line.startsWith('*') || line.startsWith('/')) return;
    // private/protected 不对外暴露，即使是 method 也不应进入 IPC 白名单
    if (/^\s*(private|protected)\b/.test(line)) return;
    // class method:  async foo(args) {  /  foo(args) {  /  public foo(args) {
    let m = line.match(/^(?:public|static|readonly|\s)*\s*(?:async\s+)?([a-zA-Z][a-zA-Z0-9_$]*)\s*\(/);
    if (m) {
      const name = m[1];
      if (!isExcluded(name)) methods.add(name);
      return;
    }
    // object property:  foo: async (args) => / foo: (args) => / foo: function
    m = line.match(/^([a-zA-Z][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?(?:\(|function)/);
    if (m) {
      const name = m[1];
      if (!isExcluded(name)) methods.add(name);
    }
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\n') {
      flush(i);
      lineStart = i + 1;
      lineDepthAtStart = depth;
    } else if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  flush(body.length);
}

function isExcluded(name) {
  if (!name) return true;
  if (name.startsWith('_')) return true;
  if (name === 'constructor') return true;
  return false;
}

function extractControllerWhitelistEntries(preloadSrc) {
  const open = preloadSrc.search(/ALLOWED_INVOKE_CHANNELS\s*=\s*new\s+Set\(\s*\[/);
  if (open === -1) {
    console.error('[ipc-whitelist] ALLOWED_INVOKE_CHANNELS not found in preload');
    process.exit(2);
  }
  const arrStart = preloadSrc.indexOf('[', open);
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < preloadSrc.length; i++) {
    if (preloadSrc[i] === '[') depth++;
    else if (preloadSrc[i] === ']') {
      depth--;
      if (depth === 0) { arrEnd = i; break; }
    }
  }
  const body = preloadSrc.slice(arrStart + 1, arrEnd);
  const entries = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return entries.filter((s) => s.startsWith('controller/'));
}

function main() {
  const controllerFiles = listControllerFiles();

  // 期望白名单：从 controller method 派生
  const expected = new Set();
  const fileToMethods = new Map();
  for (const file of controllerFiles) {
    const stem = basename(file);
    const src = fs.readFileSync(file, 'utf-8');
    const methods = extractControllerMethods(src);
    fileToMethods.set(stem, methods);
    for (const m of methods) {
      expected.add(`controller/${stem}/${m}`);
    }
  }

  const preloadSrc = fs.readFileSync(PRELOAD_FILE, 'utf-8');
  const declared = new Set(extractControllerWhitelistEntries(preloadSrc));

  const missingInWhitelist = [...expected].filter((c) => !declared.has(c)).sort();
  const orphanedInWhitelist = [...declared].filter((c) => !expected.has(c)).sort();

  if (missingInWhitelist.length === 0 && orphanedInWhitelist.length === 0) {
    console.log('[ipc-whitelist] OK');
    console.log(`  controllers:  ${controllerFiles.length} files`);
    console.log(`  methods:      ${expected.size}`);
    console.log(`  whitelist:    ${declared.size}`);
    return;
  }

  console.error('[ipc-whitelist] FAILURES:');
  if (missingInWhitelist.length > 0) {
    console.error(`  controller method 未在 preload 白名单中（${missingInWhitelist.length}）:`);
    for (const c of missingInWhitelist) console.error(`    - ${c}`);
  }
  if (orphanedInWhitelist.length > 0) {
    console.error(`  preload 白名单中无对应 controller method（${orphanedInWhitelist.length}）:`);
    for (const c of orphanedInWhitelist) console.error(`    - ${c}`);
  }
  process.exit(1);
}

main();
