/**
 * 插件下载 → 验签 → 安装 → 热加载 流水。
 *
 * 关键不变量：
 *   - 升级时先把现有 `plugins-runtime/{id}/` 重命名为 `{id}.bak/`，新版完全验签 + 加载成功
 *     才删除 `.bak`；任何步骤失败都恢复 `.bak` → 原目录，保证 pluginRuntime 仍以旧版运行。
 *   - 下载落盘在 marketplace-cache/，与 plugins-runtime/ 完全隔离。
 *   - 严格 manifest 签名（marketplace 路径下 strictSignature=true）；
 *     manifest.version 必须 > store 中记录的"已装过的最高版本"，防降级。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { app } from 'electron';
import AdmZip from 'adm-zip';
import { logger } from 'ee-core/log';

import {
  sha512Base64,
  compareSemver,
  verifyPluginManifest,
} from '../release-signing/manifestVerifier';
import { getMarketplaceCacheDir } from '../paths';
import { getPluginsRuntimeDir } from '../paths';
import { pluginRuntime } from '../plugin/runtime';
import { validatePluginCompatibility } from '../plugin/compatibility';
import type { PluginManifest } from '../plugin/types';
import { marketplaceStore } from './store';
import type { PluginRegistryEntry } from './types';

export interface InstallResult {
  ok: boolean;
  reason?: string;
}

export async function installFromRegistry(entry: PluginRegistryEntry): Promise<InstallResult> {
  const pluginsDir = getPluginsRuntimeDir();
  const targetDir = path.join(pluginsDir, entry.id);
  const backupDir = `${targetDir}.bak`;
  const cacheDir = getMarketplaceCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true });
  await fs.promises.mkdir(pluginsDir, { recursive: true });

  const zipPath = path.join(cacheDir, `${entry.id}-${entry.latestVersion}.zip`);

  // 1. 下载
  try {
    await httpsDownload(entry.downloadUrl, zipPath);
  } catch (err) {
    return { ok: false, reason: `下载失败：${(err as Error).message}` };
  }

  // 2. SHA512 校验
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(zipPath);
  } catch (err) {
    return { ok: false, reason: `读取下载文件失败：${(err as Error).message}` };
  }
  const actualSha = sha512Base64(buf);
  if (actualSha !== entry.sha512) {
    await safeUnlink(zipPath);
    return { ok: false, reason: '下载文件 SHA512 与注册表不一致，可能已损坏或被篡改' };
  }

  // 3. 解压到临时 staging 目录
  const stagingDir = path.join(cacheDir, `${entry.id}-${entry.latestVersion}-staging`);
  await safeRmDir(stagingDir);
  await fs.promises.mkdir(stagingDir, { recursive: true });
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(stagingDir, true);
  } catch (err) {
    await safeRmDir(stagingDir);
    return { ok: false, reason: `解压失败：${(err as Error).message}` };
  }

  // 4. 读 manifest.json 并验签
  let manifest: PluginManifest;
  try {
    const manifestPath = path.join(stagingDir, 'manifest.json');
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
  } catch (err) {
    await safeRmDir(stagingDir);
    return { ok: false, reason: `manifest 缺失或解析失败：${(err as Error).message}` };
  }

  // 防降级（在 verifyPluginManifest 之前显式检查，错误信息更清晰）
  const lastInstalled = marketplaceStore.getInstalledVersion(entry.id);
  if (lastInstalled && compareSemver(manifest.version, lastInstalled) <= 0) {
    await safeRmDir(stagingDir);
    return { ok: false, reason: `拒绝降级：已安装 ${lastInstalled}，待装 ${manifest.version}` };
  }

  const verifyRes = verifyPluginManifest(manifest as Record<string, unknown>, lastInstalled);
  if (!verifyRes.ok) {
    await safeRmDir(stagingDir);
    return { ok: false, reason: `manifest 验签失败：${verifyRes.reason}` };
  }

  // 5. 兼容性校验（strict signature 路径——marketplace 安装必须签名通过）
  const report = validatePluginCompatibility(manifest, undefined, { strictSignature: true });
  if (report.fatal.length > 0) {
    await safeRmDir(stagingDir);
    return { ok: false, reason: `兼容性检查失败：${report.fatal.map((i) => i.message).join('; ')}` };
  }

  // 6. 备份旧目录（若存在），交换 staging → target
  const hadOld = await pathExists(targetDir);
  try {
    if (hadOld) {
      await safeRmDir(backupDir);
      await fs.promises.rename(targetDir, backupDir);
    }
    await fs.promises.rename(stagingDir, targetDir);
    // 确保 data/ 沙箱目录存在
    await fs.promises.mkdir(path.join(targetDir, 'data'), { recursive: true });
  } catch (err) {
    // 回滚
    await rollback(targetDir, backupDir, stagingDir);
    return { ok: false, reason: `目录替换失败：${(err as Error).message}` };
  }

  // 7. pluginRuntime 重新加载
  try {
    if (hadOld) {
      await pluginRuntime.unloadPlugin(entry.id);
    }
    await pluginRuntime.loadPlugin(manifest);
    await pluginRuntime.activatePlugin(entry.id);
  } catch (err) {
    logger.error('[marketplace] activate after install failed, rolling back', err);
    // 回滚到 .bak
    await rollback(targetDir, backupDir, stagingDir);
    try {
      if (hadOld) {
        // 重新加载旧版
        const oldManifestRaw = await fs.promises.readFile(path.join(targetDir, 'manifest.json'), 'utf-8');
        const oldManifest = JSON.parse(oldManifestRaw) as PluginManifest;
        await pluginRuntime.loadPlugin(oldManifest);
        await pluginRuntime.activatePlugin(oldManifest.id);
      }
    } catch (innerErr) {
      logger.error('[marketplace] rollback reactivation also failed', innerErr);
    }
    return { ok: false, reason: `激活失败：${(err as Error).message}` };
  }

  // 8. 全成功：删除 .bak + zip + staging
  await safeRmDir(backupDir);
  await safeUnlink(zipPath);

  marketplaceStore.bumpInstalledVersion(entry.id, manifest.version, compareSemver);

  return { ok: true };
}

export async function uninstallPlugin(pluginId: string): Promise<InstallResult> {
  const pluginsDir = getPluginsRuntimeDir();
  const targetDir = path.join(pluginsDir, pluginId);
  try {
    await pluginRuntime.unloadPlugin(pluginId);
  } catch (err) {
    logger.warn('[marketplace] unloadPlugin during uninstall failed', err);
  }
  if (await pathExists(targetDir)) {
    await safeRmDir(targetDir);
  }
  // 注意：不重置 marketplace-plugin-versions-cache 里的版本锚点，防降级。
  return { ok: true };
}

// ----- helpers -----

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.promises.unlink(p);
  } catch {
    // 忽略
  }
}

async function safeRmDir(p: string): Promise<void> {
  try {
    await fs.promises.rm(p, { recursive: true, force: true });
  } catch {
    // 忽略
  }
}

async function rollback(targetDir: string, backupDir: string, stagingDir: string): Promise<void> {
  await safeRmDir(targetDir);
  if (await pathExists(backupDir)) {
    try {
      await fs.promises.rename(backupDir, targetDir);
    } catch (err) {
      logger.error('[marketplace] rollback rename failed', err);
    }
  }
  await safeRmDir(stagingDir);
}

function httpsDownload(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': `Koma-Updater/${safeVersion()}` } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        return resolve(httpsDownload(res.headers.location, destPath, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(180_000, () => req.destroy(new Error('Plugin download timeout')));
  });
}

function safeVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return '0.0.0';
  }
}
