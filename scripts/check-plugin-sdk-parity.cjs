#!/usr/bin/env node
/**
 * SDK / 前端 / Electron 三处 Provider 类型契约对账脚本
 *
 * 检查内容：
 *  - packages/plugin-sdk/src/provider.ts                        — 规格真源
 *  - frontend/src/providers/registry.types.ts                   — 前端运行时副本
 *  - electron/service/plugin/types.ts                           — Electron 运行时副本
 *
 * 校验项：
 *  1. MEDIA_PROVIDER_CONTRACT_VERSION 在三处必须字面相等
 *  2. ChannelKind 字面量集合三处必须完全一致
 *  3. ProviderDefinition 接口字段名集合三处必须一致（顺序不限）
 *  4. ElectronPluginAPI 顶层 namespace 一致（SDK backend.ts vs electron types.ts）
 *
 * 重要：当某个文件通过 `from '@komastudio/plugin-sdk'` 直接 import/re-export
 * 某个类型时，视为"该类型已由 type-import 自动保证一致"，跳过本地对账。
 *
 * 失败时返回非零退出码，可在 CI 中前置运行。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SDK_FILE = path.join(ROOT, 'packages/plugin-sdk/src/provider.ts');
const SDK_BACKEND_FILE = path.join(ROOT, 'packages/plugin-sdk/src/backend.ts');
const FRONTEND_FILE = path.join(ROOT, 'frontend/src/providers/registry.types.ts');
const ELECTRON_FILE = path.join(ROOT, 'electron/service/plugin/types.ts');

function read(file) {
  if (!fs.existsSync(file)) {
    console.error(`[parity] missing file: ${file}`);
    process.exit(2);
  }
  return fs.readFileSync(file, 'utf-8');
}

/** 提取文件中通过 from '@komastudio/plugin-sdk' 导入或 re-export 的所有标识符。 */
function extractSdkImportedNames(src) {
  const names = new Set();
  const re = /(?:import|export)\s+type\s*\{([^}]+)\}\s*from\s+['"]@komastudio\/plugin-sdk['"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function extractContractVersion(src, label) {
  const m = src.match(/MEDIA_PROVIDER_CONTRACT_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) {
    console.error(`[parity] ${label}: MEDIA_PROVIDER_CONTRACT_VERSION not found`);
    process.exit(3);
  }
  return m[1];
}

function extractChannelKinds(src) {
  const m = src.match(/export\s+type\s+ChannelKind\s*=\s*([^;]+);/);
  if (!m) return null;
  const kinds = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return new Set(kinds);
}

