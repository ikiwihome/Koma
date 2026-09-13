import { app, protocol } from 'electron';
import fs from 'fs';
import path from 'path';
import { getBusinessRoot, getPluginsRuntimeDir } from './paths';

const mimeTypes: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

let registered = false;

function isPathAllowed(filePath: string): boolean {
  const normalized = path.resolve(filePath);
  const home = app.getPath('home');
  const appData = app.getPath('appData');
  const userData = app.getPath('userData');
  const temp = app.getPath('temp');
  const businessRoot = getBusinessRoot();
  // 打包后内置资源（音色 wav / 风格图等）落在 process.resourcesPath/extraResources/，
  // macOS prod 是 `/Applications/Koma.app/Contents/Resources`，不在 home 下，必须显式允许。
  // dev 模式下 process.resourcesPath 指向 Electron 安装的 Resources，加上也无害。
  const resourcesPath = process.resourcesPath || '';
  // dev 模式 fallback: 项目根 build/extraResources/ 也可能被直接读到
  const appPath = app.getAppPath();
  const allowedRoots = [home, appData, userData, temp, businessRoot, resourcesPath, appPath].filter(Boolean);
  return allowedRoots.some(root => normalized.startsWith(root + path.sep) || normalized === root);
}

export function registerLocalProtocol(): void {
  if (registered) return;
  registered = true;

  protocol.handle('koma-local', async request => {
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);

      // Windows: pathname 形如 /C:/Users/... 需要去掉开头的 /
      // macOS/Linux: pathname 形如 /Users/... 需要保留开头的 /
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }

      // 特殊处理：plugins-runtime/ 开头的相对路径，解析为业务根/plugins-runtime/
      if (filePath.startsWith('plugins-runtime/') || filePath.startsWith('/plugins-runtime/')) {
        const sub = filePath.replace(/^\/?plugins-runtime\//, '');
        filePath = path.join(getPluginsRuntimeDir(), sub);
      }

      const resolvedPath = path.resolve(filePath);
      if (!isPathAllowed(resolvedPath)) {
        return new Response('Forbidden', { status: 403 });
      }

      const stat = await fs.promises.stat(resolvedPath);
      const fileSize = stat.size;
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      const rangeHeader = request.headers.get('range');

      // 通用 CORS 头：让 <video crossOrigin="anonymous"> 等元素能正常加载
      // 不加这些头时，video 元素的 onloadeddata 不会触发 → 渲染器永远 isReady=false → 黑屏不播放
      const baseHeaders: Record<string, string> = {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
      };

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;
          const fd = await fs.promises.open(resolvedPath, 'r');
          const buffer = Buffer.alloc(chunkSize);
          await fd.read(buffer, 0, chunkSize, start);
          await fd.close();

          return new Response(buffer, {
            status: 206,
            headers: {
              ...baseHeaders,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            },
          });
        }
      }

      const buffer = await fs.promises.readFile(resolvedPath);
      return new Response(buffer, {
        status: 200,
        headers: {
          ...baseHeaders,
          'Content-Length': String(fileSize),
        },
      });
    } catch (err) {
      // 错误打日志便于诊断（之前是静默 404，路径错误时无法定位）
      // eslint-disable-next-line no-console
      console.warn('[koma-local] file fetch failed:', request.url, err instanceof Error ? err.message : err);
      return new Response('File not found', { status: 404 });
    }
  });
}
