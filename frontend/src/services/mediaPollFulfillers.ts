/**
 * Renderer 端 fulfillers，让主进程的 media:tti / media:itv / media:tts handler
 * 能委托回 renderer 调原 provider 代码 + 落盘 + 绑定 ownerRef。
 *
 * 架构上这是 Phase 4-B 的"瘦腰"：主进程拥有 polling 状态机 + AbortController；
 * provider 11k 行代码不动，只通过 delegateToRenderer 在每个 tick 被调一次。
 *
 * 注册时机：app 初始化（在 ./services 下任意确定执行的入口里 import 即可触发副作用）。
 */
import { registerDelegate } from './tasksDelegate';
import { taskHandlerRegistry } from './taskHandlerRegistry';
import { persistMediaAsset } from './mediaPersistenceService';
import { bindOwnerRefMedia } from './mediaTaskBindingService';
import { ensureRemoteUrlForImageAsset } from './mediaRemoteUrlService';
import { createLogger } from '../store/logger';
import type { ModelCapability } from '../providers/channel/types';
import type { MediaKind, MediaOwnerRef, StoredMediaAsset } from '../types/media';
import type { ProviderTaskSnapshot } from '../types';

function mergeMediaMetadata(
  base: StoredMediaAsset,
  patch: Partial<StoredMediaAsset>
): StoredMediaAsset {
  return {
    ...base,
    ...patch,
    metadata: {
      ...(base.metadata || {}),
      ...(patch.metadata || {}),
    },
  };
}

const logger = createLogger('MediaPollFulfillers');

interface SnapshotRequest {
  rendererHandlerType: string;
  remoteTaskId: string;
  channelId?: string;
  modelId?: string;
  capability?: string;
  selection?: string;
}

interface SnapshotResponse {
  state: 'pending' | 'processing' | 'succeeded' | 'failed';
  progress?: number;
  output?: unknown;
  error?: string;
}

interface PersistRequest {
  kind: MediaKind;
  snapshotOutput: unknown;
  projectId: string;
  ownerRef?: MediaOwnerRef;
  providerTaskId?: string;
  channelId?: string;
  modelId?: string;
  capability?: string;
  extra?: Record<string, unknown>;
}

interface PersistResponse {
  asset: StoredMediaAsset;
}

function snapshotStateMap(snapshot: ProviderTaskSnapshot<unknown>): SnapshotResponse['state'] {
  switch (snapshot.state) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    default: return 'processing';
  }
}

let registered = false;

export function registerMediaPollFulfillers(): void {
  if (registered) return;
  registered = true;

  // 1) snapshot：调原 TaskHandler.getSnapshot
  registerDelegate<SnapshotRequest, SnapshotResponse>('media:snapshot', async (args) => {
    const handler = taskHandlerRegistry.get(args.rendererHandlerType);
    if (!handler) {
      throw new Error(`未知任务类型: ${args.rendererHandlerType}`);
    }
    // handler.getSnapshot 期待一个 task-shape 对象 + options
    const taskShape = {
      remoteTaskId: args.remoteTaskId,
      channelId: args.channelId,
      modelId: args.modelId,
      capability: args.capability,
    } as Parameters<typeof handler.getSnapshot>[0];
    const options = {
      selection: args.selection,
      capability: (args.capability ?? handler.defaultCapability) as ModelCapability,
    };
    const snapshot = await handler.getSnapshot(taskShape, options);
    return {
      state: snapshotStateMap(snapshot),
      progress: typeof (snapshot as { progress?: number }).progress === 'number'
        ? (snapshot as { progress?: number }).progress
        : undefined,
      output: snapshot.output,
      error: (snapshot as { error?: string }).error,
    };
  });

  // 2) persist：下载 / 写资产 / 绑定 ownerRef
  registerDelegate<PersistRequest, PersistResponse>('media:persist', async (args) => {
    const handler = (() => {
      // 通过 kind 反查任意一个对应 handler 用于 extractSource
      return taskHandlerRegistry.findByKind(args.kind);
    })();
    if (!handler) {
      throw new Error(`未知媒体 kind: ${args.kind}`);
    }
    const source = handler.extractSource(args.snapshotOutput);
    if (!source) {
      throw new Error('任务完成但未返回结果地址');
    }

    const persisted = await persistMediaAsset({
      projectId: args.projectId,
      kind: args.kind,
      source,
      destPath: typeof args.extra?.destPath === 'string' ? args.extra.destPath : undefined,
      ownerRef: args.ownerRef,
      providerTaskId: args.providerTaskId,
      channelId: args.channelId,
      modelId: args.modelId,
      capability: args.capability,
      metadata: {
        ...(args.channelId ? { channelId: args.channelId } : undefined),
        ...(args.modelId ? { modelId: args.modelId } : undefined),
        ...(args.capability ? { capability: args.capability } : undefined),
      },
    });

    // 合并 caller-specific metadata（prompt / compilation / batch / durationMs 等）
    const baseEnriched = mergeMediaMetadata(persisted, {
      providerTaskId: args.providerTaskId,
      channelId: args.channelId,
      modelId: args.modelId,
      capability: args.capability,
    });
    const callerPatch = (args.extra?.assetMetadataPatch as Partial<StoredMediaAsset> | undefined) || undefined;
    const enriched = callerPatch ? mergeMediaMetadata(baseEnriched, callerPatch) : baseEnriched;

    const finalAsset = args.kind === 'image'
      ? await ensureRemoteUrlForImageAsset({ projectId: args.projectId, asset: enriched, policy: 'best-effort' })
      : enriched;

    const bindOwner = (args.extra?.bindOwner as boolean | undefined) ?? true;
    if (bindOwner && args.ownerRef) {
      try {
        await bindOwnerRefMedia(args.projectId, args.ownerRef, finalAsset);
      } catch (err) {
        logger.error('绑定 ownerRef 失败', err);
        throw err;
      }
    }

    return { asset: finalAsset };
  });
}
