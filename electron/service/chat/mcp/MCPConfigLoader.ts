/**
 * MCPConfigLoader
 * 从 JSON 文件导入外部 MCP 服务器配置
 * 兼容 Claude Desktop mcpServers 格式
 */
import * as fs from 'fs/promises';
import { mcpManager } from './MCPManager';
import type { MCPServerConfig, MCPConnection, MCPTransportType } from '../types';

// Claude Desktop 兼容格式
interface MCPServersConfig {
  mcpServers: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    transport?: string;
  }>;
}

// 导入结果
interface ImportResult {
  total: number;
  success: number;
  failed: number;
  connections: MCPConnection[];
  errors: Array<{ name: string; error: string }>;
}

/**
 * 推断传输类型
 */
function inferTransport(entry: MCPServersConfig['mcpServers'][string]): MCPTransportType {
  if (entry.transport) {
    return entry.transport as MCPTransportType;
  }
  if (entry.command) return 'stdio';
  if (entry.url?.startsWith('ws')) return 'websocket';
  if (entry.url) return 'sse';
  return 'stdio';
}

/**
 * 将配置条目转换为 MCPServerConfig
 */
function toServerConfig(name: string, entry: MCPServersConfig['mcpServers'][string]): MCPServerConfig {
  return {
    name,
    transport: inferTransport(entry),
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
  };
}

/**
 * 从 JSON 文件导入 MCP 配置
 */
export async function importFromFile(filePath: string): Promise<ImportResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const config = JSON.parse(content) as MCPServersConfig;
  return importFromObject(config);
}

/**
 * 从对象导入 MCP 配置
 */
export async function importFromObject(config: MCPServersConfig): Promise<ImportResult> {
  const servers = config.mcpServers || {};
  const entries = Object.entries(servers);

  const result: ImportResult = {
    total: entries.length,
    success: 0,
    failed: 0,
    connections: [],
    errors: [],
  };

  for (const [name, entry] of entries) {
    try {
      const serverConfig = toServerConfig(name, entry);
      const connection = await mcpManager.connect(serverConfig);
      result.connections.push(connection);
      result.success++;
    } catch (err: any) {
      result.errors.push({ name, error: err.message });
      result.failed++;
    }
  }

  console.log(
    `[MCPConfigLoader] Import complete: ${result.success}/${result.total} success, ${result.failed} failed`
  );

  return result;
}

/**
 * 导出当前 MCP 连接为配置对象
 */
export function exportConfig(): MCPServersConfig {
  const connections = mcpManager.listConnections();
  const mcpServers: MCPServersConfig['mcpServers'] = {};

  for (const conn of connections) {
    // 只导出外部连接（非 internal）
    if (conn.transport === 'internal') continue;

    mcpServers[conn.name] = {
      transport: conn.transport,
    };
  }

  return { mcpServers };
}

/**
 * 导出为 JSON 文件
 */
export async function exportToFile(filePath: string): Promise<void> {
  const config = exportConfig();
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}
