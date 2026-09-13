/**
 * MCP 注册表
 * 管理 MCP 服务器、工具、资源
 * 工具命名强制使用 pluginId:toolName 格式
 */
import type {
  MCPServerDefinition,
  MCPToolDefinition,
  MCPToolHandler,
  MCPResourceDefinition,
  MCPResourceHandler,
  IRegistry,
} from '../types';

// 工具命名空间分隔符
const NAMESPACE_SEPARATOR = ':';

// 生成命名空间化的工具名
function namespacedToolName(pluginId: string | undefined, toolName: string): string {
  if (!pluginId) {
    throw new Error(`Tool "${toolName}" must have a pluginId`);
  }
  // 如果已经包含命名空间，直接返回
  if (toolName.includes(NAMESPACE_SEPARATOR)) {
    return toolName;
  }
  return `${pluginId}${NAMESPACE_SEPARATOR}${toolName}`;
}

// 工具注册表
class MCPToolRegistry implements IRegistry<MCPToolHandler> {
  private tools = new Map<string, MCPToolHandler>();

  register(handler: MCPToolHandler): void {
    const pluginId = handler.definition.pluginId;
    const originalName = handler.definition.name;

    // 强制命名空间
    const namespacedName = namespacedToolName(pluginId, originalName);
    handler.definition.name = namespacedName;

    if (this.tools.has(namespacedName)) {
      console.warn(`[MCPToolRegistry] Tool "${namespacedName}" already registered, overwriting`);
    }
    this.tools.set(namespacedName, handler);
    console.log(`[MCPToolRegistry] Registered tool: ${namespacedName}`);
  }

  unregister(name: string): void {
    if (this.tools.delete(name)) {
      console.log(`[MCPToolRegistry] Unregistered tool: ${name}`);
    }
  }

  get(name: string): MCPToolHandler | undefined {
    return this.tools.get(name);
  }

  list(): MCPToolHandler[] {
    return Array.from(this.tools.values());
  }

  listDefinitions(): MCPToolDefinition[] {
    return this.list().map(h => h.definition);
  }

  listByPlugin(pluginId: string): MCPToolHandler[] {
    return this.list().filter(h => h.definition.pluginId === pluginId);
  }

  unregisterByPlugin(pluginId: string): void {
    const toRemove = this.listByPlugin(pluginId).map(h => h.definition.name);
    toRemove.forEach(name => this.unregister(name));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const handler = this.tools.get(name);
    if (!handler) {
      throw new Error(`Tool "${name}" not found`);
    }
    return handler.handler(args);
  }

  clear(): void {
    this.tools.clear();
  }
}

// 资源注册表
class MCPResourceRegistry implements IRegistry<MCPResourceHandler> {
  private resources = new Map<string, MCPResourceHandler>();

  register(handler: MCPResourceHandler): void {
    const uri = handler.definition.uri;
    if (this.resources.has(uri)) {
      console.warn(`[MCPResourceRegistry] Resource "${uri}" already registered, overwriting`);
    }
    this.resources.set(uri, handler);
    console.log(`[MCPResourceRegistry] Registered resource: ${uri}`);
  }

  unregister(uri: string): void {
    if (this.resources.delete(uri)) {
      console.log(`[MCPResourceRegistry] Unregistered resource: ${uri}`);
    }
  }

  get(uri: string): MCPResourceHandler | undefined {
    return this.resources.get(uri);
  }

  list(): MCPResourceHandler[] {
    return Array.from(this.resources.values());
  }

  listDefinitions(): MCPResourceDefinition[] {
    return this.list().map(h => h.definition);
  }

  // 支持通配符匹配
  findHandler(uri: string): MCPResourceHandler | undefined {
    // 先精确匹配
    const exact = this.resources.get(uri);
    if (exact) return exact;

    // 通配符匹配
    for (const [pattern, handler] of this.resources) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(uri)) {
          return handler;
        }
      }
    }
    return undefined;
  }

  async readResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    const handler = this.findHandler(uri);
    if (!handler) {
      throw new Error(`Resource "${uri}" not found`);
    }
    return handler.handler(uri);
  }

  clear(): void {
    this.resources.clear();
  }
}

// 服务器注册表
class MCPServerRegistry implements IRegistry<MCPServerDefinition> {
  private servers = new Map<string, MCPServerDefinition>();

  register(server: MCPServerDefinition): void {
    if (this.servers.has(server.name)) {
      console.warn(`[MCPServerRegistry] Server "${server.name}" already registered, overwriting`);
    }
    this.servers.set(server.name, server);
    console.log(`[MCPServerRegistry] Registered server: ${server.name} (${server.transport})`);
  }

  unregister(name: string): void {
    if (this.servers.delete(name)) {
      console.log(`[MCPServerRegistry] Unregistered server: ${name}`);
    }
  }

  get(name: string): MCPServerDefinition | undefined {
    return this.servers.get(name);
  }

  list(): MCPServerDefinition[] {
    return Array.from(this.servers.values());
  }

  listByPlugin(pluginId: string): MCPServerDefinition[] {
    return this.list().filter(s => s.pluginId === pluginId);
  }

  unregisterByPlugin(pluginId: string): void {
    const toRemove = this.listByPlugin(pluginId).map(s => s.name);
    toRemove.forEach(name => this.unregister(name));
  }

  clear(): void {
    this.servers.clear();
  }
}

// 导出单例
export const mcpToolRegistry = new MCPToolRegistry();
export const mcpResourceRegistry = new MCPResourceRegistry();
export const mcpServerRegistry = new MCPServerRegistry();

// 聚合 MCP 注册表
export const mcpRegistry = {
  tools: mcpToolRegistry,
  resources: mcpResourceRegistry,
  servers: mcpServerRegistry,

  // 注册完整服务器（自动注册其工具和资源）
  registerServer(server: MCPServerDefinition): void {
    mcpServerRegistry.register(server);
    server.tools.forEach(tool => {
      tool.definition.serverName = server.name;
      tool.definition.pluginId = server.pluginId;
      mcpToolRegistry.register(tool);
    });
    server.resources?.forEach(resource => {
      resource.definition.pluginId = server.pluginId;
      mcpResourceRegistry.register(resource);
    });
  },

  // 注销服务器（自动注销其工具和资源）
  unregisterServer(name: string): void {
    const server = mcpServerRegistry.get(name);
    if (server) {
      server.tools.forEach(tool => mcpToolRegistry.unregister(tool.definition.name));
      server.resources?.forEach(resource => mcpResourceRegistry.unregister(resource.definition.uri));
      mcpServerRegistry.unregister(name);
    }
  },

  // 按插件清理
  unregisterByPlugin(pluginId: string): void {
    mcpServerRegistry.unregisterByPlugin(pluginId);
    mcpToolRegistry.unregisterByPlugin(pluginId);
  },

  clear(): void {
    mcpToolRegistry.clear();
    mcpResourceRegistry.clear();
    mcpServerRegistry.clear();
  },
};
