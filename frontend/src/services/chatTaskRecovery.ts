/**
 * Chat 内异步媒体任务的轮询 / 重启恢复服务。
 *
 * 设计：
 *  - 复用 taskHandlerRegistry（itvTaskHandler / ttiTaskHandler 的统一 getSnapshot 接口）
 *  - 不依赖 taskQueueStore（因为 chat 是全局，不属于任何 project）
 *  - 任务持久化就是 chat_messages.extras_json.metadata.mediaResult 本身
 *    （包含 taskId / taskKind / taskCapability / modelSelectionKey）
 *  - 应用重启后 ChatPage 调 recoverPendingChatTasks 扫描并恢复轮询
 *
 * 单条任务轮询：每 2s 调 handler.getSnapshot；succeeded → onComplete；failed → onError
 * 调用方负责把结果通过 updateMessage 写回 chat history。
 */
import { taskHandlerRegistry } from './taskHandlerRegistry';
import { persistChatMediaToLocal } from './chatMediaPersistence';
import type { ChatMessage } from '../chat/types';
import type { AsyncTask } from '../types';
import {
  getImageOutputSources,
  type ChatImageRef,
  type MediaResultMeta,
} from '../components/chat/chatMediaGeneration';
import { createLogger } from '../store/logger';

const logger = createLogger('ChatTaskRecovery');

const POLL_INTERVAL_MS = 2_000;

export interface ChatTaskCallbacks {
  /** 成功完成：根据 taskKind 决定 video 或 images（已落盘为 koma-local:// URL） */
  onComplete: (result: { video?: string; images?: ChatImageRef[] }) => void;
  /** 任务失败 / 错误 */
  onError: (errorMessage: string) => void;
}

/** 上下文：用于落盘文件命名 + Authorization key 解析 */
export interface ChatTaskContext {
  sessionId?: string;
  messageId?: string;
}

/** 取消句柄。返回 true 表示成功取消，false 表示任务已结束。 */
export type ChatTaskCancel = () => boolean;

/**
 * 启动一个 chat 媒体任务的轮询。
 * 不抛错（轮询期间的瞬时错误自动重试，达到 max retries 才 onError）。
 */