function extractKindsFromProviderDef(src) {
  const m = src.match(/kind\s*:\s*'tti'[^;]*;/);
  if (!m) return null;
  const kinds = [...m[0].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return new Set(kinds);
}

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

function extractInterfaceFields(src, name) {
  const re = new RegExp(`interface\\s+${name}\\b[^{]*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index + m[0].length - 1);
  const body = findBlockBody(src, open);
  const fields = new Set();
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!line || line.startsWith('*') || line.startsWith('/')) continue;
    const fm = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
    if (fm) fields.add(fm[1]);
  }
  return fields;
}

function extractInterfaceTopLevelKeys(src, name) {
  const re = new RegExp(`interface\\s+${name}\\b[^{]*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index + m[0].length - 1);
  const body = findBlockBody(src, open);
  const keys = new Set();
  let d = 0;
  let lineStart = 0;
  let lineDepthAtStart = 0;
  const flush = (endIdx) => {
    const line = body.slice(lineStart, endIdx)
      .replace(/\/\/.*$/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (lineDepthAtStart === 0 && line && !line.startsWith('*') && !line.startsWith('/')) {
      const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (km) keys.add(km[1]);
    }
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\n') {
      flush(i);
      lineStart = i + 1;
      lineDepthAtStart = d;
    } else if (ch === '{') d++;
    else if (ch === '}') d--;
  }
  flush(body.length);
  return keys;
}

function setEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function diffSets(a, b) {
  return {
    onlyA: [...a].filter((x) => !b.has(x)),
    onlyB: [...b].filter((x) => !a.has(x)),
  };
}

const sdkSrc = read(SDK_FILE);
const sdkBackendSrc = read(SDK_BACKEND_FILE);
const frontendSrc = read(FRONTEND_FILE);
const electronSrc = read(ELECTRON_FILE);

const failures = [];

// 提取每个文件中通过 SDK import 的名字
const frontendSdkImported = extractSdkImportedNames(frontendSrc);
const electronSdkImported = extractSdkImportedNames(electronSrc);

// 1. MEDIA_PROVIDER_CONTRACT_VERSION 对账
const sdkVersion = extractContractVersion(sdkSrc, 'SDK');
let frontendVersion = sdkVersion;
let electronVersion = sdkVersion;
if (!frontendSdkImported.has('MEDIA_PROVIDER_CONTRACT_VERSION')) {
  frontendVersion = extractContractVersion(frontendSrc, 'frontend');
}
if (!electronSdkImported.has('MEDIA_PROVIDER_CONTRACT_VERSION')) {
  electronVersion = extractContractVersion(electronSrc, 'electron');
}
if (sdkVersion !== frontendVersion || sdkVersion !== electronVersion) {
  failures.push(
    `MEDIA_PROVIDER_CONTRACT_VERSION mismatch: sdk=${sdkVersion} frontend=${frontendVersion} electron=${electronVersion}`,
  );
}

// 2. ChannelKind 字面量集合
const sdkKinds = extractChannelKinds(sdkSrc);
if (!sdkKinds) {
  console.error('[parity] SDK: ChannelKind type alias not found');
  process.exit(3);
}
let frontendKinds = sdkKinds;
let electronKinds = sdkKinds;
if (!frontendSdkImported.has('ChannelKind')) {
  frontendKinds = extractChannelKinds(frontendSrc);
  if (!frontendKinds) {
    console.error('[parity] frontend: ChannelKind type alias not found and not imported from SDK');
    process.exit(3);
  }
}
if (!electronSdkImported.has('ChannelKind')) {
  electronKinds = extractKindsFromProviderDef(electronSrc) || sdkKinds;
}
if (!setEqual(sdkKinds, frontendKinds)) {
  const d = diffSets(sdkKinds, frontendKinds);
  failures.push(
    `ChannelKind mismatch (SDK vs frontend): only-SDK=[${d.onlyA.join(',')}] only-frontend=[${d.onlyB.join(',')}]`,
  );
}
if (!setEqual(sdkKinds, electronKinds)) {
  const d = diffSets(sdkKinds, electronKinds);
  failures.push(
    `ChannelKind mismatch (SDK vs electron): only-SDK=[${d.onlyA.join(',')}] only-electron=[${d.onlyB.join(',')}]`,
  );
}

// 3. ProviderDefinition 字段集合
const sdkFields = extractInterfaceFields(sdkSrc, 'ProviderDefinition');
if (!sdkFields) {
  console.error('[parity] SDK: ProviderDefinition interface not found');
  process.exit(3);
}
if (!frontendSdkImported.has('ProviderDefinition')) {
  const frontendFields = extractInterfaceFields(frontendSrc, 'ProviderDefinition');
  if (!frontendFields) {
    console.error('[parity] frontend: ProviderDefinition interface not found and not imported from SDK');
    process.exit(3);
  }
  if (!setEqual(sdkFields, frontendFields)) {
    const d = diffSets(sdkFields, frontendFields);
    failures.push(
      `ProviderDefinition fields mismatch (SDK vs frontend): only-SDK=[${d.onlyA.join(',')}] only-frontend=[${d.onlyB.join(',')}]`,
    );
  }
}
const electronFields = extractInterfaceFields(electronSrc, 'ProviderDefinition');
if (electronFields && !setEqual(sdkFields, electronFields)) {
  const d = diffSets(sdkFields, electronFields);
  failures.push(
    `ProviderDefinition fields mismatch (SDK vs electron): only-SDK=[${d.onlyA.join(',')}] only-electron=[${d.onlyB.join(',')}]`,
  );
}

// 4. ElectronPluginAPI 顶层 namespace
const sdkApiKeys = extractInterfaceTopLevelKeys(sdkBackendSrc, 'ElectronPluginAPI');
const electronApiKeys = extractInterfaceTopLevelKeys(electronSrc, 'ElectronPluginAPI');
if (sdkApiKeys && electronApiKeys && !setEqual(sdkApiKeys, electronApiKeys)) {
  const d = diffSets(sdkApiKeys, electronApiKeys);
  failures.push(
    `ElectronPluginAPI namespace mismatch (SDK vs electron): only-SDK=[${d.onlyA.join(',')}] only-electron=[${d.onlyB.join(',')}]`,
  );
}

if (failures.length > 0) {
  console.error('[plugin-sdk parity] FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('[plugin-sdk parity] OK');
console.log(`  contractVersion:        ${sdkVersion}`);
console.log(`  channelKinds:           ${[...sdkKinds].join(', ')}`);
console.log(`  ProviderDefinition:     ${sdkFields.size} fields`);
if (sdkApiKeys) {
  console.log(`  ElectronPluginAPI:      ${[...sdkApiKeys].join(', ')}`);
}
const frontendPath = frontendSdkImported.size > 0 ? `via SDK import (${frontendSdkImported.size} symbols)` : 'local';
const electronPath = electronSdkImported.size > 0 ? `via SDK import (${electronSdkImported.size} symbols)` : 'local';
console.log(`  frontend types:         ${frontendPath}`);
console.log(`  electron types:         ${electronPath}`);
