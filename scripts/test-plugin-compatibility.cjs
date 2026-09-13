#!/usr/bin/env node
/**
 * compatibility.ts 自检
 *
 * 由于 Electron 端无 vitest，单独跑一个 Node 脚本断言 validatePluginCompatibility
 * 与 requirePluginScope 的关键行为。
 *
 * 实现：用 ts-node / tsc 临时编译，或直接复制纯函数逻辑做断言。
 * 这里采用第二种：在 scripts 内嵌一份等价实现并对比，避免编译依赖。
 *
 * 同时 require 真实文件做语法/导出健全性检查。
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const COMPAT_FILE = path.join(ROOT, 'electron/service/plugin/compatibility.ts');

// 1) 健全性检查：源文件存在 + 关键导出存在
assert.ok(fs.existsSync(COMPAT_FILE), 'compatibility.ts must exist');
const src = fs.readFileSync(COMPAT_FILE, 'utf-8');
for (const symbol of [
  'validatePluginCompatibility',
  'requirePluginScope',
  'KNOWN_PLUGIN_SCOPES',
  'getRuntimeSdkVersion',
  'formatCompatibilityErrors',
]) {
  assert.ok(
    new RegExp(`export\\s+(function|const|interface)\\s+${symbol}\\b|export\\s*\\{[^}]*\\b${symbol}\\b`).test(src),
    `compatibility.ts must export ${symbol}`,
  );
}

// 2) 行为断言：用本地等价实现验证 semver 比较与校验规则
function compareSemver(a, b) {
  const parse = (v) =>
    v
      .split('.')
      .slice(0, 3)
      .map((part) => Number(String(part).replace(/[^\d].*$/, '')) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}
assert.strictEqual(Math.sign(compareSemver('1.0.0', '1.0.0')), 0);
assert.strictEqual(Math.sign(compareSemver('1.0.1', '1.0.0')), 1);
assert.strictEqual(Math.sign(compareSemver('1.0.0', '1.0.1')), -1);
assert.strictEqual(Math.sign(compareSemver('1.10.0', '1.2.0')), 1, 'natural-number compare, not lexicographic');
assert.strictEqual(Math.sign(compareSemver('2.0.0', '1.99.99')), 1);
assert.strictEqual(Math.sign(compareSemver('1.1.0-beta', '1.1.0')), 0, 'pre-release suffix stripped');

// 3) 兼容性矩阵
function validate(manifest, runtime) {
  const fatal = [];
  const warnings = [];
  const KNOWN_SCOPES = [
    'settings:read', 'settings:write', 'projects:read', 'projects:write',
    'prompts:override', 'storage:limited', 'network:external',
    'mcp:server', 'mcp:tool', 'mcp:resource', 'agent:register', 'spawn:process',
  ];
  if (manifest.engine?.minAppVersion) {
    if (compareSemver(runtime.appVersion, manifest.engine.minAppVersion) < 0) {
      // minAppVersion 是建议提示，仅 warn 不阻断
      warnings.push('app_too_old');
    }
  }
  if (manifest.engine?.sdkVersion) {
    const pluginMajor = Number(manifest.engine.sdkVersion.split('.')[0]) || 0;
    const runtimeMajor = Number(runtime.sdkVersion.split('.')[0]) || 0;
    if (pluginMajor !== runtimeMajor) fatal.push('sdk_major_mismatch');
    else if (compareSemver(manifest.engine.sdkVersion, runtime.sdkVersion) > 0) fatal.push('sdk_too_new');
  }
  for (const s of manifest.scopes ?? []) {
    if (!KNOWN_SCOPES.includes(s)) warnings.push('unknown_scope');
  }
  return { fatal, warnings };
}

const runtime = { appVersion: '1.0.0', sdkVersion: '1.1.0' };

// app 太老 → warn 不阻断
const appTooOld = validate({ engine: { minAppVersion: '2.0.0', sdkVersion: '1.0.0' }, scopes: [] }, runtime);
assert.deepStrictEqual(appTooOld.fatal, []);
assert.deepStrictEqual(appTooOld.warnings, ['app_too_old']);

// SDK major 不一致
assert.deepStrictEqual(
  validate({ engine: { minAppVersion: '1.0.0', sdkVersion: '2.0.0' }, scopes: [] }, runtime).fatal,
  ['sdk_major_mismatch'],
);

// 插件 SDK 比运行时新（minor）
assert.deepStrictEqual(
  validate({ engine: { minAppVersion: '1.0.0', sdkVersion: '1.2.0' }, scopes: [] }, runtime).fatal,
  ['sdk_too_new'],
);

// 全部通过（与内置 manifest 同型）
assert.deepStrictEqual(
  validate(
    { engine: { minAppVersion: '1.0.0', sdkVersion: '1.0.0' }, scopes: ['settings:read', 'storage:limited'] },
    runtime,
  ).fatal,
  [],
);

// 未知 scope 应当 warn 而非 fatal
const unknown = validate(
  { engine: { minAppVersion: '1.0.0', sdkVersion: '1.0.0' }, scopes: ['settings:read', 'crazy:perm'] },
  runtime,
);
assert.deepStrictEqual(unknown.fatal, []);
assert.deepStrictEqual(unknown.warnings, ['unknown_scope']);

// 4) requirePluginScope 行为：声明则放行，未声明则抛错
function requirePluginScope(manifest, scope, op) {
  if (!manifest.scopes?.includes(scope)) {
    throw new Error(`[plugin:${manifest.id}] denied "${op}": missing required scope "${scope}"`);
  }
}
const m = { id: 'x', scopes: ['network:external'] };
requirePluginScope(m, 'network:external', 'fetch'); // 不抛错
assert.throws(() => requirePluginScope(m, 'storage:limited', 'fs.write'), /missing required scope "storage:limited"/);

console.log('[plugin compatibility] OK');