export function pollChatMediaTask(params: {
  taskId: string;
  taskKind: 'image' | 'video' | 'audio';
  taskCapability: string;
  modelSelectionKey?: string;
  context?: ChatTaskContext;
  callbacks: ChatTaskCallbacks;
}): ChatTaskCancel {
  const { taskId, taskKind, taskCapability, modelSelectionKey, context, callbacks } = params;

  const handlerType = taskKind === 'video' ? 'itv'
    : taskKind === 'image' ? 'tti'
    : 'tts';
  const handler = taskHandlerRegistry.get(handlerType);
  if (!handler) {
    callbacks.onError(`未注册的任务类型: ${handlerType}`);
    return () => false;
  }

  // 构造伪 AsyncTask 给 handler.getSnapshot 用 — 它实际只读 remoteTaskId。
  const fakeTask = {
    remoteTaskId: taskId,
    capability: taskCapability,
  } as Pick<AsyncTask, 'remoteTaskId' | 'capability'> as AsyncTask;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  const tick = async () => {
    if (cancelled) return;
    try {
      const snapshot = await handler.getSnapshot(fakeTask, {
        selection: modelSelectionKey,
        capability: taskCapability as any,
      });
      if (cancelled) return;

      if (snapshot.state === 'succeeded') {
        try {
          if (taskKind === 'video') {
            // 视频：单源
            const remoteSource = handler.extractSource(snapshot.output);
            if (!remoteSource) {
              callbacks.onError('任务成功但未返回视频源');
              return;
            }
            const localized = await persistChatMediaToLocal({
              remoteUrl: remoteSource,
              kind: 'video',
              modelSelectionKey,
              sessionId: context?.sessionId,
              messageId: context?.messageId,
            });
            callbacks.onComplete({ video: localized });
          } else if (taskKind === 'image') {
            // 图片：拆 metadata.batchImages 多张（与分镜 getImmediateImageOutputs 对齐）
            const remoteSources = getImageOutputSources(snapshot.output);
            if (remoteSources.length === 0) {
              callbacks.onError('任务成功但未返回图片源');
              return;
            }
            const localizedImages: ChatImageRef[] = [];
            for (let i = 0; i < remoteSources.length; i += 1) {
              const remoteUrl = /^https?:\/\//i.test(remoteSources[i]) ? remoteSources[i] : undefined;
              const localized = await persistChatMediaToLocal({
                remoteUrl: remoteSources[i],
                kind: 'image',
                modelSelectionKey,
                sessionId: context?.sessionId,
                messageId: context?.messageId,
              });
              localizedImages.push({
                id: `chat-image-${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 8)}`,
                label: `图片${i + 1}`,
                source: localized,
                remoteUrl, // ★ 保留原始远程 URL，下次作为参考图时直接复用，不必走图床
                origin: 'generated',
              });
            }
            callbacks.onComplete({ images: localizedImages });
          } else {
            callbacks.onError(`暂不支持的 taskKind: ${taskKind}`);
          }
        } catch (err) {
          callbacks.onError(err instanceof Error ? err.message : '处理任务结果失败');
        }
        return; // 终止轮询
      }
      if (snapshot.state === 'failed') {
        callbacks.onError(snapshot.error || '生成失败');
        return;
      }
      // pending / processing → 继续轮询
      consecutiveErrors = 0;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    } catch (err) {
      if (cancelled) return;
      consecutiveErrors += 1;
      logger.warn(`轮询出错 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`, { taskId, error: err });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        callbacks.onError(err instanceof Error ? err.message : '轮询失败');
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  // 立即开始第一次（避免等 2s）
  void tick();

  return () => {
    if (cancelled) return false;
    cancelled = true;
    if (timer) clearTimeout(timer);
    return true;
  };
}

/**
 * 扫描 chat history 中所有 generating=true 且带 taskId 的消息，对每条恢复轮询。
 * 返回每条消息对应的 cancel 句柄（messageId → cancel）。
 *
 * 完成或失败时会自动调 updateMessage 把结果写回 metadata.mediaResult。
 */
export function recoverPendingChatTasks(params: {
  messages: ChatMessage[];
  sessionId?: string;
  updateMessage: (id: string, updater: (msg: ChatMessage) => ChatMessage) => void;
}): Map<string, ChatTaskCancel> {
  const { messages, sessionId, updateMessage } = params;
  const cancels = new Map<string, ChatTaskCancel>();

  for (const msg of messages) {
    const meta = (msg.metadata as { mediaResult?: MediaResultMeta } | undefined)?.mediaResult;
    if (!meta) continue;
    if (!meta.generating) continue;
    if (!meta.taskId || !meta.taskKind || !meta.taskCapability) {
      // generating=true 但无 taskId（旧数据 / 异常状态）→ 标 error
      updateMessage(msg.id, (m) => ({
        ...m,
        metadata: {
          ...(m.metadata || {}),
          mediaResult: {
            ...meta,
            generating: false,
            error: '任务被中断（缺少恢复信息），请使用"再次生成"重试',
          },
        },
      }));
      continue;
    }

    logger.info('恢复 chat 异步任务', {
      messageId: msg.id,
      taskId: meta.taskId,
      taskKind: meta.taskKind,
    });

    const cancel = pollChatMediaTask({
      taskId: meta.taskId,
      taskKind: meta.taskKind,
      taskCapability: meta.taskCapability,
      modelSelectionKey: meta.modelSelectionKey,
      context: { sessionId, messageId: msg.id },
      callbacks: {
        onComplete: (result) => {
          updateMessage(msg.id, (m) => {
            const cur = (m.metadata as { mediaResult?: MediaResultMeta } | undefined)?.mediaResult;
            if (!cur) return m;
            return {
              ...m,
              metadata: {
                ...(m.metadata || {}),
                mediaResult: {
                  ...cur,
                  generating: false,
                  video: result.video ?? cur.video,
                  images: result.images && result.images.length > 0 ? result.images : cur.images,
                },
              },
            };
          });
        },
        onError: (errorMessage) => {
          updateMessage(msg.id, (m) => {
            const cur = (m.metadata as { mediaResult?: MediaResultMeta } | undefined)?.mediaResult;
            if (!cur) return m;
            return {
              ...m,
              metadata: {
                ...(m.metadata || {}),
                mediaResult: { ...cur, generating: false, error: errorMessage },
              },
            };
          });
        },
      },
    });

    cancels.set(msg.id, cancel);
  }

  return cancels;
}
