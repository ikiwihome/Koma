/**
 * 统一能力系统 (Capability System) 类型定义
 * 将 Provider/MCP Tool/Resource 统一为 Capability 抽象
 */

// ========== 能力类型 ==========

export type CapabilityType = 'tool' | 'provider' | 'resource';

// 能力来源
export type CapabilitySourceKind = 'mcp-external' | 'mcp-internal' | 'provider' | 'builtin';

export type CapabilitySource =
  | { kind: 'mcp-external'; serverName: string }
  | { kind: 'mcp-internal'; pluginId: string }
  | { kind: 'provider'; pluginId?: string; providerKind: 'tti' | 'itv' | 'tts' | 'llm' | 'image-hosting' }
  | { kind: 'builtin' };

// 能力描述符
export interface CapabilityDescriptor {
  id: string;                         // "mcp:serverName:toolName" | "provider:tti:dall-e"
  name: string;
  type: CapabilityType;
  description: string;
  tags: string[];                     // 语义标签: ['image-generation', 'tti']
  inputSchema?: Record<string, unknown>;
  source: CapabilitySource;
}

// 能力调用结果
export interface CapabilityResult {
  success: boolean;
  data?: unknown;
  error?: string;
  mimeType?: string;
}

// 能力调用器
export type CapabilityInvoker = (args: unknown) => Promise<CapabilityResult>;

// 查询过滤条件
export interface CapabilityFilter {
  type?: CapabilityType;
  tags?: string[];                    // 任一匹配即可
  sourceKind?: CapabilitySourceKind;
}

// ========== 能力 ID 构建工具 ==========

export function buildCapabilityId(source: CapabilitySource, name: string): string {
  switch (source.kind) {
    case 'mcp-external':
      return `mcp:${source.serverName}:${name}`;
    case 'mcp-internal':
      return `plugin:${source.pluginId}:${name}`;
    case 'provider':
      return `provider:${source.providerKind}:${name}`;
    case 'builtin':
      return `builtin:${name}`;
  }
}

// ========== Provider 能力标签映射 ==========

export const PROVIDER_KIND_TAGS: Record<string, string[]> = {
  tti: ['image-generation', 'text-to-image', 'tti'],
  itv: ['video-generation', 'image-to-video', 'itv'],
  tts: ['text-to-speech', 'audio-generation', 'tts'],
  llm: ['language-model', 'text-generation', 'llm'],
};
