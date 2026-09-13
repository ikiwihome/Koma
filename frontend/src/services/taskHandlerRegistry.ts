/**
 * 异步媒体任务处理器注册表
 *
 * 设计目的：消除 MediaGenerationService 等处按 task.type 字面量
 * （'tti' | 'itv' | 'tts' | ...）的 if/switch 分发。新增任务类型仅需：
 *   1) 在 services/taskHandlers/ 下添加一个 TaskHandler 实现
 *   2) 在本目录的内置注册块中追加一行
 * 不需要修改任何分发点。
 *
 * 与 frontend/src/providers/registry.ts 的设计对齐（注册表 + 派生）。
 */
import type { AsyncTask, ProviderTaskSnapshot } from '../types';
import type { MediaKind } from '../types/media';
import type { ModelCapability } from '../providers/channel/types';

export interface TaskHandlerSnapshotOptions {
  /** 用户选择的渠道/模型 selection key（resolved） */
  selection?: string;
  /** 解析后的能力。若 task.capability 缺失则使用 handler.defaultCapability */
  capability: ModelCapability;
}

/**
 * 一个 TaskHandler 描述一类异步媒体任务的处理逻辑：
 * - 它对应的媒体类型（kind）
 * - 默认能力（task.capability 缺失时使用）
 * - 如何拉取远程任务快照
 * - 如何从 Provider output 中提取媒体源
 */
export interface TaskHandler {
  /** 任务类型唯一标识，对应 AsyncTask.type */
  readonly type: string;
  /** 该任务产出的媒体类型 */
  readonly kind: MediaKind;
  /** 该任务默认 capability（task.capability 缺失时使用） */
  readonly defaultCapability: ModelCapability;
  /**
   * 拉取远程任务快照。具体 Provider 调用在各 handler 内部完成，
   * 上层无需感知 TTI/ITV/TTS 不同 Provider 的签名差异。
   */
  getSnapshot(task: AsyncTask, options: TaskHandlerSnapshotOptions): Promise<ProviderTaskSnapshot<any>>;
  /** 从 Provider output 中提取媒体源（URL 或本地路径） */
  extractSource(output: any): string | undefined;
}

class TaskHandlerRegistryImpl {
  private readonly handlers = new Map<string, TaskHandler>();

  register(handler: TaskHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Task handler for type "${handler.type}" already registered`);
    }
    this.handlers.set(handler.type, handler);
  }

  get(type: string): TaskHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  list(): TaskHandler[] {
    return Array.from(this.handlers.values());
  }

  /**
   * 按媒体类型反查 handler（kind → type）。
   * 用于 inferTaskType(kind) 这样的反向派发；如有多个匹配返回第一个。
   */
  findByKind(kind: MediaKind): TaskHandler | undefined {
    return this.list().find((h) => h.kind === kind);
  }
}

export const taskHandlerRegistry = new TaskHandlerRegistryImpl();
