/**
 * CapabilityRegistry
 * 统一能力注册表 - Provider/MCP Tool/Resource 的门面层
 * 支持注册、查询、标签匹配、能力解析、统一调用
 */
import { EventEmitter } from 'events';
import type {
  CapabilityDescriptor,
  CapabilityInvoker,
  CapabilityResult,
  CapabilityFilter,
  CapabilityType,
} from './types';

interface CapabilityEntry {
  descriptor: CapabilityDescriptor;
  invoker: CapabilityInvoker;
}

export class CapabilityRegistry extends EventEmitter {
  private capabilities = new Map<string, CapabilityEntry>();

  // ========== 注册 / 注销 ==========

  register(descriptor: CapabilityDescriptor, invoker: CapabilityInvoker): void {
    const existing = this.capabilities.get(descriptor.id);
    if (existing) {
      console.warn(`[CapabilityRegistry] "${descriptor.id}" already registered, overwriting`);
    }
    this.capabilities.set(descriptor.id, { descriptor, invoker });
    this.emit('registered', descriptor);
  }

  unregister(id: string): void {
    const entry = this.capabilities.get(id);
    if (entry) {
      this.capabilities.delete(id);
      this.emit('unregistered', entry.descriptor);
    }
  }

  // 按来源批量注销（插件卸载时用）
  unregisterBySource(sourceKind: string, sourceId: string): void {
    const toRemove: string[] = [];
    for (const [id, entry] of this.capabilities) {
      const src = entry.descriptor.source;
      if (src.kind === sourceKind) {
        if (
          (src.kind === 'mcp-external' && src.serverName === sourceId) ||
          (src.kind === 'mcp-internal' && src.pluginId === sourceId) ||
          (src.kind === 'provider' && src.pluginId === sourceId)
        ) {
          toRemove.push(id);
        }
      }
    }
    toRemove.forEach(id => this.unregister(id));
  }

  // ========== 查询 ==========

  get(id: string): CapabilityDescriptor | undefined {
    return this.capabilities.get(id)?.descriptor;
  }

  list(filter?: CapabilityFilter): CapabilityDescriptor[] {
    let results = Array.from(this.capabilities.values()).map(e => e.descriptor);

    if (filter?.type) {
      results = results.filter(d => d.type === filter.type);
    }
    if (filter?.sourceKind) {
      results = results.filter(d => d.source.kind === filter.sourceKind);
    }
    if (filter?.tags && filter.tags.length > 0) {
      results = results.filter(d =>
        filter.tags!.some(tag => d.tags.includes(tag))
      );
    }
    return results;
  }

  // 按标签查找
  findByTags(tags: string[]): CapabilityDescriptor[] {
    return this.list({ tags });
  }

  // 解析 Agent 的能力需求 → 返回匹配的 Capability 列表
  resolve(requirements: string[]): CapabilityDescriptor[] {
    if (requirements.length === 0) return [];

    const resolved = new Map<string, CapabilityDescriptor>();

    for (const req of requirements) {
      // 先尝试按 ID 精确匹配
      const exact = this.get(req);
      if (exact) {
        resolved.set(exact.id, exact);
        continue;
      }

      // 再按 tag 模糊匹配
      const matches = this.findByTags([req]);
      for (const match of matches) {
        if (!resolved.has(match.id)) {
          resolved.set(match.id, match);
        }
      }
    }

    return Array.from(resolved.values());
  }

  // ========== 调用 ==========

  async invoke(id: string, args: unknown): Promise<CapabilityResult> {
    const entry = this.capabilities.get(id);
    if (!entry) {
      return { success: false, error: `Capability "${id}" not found` };
    }

    try {
      return await entry.invoker(args);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ========== 统计 ==========

  get size(): number {
    return this.capabilities.size;
  }

  listTypes(): Map<CapabilityType, number> {
    const counts = new Map<CapabilityType, number>();
    for (const entry of this.capabilities.values()) {
      const t = entry.descriptor.type;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    return counts;
  }

  clear(): void {
    this.capabilities.clear();
    this.emit('cleared');
  }
}

export const capabilityRegistry = new CapabilityRegistry();
