/**
 * Koma TTS 内置音色试听样本路径解析。
 *
 * 样本 wav 由 cmd/builder*.json 的 extraResources 配置随客户端分发，路径：
 *   生产: <resourcesPath>/extraResources/audio/qwen-tts/<sampleFile>
 *   开发: <projectRoot>/build/extraResources/audio/qwen-tts/<sampleFile>
 *
 * 渲染端通过 IPC `controller/app/getKomaTTSVoiceSamplePath` 拿到绝对路径，
 * 再经 koma-local:// 协议加载到 <audio> 元素试听 —— 与 styleReferences 同模式，
 * 但样本文件量大（~58 个 wav，每个 ~370KB），不做启动期镜像，按需直读。
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const AUDIO_DIR = 'audio';
const QWEN_TTS_SUBDIR = 'qwen-tts';

let cachedRoot: string | null | undefined;

function resolveBuiltinSampleRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot;
  const candidates = [
    path.join(process.resourcesPath || '', 'extraResources', AUDIO_DIR, QWEN_TTS_SUBDIR),
    path.join(process.resourcesPath || '', AUDIO_DIR, QWEN_TTS_SUBDIR),
    path.join(app.getAppPath(), 'build', 'extraResources', AUDIO_DIR, QWEN_TTS_SUBDIR),
    path.join(app.getAppPath(), '..', 'build', 'extraResources', AUDIO_DIR, QWEN_TTS_SUBDIR),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        cachedRoot = candidate;
        return candidate;
      }
    } catch {
      // continue
    }
  }
  cachedRoot = null;
  return null;
}

/**
 * 给定 sampleFile 相对路径（如 `01_通用中英文/Cherry-芊悦.wav`），返回绝对路径；
 * 文件不存在或目录未找到时返回空串（前端拿到空串就知道没法试听）。
 *
 * 安全：用 path.relative 检查 resolve 结果是否仍在样本目录内，防止 `..` 越权。
 */
export function resolveKomaTTSVoiceSamplePath(sampleFile: string): string {
  const root = resolveBuiltinSampleRoot();
  if (!root) return '';
  const trimmed = String(sampleFile || '').replace(/^[\\/]+/, '').trim();
  if (!trimmed) return '';
  const resolved = path.resolve(root, trimmed);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
  try {
    if (!fs.existsSync(resolved)) return '';
    return resolved;
  } catch {
    return '';
  }
}
