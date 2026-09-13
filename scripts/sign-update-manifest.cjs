#!/usr/bin/env node
/**
 * sign-update-manifest.cjs
 *
 * 在 GitHub Actions release 流水线里运行：
 *   1. 扫描 release assets 目录（含 .exe / .dmg / .AppImage / .blockmap / latest*.yml）
 *   2. 计算每个平台主安装包的 SHA512（base64 形式，与客户端 manifestVerifier.sha512Base64 一致）
 *   3. 用 KOMA_UPDATE_SIGN_KEY (base64 PEM) 私钥 ed25519 签名 manifest.json
 *   4. 输出 koma-update-manifest.json + koma-update-manifest.sig 到 assets 目录
 *
 * 入参（环境变量）:
 *   ASSETS_DIR             release assets 所在本地目录（必填）
 *   APP_VERSION            版本号，如 "1.0.1"（必填）
 *   CHANNEL                stable | beta，默认 stable
 *   MIN_VERSION            可选，强制下限版本（低于此版本的客户端会进强制升级 UX）
 *   CRITICAL               "true" 时标注关键更新
 *   NOTES_ZH               中文 changelog（多行）
 *   NOTES_EN               英文 changelog
 *   KOMA_UPDATE_SIGN_KEY   base64 编码的 PKCS#8 PEM 私钥
 *
 * 文件名 → 平台映射规则（基于 cmd/builder*.json 的 artifactName）:
 *   *win*setup.exe        → win-x64-nsis
 *   *win*portable.exe     → win-x64-portable
 *   *mac*x64*.dmg         → mac-x64-dmg
 *   *mac*arm64*.dmg       → mac-arm64-dmg
 *   *linux*x64*.AppImage  → linux-x64-appimage
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function die(msg) {
  console.error(`[sign-update-manifest] ${msg}`);
  process.exit(1);
}

const ASSETS_DIR = process.env.ASSETS_DIR;
const APP_VERSION = process.env.APP_VERSION;
const CHANNEL = process.env.CHANNEL || 'stable';
const MIN_VERSION = process.env.MIN_VERSION || null;
const CRITICAL = process.env.CRITICAL === 'true';
const NOTES_ZH = process.env.NOTES_ZH || '';
const NOTES_EN = process.env.NOTES_EN || '';
const SIGN_KEY_B64 = process.env.KOMA_UPDATE_SIGN_KEY;

if (!ASSETS_DIR) die('ASSETS_DIR is required');
if (!APP_VERSION) die('APP_VERSION is required');
if (!SIGN_KEY_B64) die('KOMA_UPDATE_SIGN_KEY is required');

const PEM_PRIVATE = Buffer.from(SIGN_KEY_B64, 'base64').toString('utf8');
const privateKey = crypto.createPrivateKey(PEM_PRIVATE);

function sha512Base64(filePath) {
  const hash = crypto.createHash('sha512');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return { sha512: hash.digest('base64'), size: buf.length };
}

function classify(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.exe')) {
    if (lower.includes('portable')) return 'win-x64-portable';
    if (lower.includes('setup') || lower.includes('nsis')) return 'win-x64-nsis';
    return null;
  }
  if (lower.endsWith('.dmg')) {
    if (lower.includes('arm64')) return 'mac-arm64-dmg';
    if (lower.includes('x64')) return 'mac-x64-dmg';
    return null;
  }
  if (lower.endsWith('.appimage')) {
    return 'linux-x64-appimage';
  }
  return null;
}

const entries = fs.readdirSync(ASSETS_DIR);
const platforms = {};
for (const file of entries) {
  const key = classify(file);
  if (!key) continue;
  const full = path.join(ASSETS_DIR, file);
  if (!fs.statSync(full).isFile()) continue;
  const { sha512, size } = sha512Base64(full);
  // GitHub release 上传 asset 时会把文件名里的空格静默替换成点（".")
  // manifest 必须存"上传后的"文件名，否则客户端按原名拼 URL 会 404。
  // 例：本地 "Koma Studio-mac-1.2.5-arm64.dmg" → GitHub 上是 "Koma.Studio-mac-1.2.5-arm64.dmg"
  const githubName = file.replace(/ /g, '.');
  platforms[key] = { file: githubName, sha512, size };
  console.log(`[sign-update-manifest] ${key} <- ${file} (${size} bytes) → manifest.file=${githubName}`);
}

if (Object.keys(platforms).length === 0) {
  die('No installer assets found in ASSETS_DIR');
}

const manifest = {
  version: APP_VERSION,
  releasedAt: new Date().toISOString(),
  channel: CHANNEL,
  critical: CRITICAL,
  platforms,
  notes: { zh: NOTES_ZH || undefined, en: NOTES_EN || undefined },
};
if (MIN_VERSION) manifest.minVersion = MIN_VERSION;

const manifestJson = JSON.stringify(manifest);
const sig = crypto.sign(null, Buffer.from(manifestJson), privateKey).toString('base64');

const outManifest = path.join(ASSETS_DIR, 'koma-update-manifest.json');
const outSig = path.join(ASSETS_DIR, 'koma-update-manifest.sig');
fs.writeFileSync(outManifest, manifestJson);
fs.writeFileSync(outSig, sig);

console.log(`[sign-update-manifest] wrote ${outManifest}`);
console.log(`[sign-update-manifest] wrote ${outSig}`);
