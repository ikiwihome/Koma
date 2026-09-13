/**
 * MCPAdapter
 * 将 MCPManager（外部连接）和 mcpRegistry（插件内部）的工具/资源包装为 Capability
 */
import { mcpManager } from '../../chat/mcp';
import { mcpRegistry } from '../registries';
import { capabilityRegistry } from './CapabilityRegistry';
import type { CapabilityDescriptor, CapabilityResult, CapabilitySource } from './types';
import { buildCapabilityId } from './types';
import type { MCPToolDefinition as ExternalToolDef, MCPResource } from '../../chat/types';
import type { MCPToolDefinition as InternalToolDef, MCPResourceDefinition } from '../types';

// ========== 外部 MCP 工具同步 ==========

function registerExternalTool(tool: ExternalToolDef): void {
  const serverName = tool.serverName || 'unknown';
  const source: CapabilitySource = {
    kind: 'mcp-external',
    serverName,
  };

  const descriptor: CapabilityDescriptor = {
    id: buildCapabilityId(source, tool.name),
    name: tool.name,
    type: 'tool',
    description: tool.description,
    tags: ['mcp', 'external', serverName, tool.name],
    inputSchema: tool.inputSchema,
    source,
  };

  const invoker = async (args: unknown): Promise<CapabilityResult> => {
    try {
      const result = await mcpManager.callTool(tool.name, args as Record<string, unknown>);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  capabilityRegistry.register(descriptor, invoker);
}

function registerExternalResource(resource: MCPResource): void {
  const source: CapabilitySource = {
    kind: 'mcp-external',
    serverName: resource.serverName,
  };

  const descriptor: CapabilityDescriptor = {
    id: buildCapabilityId(source, resource.uri),
    name: resource.name,
    type: 'resource',
    description: `MCP Resource: ${resource.name}`,
    tags: ['mcp', 'resource', 'external', resource.serverName],
    source,
  };

  const invoker = async (_args: unknown): Promise<CapabilityResult> => {
    try {
      const result = await mcpManager.readResource(resource.uri);
      return { success: true, data: result.content, mimeType: result.mimeType };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  capabilityRegistry.register(descriptor, invoker);
}

// ========== 内部 MCP 工具同步 ==========

function registerInternalTool(tool: InternalToolDef): void {
  const pluginId = tool.pluginId || 'internal';
  const source: CapabilitySource = {
    kind: 'mcp-internal',
    pluginId,
  };

  const descriptor: CapabilityDescriptor = {
    id: buildCapabilityId(source, tool.name),
    name: tool.name,
    type: 'tool',
    description: tool.description,
    tags: ['mcp', 'internal', pluginId, tool.name],
    inputSchema: tool.inputSchema,
    source,
  };

  const invoker = async (args: unknown): Promise<CapabilityResult> => {
    try {
      const result = await mcpRegistry.tools.callTool(tool.name, args);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  capabilityRegistry.register(descriptor, invoker);
}

function registerInternalResource(resource: MCPResourceDefinition): void {
  const pluginId = resource.pluginId || 'internal';
  const source: CapabilitySource = {
    kind: 'mcp-internal',
    pluginId,
  };

  const descriptor: CapabilityDescriptor = {
    id: buildCapabilityId(source, resource.uri),
    name: resource.name,
    type: 'resource',
    description: resource.description || `Resource: ${resource.name}`,
    tags: ['mcp', 'resource', 'internal', pluginId],
    source,
  };

  const invoker = async (_args: unknown): Promise<CapabilityResult> => {
    try {
      const result = await mcpRegistry.resources.readResource(resource.uri);
      return { success: true, data: result.content, mimeType: result.mimeType };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  capabilityRegistry.register(descriptor, invoker);
}

// ========== 公开方法 ==========

/**
 * 同步所有外部 MCP 连接的工具和资源
 */
export function syncExternalMCP(): void {
  // 清除旧的外部 MCP capabilities
  const existing = capabilityRegistry.list({ sourceKind: 'mcp-external' });
  existing.forEach(d => capabilityRegistry.unregister(d.id));

  const tools = mcpManager.listTools();
  const resources = mcpManager.listResources();

  tools.forEach(registerExternalTool);
  resources.forEach(registerExternalResource);

  console.log(`[MCPAdapter] Synced external MCP: ${tools.length} tools, ${resources.length} resources`);
}

/**
 * 同步所有内部插件 MCP 工具和资源
 */
export function syncInternalMCP(): void {
  // 清除旧的内部 MCP capabilities
  const existing = capabilityRegistry.list({ sourceKind: 'mcp-internal' });
  existing.forEach(d => capabilityRegistry.unregister(d.id));

  const tools = mcpRegistry.tools.listDefinitions();
  const resources = mcpRegistry.resources.listDefinitions();

  tools.forEach(registerInternalTool);
  resources.forEach(registerInternalResource);

  console.log(`[MCPAdapter] Synced internal MCP: ${tools.length} tools, ${resources.length} resources`);
}

/**
 * 同步全部 MCP（外部 + 内部）
 */
export function syncAllMCP(): void {
  syncExternalMCP();
  syncInternalMCP();
}

/**
 * 当外部 MCP 服务器连接/断开时调用
 */
export function onMCPConnectionChanged(): void {
  syncExternalMCP();
}

/**
 * 当内部插件注册/注销 MCP 工具时调用
 */
export function onInternalMCPChanged(): void {
  syncInternalMCP();
}
