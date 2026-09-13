#!/usr/bin/env node
/**
 * sign-plugin-manifest.cjs
 *
 * 在插件发布流水线里运行：
 *   1. 解压输入 plugin zip 到临时目录
 *   2. 读 manifest.json
 *   3. 用规范化 JSON（键名按字典序递归排序）+ ed25519 签名
 *   4. 写回 manifest.signature 字段
 *   5. 重新打包成新 zip（覆盖原文件）
 *
 * 入参:
 *   --in <plugin.zip>            (必填)
 *   --out <signed-plugin.zip>    (可选；默认原地覆盖)
 *
 * 环境变量:
 *   KOMA_UPDATE_SIGN_KEY   base64 编码的 PKCS#8 PEM 私钥（与主程序更新同一对密钥）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function die(msg) {
  console.error(`[sign-plugin-manifest] ${msg}`);
  process.exit(1);
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const inZip = arg('--in');
const outZip = arg('--out') || inZip;
if (!inZip) die('--in <plugin.zip> is required');

const SIGN_KEY_B64 = process.env.KOMA_UPDATE_SIGN_KEY;
if (!SIGN_KEY_B64) die('KOMA_UPDATE_SIGN_KEY is required');

const privateKey = crypto.createPrivateKey(Buffer.from(SIGN_KEY_B64, 'base64').toString('utf8'));

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koma-plugin-sign-'));
try {
  const zip = new AdmZip(inZip);
  zip.extractAllTo(tmpDir, true);

  // 兼容 zip 内是否有顶层包装目录
  let manifestPath = path.join(tmpDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const subdir = entries.find((e) => e.isDirectory());
    if (subdir) {
      const candidate = path.join(tmpDir, subdir.name, 'manifest.json');
      if (fs.existsSync(candidate)) manifestPath = candidate;
    }
  }
  if (!fs.existsSync(manifestPath)) die('manifest.json not found inside plugin zip');

  const manifestObj = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // 删除任何现有 signature 字段，避免对包含旧签名的对象再签
  delete manifestObj.signature;
  const canonical = JSON.stringify(sortKeysDeep(manifestObj));
  const sig = crypto.sign(null, Buffer.from(canonical), privateKey).toString('base64');

  manifestObj.signature = sig;
  fs.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2));

  // 重新打 zip
  const outBuf = new AdmZip();
  // 把 tmpDir 的内容（保持原结构）加进去
  outBuf.addLocalFolder(tmpDir);
  outBuf.writeZip(outZip);

  console.log(`[sign-plugin-manifest] signed: ${outZip}`);
  console.log(`[sign-plugin-manifest] manifest.signature: ${sig.slice(0, 16)}...`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
