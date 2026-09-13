/**
 * 风格参考图（"画风锚"）启动拷贝。
 *
 * 内置占位图打包在 `build/extraResources/style-references/`（同 builtin-plugins 模式），
 * 启动时镜像到业务根 `${userData/..}/.koma/style-references/`，让前端可以通过
 * `koma-local://<absPath>` 直读，而不必处理 asar 内路径或 process.resourcesPath。
 *
 * 用户在 VisualStyleManager 里上传 / 替换的自定义风格图也落到同一目录，
 * 文件名 = `${presetId}.svg|png|jpg|...`。重启时若内置文件已存在不会覆盖，
 * 所以用户自定义内容会被保留。
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from 'ee-core/log';
import { getStyleReferencesDir } from './paths';

const BUILTIN_DIR_NAME = 'style-references';

function resolveBuiltinSourceDir(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'extraResources', BUILTIN_DIR_NAME),
    path.join(process.resourcesPath || '', BUILTIN_DIR_NAME),
    path.join(app.getAppPath(), 'build', 'extraResources', BUILTIN_DIR_NAME),
    path.join(app.getAppPath(), '..', 'build', 'extraResources', BUILTIN_DIR_NAME),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function syncBuiltinStyleReferences(): Promise<void> {
  const destDir = getStyleReferencesDir();
  await fs.promises.mkdir(destDir, { recursive: true });

  const sourceDir = resolveBuiltinSourceDir();
  if (!sourceDir) {
    logger.warn('[style-references] 未找到内置风格参考图源目录，跳过同步');
    return;
  }

  let copied = 0;
  let skipped = 0;
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === 'README.md') continue;
    const src = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    try {
      await fs.promises.access(dest);
      skipped += 1;
      continue;
    } catch {
      // 目标不存在，写入
    }
    try {
      await fs.promises.copyFile(src, dest);
      copied += 1;
    } catch (err) {
      logger.warn(
        `[style-references] 复制 ${entry.name} 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger.info(`[style-references] 同步完成 copied=${copied} skipped=${skipped} dir=${destDir}`);
}
