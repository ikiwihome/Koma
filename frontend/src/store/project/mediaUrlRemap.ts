/**
 * Media URL remapping utilities
 *
 * In Electron, editing/playback should prefer local filesystem paths to avoid CORS
 * and to keep ffmpeg/canvas pipelines working reliably.
 *
 * However, timeline clips may persist remote URLs (http/https) directly.
 * This module builds a best-effort map { remoteUrl -> localPath } from project data
 * and rewrites timeline clip sources to local paths on load.
 */
import { electronService, batchApi } from '../../services/electronService';

function trimUrlTail(candidate: string): string {
  let s = String(candidate || '').trim();
  for (let i = 0; i < 10; i += 1) {
    const before = s;
    s = s.replace(/[)"'<>.,;\]]+$/g, '');
    s = s.replace(/(%22|%27|%3E|%3C)+$/gi, '');
    if (s === before) break;
  }
  return s;
}

function looksLikeRemoteUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function collectRemoteToLocalPairs(value: unknown, out: Map<string, string>): void {
  const visited = new Set<any>();
  const stack: unknown[] = [value];
  let steps = 0;

  while (stack.length > 0 && steps < 50_000) {
    steps += 1;
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (visited.has(cur as any)) continue;
    visited.add(cur as any);

    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i -= 1) stack.push(cur[i]);
      continue;
    }

    const obj = cur as Record<string, unknown>;
    const remoteUrl = typeof obj.remoteUrl === 'string' ? trimUrlTail(obj.remoteUrl) : null;
    const localPath = typeof obj.localPath === 'string' ? obj.localPath : null;
    if (remoteUrl && localPath && !out.has(remoteUrl)) {
      out.set(remoteUrl, localPath);
    }

    for (const v of Object.values(obj)) stack.push(v);
  }
}

export async function buildProjectRemoteToLocalMap(projectPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!electronService.isElectron()) return map;

  // 从项目路径提取 projectId
  const parts = projectPath.replace(/\\/g, '/').split('/');
  const projectId = parts[parts.length - 1] || '';
  if (!projectId) return map;

  // 从 SQLite 加载实体数据（通过 IPC）
  try {
    const [characters, scenes, props, timeline, shotMetas] = await Promise.all([
      batchApi.loadAllCharacters(projectId),
      batchApi.loadAllScenes(projectId),
      batchApi.loadAllProps(projectId),
      batchApi.loadProjectTimeline(projectId),
      batchApi.listShotMetas(projectId),
    ]);

    if (characters) collectRemoteToLocalPairs(characters, map);
    if (scenes) collectRemoteToLocalPairs(scenes, map);
    if (props) collectRemoteToLocalPairs(props, map);
    if (timeline) collectRemoteToLocalPairs(timeline, map);
    if (shotMetas) collectRemoteToLocalPairs(shotMetas, map);
  } catch {
    // ignore
  }

  return map;
}

export async function remapTimelineClipSourcesToLocal<T extends { tracks?: any[] }>(
  projectPath: string,
  timeline: T | null
): Promise<{ timeline: T | null; changed: boolean }> {
  if (!electronService.isElectron()) return { timeline, changed: false };
  if (!timeline || !Array.isArray((timeline as any).tracks)) return { timeline, changed: false };

  const map = await buildProjectRemoteToLocalMap(projectPath);
  if (map.size === 0) return { timeline, changed: false };

  let changed = false;
  const tracks = (timeline as any).tracks as any[];
  for (const track of tracks) {
    const clips = track?.clips;
    if (!Array.isArray(clips)) continue;
    for (const clip of clips) {
      const srcRaw = clip?.src;
      if (typeof srcRaw !== 'string') continue;

      const srcTrimmed = trimUrlTail(srcRaw);
      if (srcTrimmed !== srcRaw) {
        clip.src = srcTrimmed;
        changed = true;
      }

      if (looksLikeRemoteUrl(srcTrimmed)) {
        const local = map.get(srcTrimmed);
        if (local) {
          clip.src = local;
          changed = true;
        }
      }
    }
  }

  return { timeline, changed };
}
