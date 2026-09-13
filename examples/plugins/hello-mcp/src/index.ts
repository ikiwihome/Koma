/**
 * Hello MCP 示例插件
 * 演示如何创建一个 internal MCP 插件
 */
import type { ElectronPluginAPI, MCPServerDefinition } from '@anthropic/plugin-sdk';

export async function onActivate(api: ElectronPluginAPI): Promise<void> {
  api.log.info('Hello MCP plugin activated');
}

export async function onDeactivate(): Promise<void> {
  // 清理资源
}

export function createMCPServer(): MCPServerDefinition {
  return {
    name: 'hello-mcp',
    transport: 'internal',
    tools: [
      {
        definition: {
          name: 'get_time',
          description: '获取当前时间，可选时区参数',
          inputSchema: {
            type: 'object',
            properties: {
              timezone: {
                type: 'string',
                description: '时区，如 Asia/Shanghai',
              },
            },
          },
        },
        handler: async (args: { timezone?: string } | undefined) => {
          const tz = args?.timezone || 'Asia/Shanghai';
          const now = new Date();
          try {
            return {
              time: now.toLocaleString('zh-CN', { timeZone: tz }),
              timezone: tz,
              timestamp: now.getTime(),
            };
          } catch {
            return { time: now.toISOString(), timezone: 'UTC', timestamp: now.getTime() };
          }
        },
      },
      {
        definition: {
          name: 'echo',
          description: '回显输入的文本，可选前缀',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '要回显的文本' },
              prefix: { type: 'string', description: '前缀文本' },
            },
            required: ['text'],
          },
        },
        handler: async (args: { text: string; prefix?: string }) => {
          const prefix = args.prefix || '[Echo]';
          return { message: `${prefix} ${args.text}` };
        },
      },
    ],
    resources: [
      {
        definition: {
          uri: 'hello://info',
          name: '插件信息',
          description: '返回 Hello MCP 插件的基本信息',
          mimeType: 'application/json',
        },
        handler: async () => ({
          content: JSON.stringify({
            name: 'Hello MCP',
            version: '1.0.0',
            description: '示例 MCP 插件',
          }),
          mimeType: 'application/json',
        }),
      },
    ],
  };
}
