/**
 * Chat 媒体落盘 — 把鉴权远程 URL（如 https://komaapi.com/v1/videos/.../content）
 * 下载到本地，再用 koma-local:// 协议给前端 <video>/<img> 显示。
 *
 * 复用：
 *  - persistMediaAsset（统一下载 + 鉴权 + 落盘）
 *  - toKomaLocalUrl（本地路径 → koma-local:// URL）
 *  - parseMediaSelectionKey（从 modelSelectionKey 解析 channelId）
 *
 * Chat 不属于任何 project，所以传一个虚拟 projectId 占位 + 显式传 destPath
 * 跳过 buildDefaultDestPath 的 project 路径推断。
 */
import { persistMediaAsset } from './mediaPersistenceService';
import { electronService } from './electronService';
import { toKomaLocalUrl } from '../utils/urlUtils';
import { parseMediaSelectionKey } from '../providers/channel/resolver';
import { createLogger } from '../store/logger';
import type { MediaKind } from '../types/media';

const logger = createLogger('ChatMediaPersistence');
const CHAT_PROJECT_PLACEHOLDER = '__chat__';

function inferExt(kind: MediaKind, source: string): string {
  // 优先看源 URL 路径里有无后缀
  const m = source.match(/\.([a-z0-9]{1,5})(?:\?|#|$)/i);
  if (m) return m[1].toLowerCase();
  // 兜底：按 kind 给默认
  if (kind === 'video') return 'mp4';
  if (kind === 'image') return 'jpg';
  if (kind === 'audio') return 'mp3';
  return 'bin';
}

/**
 * 从 ITV/TTI 的 modelSelectionKey ("channelId::modelId") 解析 channelId。
 * persistMediaAsset 用 channelId 在主进程查 API key 做鉴权下载。
 */
function resolveChannelId(modelSelectionKey?: string): string | undefined {
  if (!modelSelectionKey) return undefined;
  const parsed = parseMediaSelectionKey(modelSelectionKey);
  return parsed?.channelId;
}

/**
 * 把 chat 媒体的 remote URL 下载到本地，返回 koma-local:// URL（前端可直接 src）。
 *
 * 失败时回落到原始 remote URL（用户至少能看到原 URL 报 401，比白屏好；上层可识别后报错）。
 */
export async function persistChatMediaToLocal(params: {
  remoteUrl: string;
  kind: MediaKind;
  modelSelectionKey?: string;
  sessionId?: string;
  messageId?: string;
  mimeType?: string;
}): Promise<string> {
  const { remoteUrl, kind, modelSelectionKey, sessionId, messageId, mimeType } = params;

  if (!electronService.isElectron()) {
    // 浏览器模式：无法下载，原样返回（仍可能 401，但至少不会因 IPC 调用崩）
    return remoteUrl;
  }

  // data: 或 blob: 或已经是 koma-local：直接返回
  if (remoteUrl.startsWith('koma-local:') || remoteUrl.startsWith('data:') || remoteUrl.startsWith('blob:')) {
    return remoteUrl;
  }

  const channelId = resolveChannelId(modelSelectionKey);

  try {
    const userData = await electronService.app.getPath('userData');
    const ext = inferExt(kind, remoteUrl);
    const safeSession = (sessionId || 'no-session').replace(/[^\w-]/g, '_');
    const safeMessage = (messageId || `${Date.now()}`).replace(/[^\w-]/g, '_');
    const destPath = `${userData}/koma-chat-media/${safeSession}/${safeMessage}-${kind}-${Date.now()}.${ext}`;

    const asset = await persistMediaAsset({
      projectId: CHAT_PROJECT_PLACEHOLDER, // 仅占位；destPath 显式给了，不会触发 project 路径生成
      kind,
      source: remoteUrl,
      destPath,
      channelId, // 关键：让 fs.downloadFile 自动加 Authorization: Bearer <key>
      mimeType,
      metadata: { chatSessionId: sessionId, chatMessageId: messageId },
    });

    if (asset.localPath) {
      const localUrl = toKomaLocalUrl(asset.localPath);
      logger.info('chat 媒体落盘成功', { sessionId, messageId, kind, localPath: asset.localPath });
      return localUrl;
    }

    // 落盘失败但 persistMediaAsset 没抛错（如 metadata.localPersistFailed）→ 返回 remoteUrl
    logger.warn('chat 媒体落盘未拿到 localPath，回落 remoteUrl', { sessionId, messageId, kind });
    return asset.remoteUrl || remoteUrl;
  } catch (err) {
    logger.warn('chat 媒体落盘失败，回落到原始 URL（可能因鉴权而无法播放）', {
      sessionId, messageId, kind, error: err instanceof Error ? err.message : String(err),
    });
    return remoteUrl;
  }
}
