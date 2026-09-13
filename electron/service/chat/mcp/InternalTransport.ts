/**
 * InternalTransport
 * 将 MCP 请求代理到插件系统的 mcpRegistry
 * 无需外部进程，内部插件直接提供 MCP 能力
 */
import { mcpRegistry } from '../../plugin/registries';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface MCPTransport {
  send(request: MCPRequest): Promise<MCPResponse>;
  close(): Promise<void>;
}

export class InternalTransport implements MCPTransport {
  private pluginId?: string;

  constructor(pluginId?: string) {
    this.pluginId = pluginId;
  }

  async send(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params } = request;

    try {
      const result = await this.dispatch(method, params);
      return { jsonrpc: '2.0', id, result };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err.message },
      };
    }
  }

  private async dispatch(method: string, params?: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'internal-plugin', version: '1.0.0' },
          capabilities: { tools: {}, resources: {} },
        };

      case 'tools/list': {
        // 如果指定了 pluginId，只返回该插件的工具
        const allTools = this.pluginId
          ? mcpRegistry.tools.listByPlugin(this.pluginId).map(h => h.definition)
          : mcpRegistry.tools.listDefinitions();

        return {
          tools: allTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
      }

      case 'tools/call': {
        const name = params?.name as string;
        const args = params?.arguments ?? {};
        const result = await mcpRegistry.tools.callTool(name, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      case 'resources/list': {
        const resources = mcpRegistry.resources.listDefinitions();
        return {
          resources: resources.map(r => ({
            uri: r.uri,
            name: r.name,
            mimeType: r.mimeType,
          })),
        };
      }

      case 'resources/read': {
        const uri = params?.uri as string;
        return mcpRegistry.resources.readResource(uri);
      }

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  async close(): Promise<void> {
    // 内部传输无需清理
  }
}
