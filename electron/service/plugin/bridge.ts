/**
 * 插件桥接层
 * 将前端 Provider 调用代理到 Electron 侧
 */
import { providerRegistry, mcpRegistry, agentRegistry } from './registries';
import type { ProviderDefinition, MCPToolDefinition, WorkerAgentDefinition } from './types';

class PluginBridge {
  /**
   * 调用 Provider
   */
  async callProvider(
    kind: 'tti' | 'itv' | 'tts' | 'llm' | 'image-hosting',
    type: string,
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    const def = providerRegistry.get(type);
    if (!def) {
      throw new Error(`Provider "${type}" not found`);
    }

    if (def.kind !== kind) {
      throw new Error(`Provider "${type}" is not a ${kind} provider`);
    }

    // 获取或创建 Provider 实例
    const instance = await this.getProviderInstance(def, args[0]); // args[0] 通常是 config

    // 调用方法
    if (typeof (instance as any)[method] !== 'function') {
      throw new Error(`Method "${method}" not found on provider "${type}"`);
    }

    try {
      return await (instance as any)[method](...args.slice(1));
    } catch (err: any) {
      console.error('[PluginBridge] callProvider failed', {
        kind,
        type,
        method,
        error: err?.message || String(err),
        stack: err?.stack,
      });
      throw err;
    }
  }

  // Provider 实例缓存
  private providerInstances = new Map<string, unknown>();

  private async getProviderInstance(def: ProviderDefinition, config: unknown): Promise<unknown> {
    const cacheKey = `${def.type}:${JSON.stringify(config)}`;

    if (!this.providerInstances.has(cacheKey)) {
      const instance = await def.factory(config, {});
      this.providerInstances.set(cacheKey, instance);
    }

    return this.providerInstances.get(cacheKey);
  }

  /**
   * 清除 Provider 实例缓存
   */
  clearProviderCache(type?: string): void {
    if (type) {
      for (const key of this.providerInstances.keys()) {
        if (key.startsWith(`${type}:`)) {
          this.providerInstances.delete(key);
        }
      }
    } else {
      this.providerInstances.clear();
    }
  }

  /**
   * 列出可用 Provider
   */
  listProviders(kind?: 'tti' | 'itv' | 'tts' | 'llm' | 'image-hosting'): ProviderDefinition[] {
    if (kind) {
      return providerRegistry.listByKind(kind);
    }
    return providerRegistry.list();
  }

  /**
   * 调用 MCP 工具
   */
  async callMCPTool(name: string, args: unknown): Promise<unknown> {
    return mcpRegistry.tools.callTool(name, args);
  }

  /**
   * 列出 MCP 工具
   */
  listMCPTools(): MCPToolDefinition[] {
    return mcpRegistry.tools.listDefinitions();
  }

  /**
   * 读取 MCP 资源
   */
  async readMCPResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    return mcpRegistry.resources.readResource(uri);
  }

  /**
   * 列出 Worker Agent
   */
  listAgents(): WorkerAgentDefinition[] {
    return agentRegistry.list();
  }

  /**
   * 按能力查找 Agent
   */
  findAgentsByCapability(capability: string): WorkerAgentDefinition[] {
    return agentRegistry.listByCapability(capability);
  }
}

export const pluginBridge = new PluginBridge();
