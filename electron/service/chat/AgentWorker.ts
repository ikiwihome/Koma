/**
 * AgentWorker
 * 独立的 Worker Agent 执行引擎
 * 每个 Worker 拥有自己的 ReAct 图，支持同步和流式执行
 * 工具来源: CapabilityRegistry (统一) + MCPManager (兼容) + mcpRegistry (兼容)
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createLLM, createAgentGraph, createToolsFromMCP, streamAgentGraph } from './AgentGraph';
import { mcpManager } from './mcp';
import { mcpRegistry } from '../plugin/registries';
import { capabilityRegistry } from '../plugin/capability';
import { createCapabilityTools } from './CapabilityBridge';
import type { WorkerAgentDefinition, AgentInput, AgentEvent } from '../plugin/types';
import type { SessionConfig, MCPToolDefinition } from './types';

export interface AgentResult {
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ name: string; result: unknown }>;
  error?: string;
}

export class AgentWorker {
  private definition: WorkerAgentDefinition;
  private llm: BaseChatModel;
  private tools: DynamicStructuredTool[];

  constructor(definition: WorkerAgentDefinition, baseConfig: SessionConfig) {
    this.definition = definition;

    // 使用 Worker 自己的配置覆盖基础配置
    const workerConfig: SessionConfig = {
      ...baseConfig,
      systemPrompt: definition.systemPrompt || baseConfig.systemPrompt,
      temperature: definition.temperature ?? baseConfig.temperature,
      maxTokens: definition.maxTokens ?? baseConfig.maxTokens,
    };

    this.llm = createLLM(workerConfig);

    // 工具来源优先级: CapabilityRegistry > MCPManager + mcpRegistry
    const capabilityTools = this.resolveCapabilityTools(definition);

    if (capabilityTools.length > 0) {
      // 使用 CapabilityRegistry 解析的工具
      this.tools = capabilityTools;
    } else {
      // 回退: 合并 MCPManager（外部）+ mcpRegistry（插件内部）
      const externalTools = mcpManager.listTools();
      const internalDefs = mcpRegistry.tools.listDefinitions();
      const internalTools: MCPToolDefinition[] = internalDefs.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        serverName: t.serverName || t.pluginId || 'internal',
      }));
      const allTools = this.deduplicateTools([...externalTools, ...internalTools]);
      this.tools = createToolsFromMCP(allTools, definition.tools);
    }
  }

  /**
   * 通过 CapabilityRegistry 解析 Worker 所需的工具
   */
  private resolveCapabilityTools(definition: WorkerAgentDefinition): DynamicStructuredTool[] {
    const capabilities = definition.capabilities || [];
    if (capabilities.length === 0 && (!definition.tools || definition.tools.length === 0)) {
      return [];
    }

    // 从 capabilities 标签解析
    const resolved = capabilityRegistry.resolve(capabilities);

    // 如果有 allowedTools 列表，也按 ID 查找
    if (definition.tools && definition.tools.length > 0) {
      for (const toolName of definition.tools) {
        const found = capabilityRegistry.findByTags([toolName]);
        found.forEach(d => {
          if (!resolved.find(r => r.id === d.id)) {
            resolved.push(d);
          }
        });
      }
    }

    // 只取 tool 类型的 capability
    const toolCapabilities = resolved.filter(d => d.type === 'tool');
    if (toolCapabilities.length === 0) return [];

    return createCapabilityTools(toolCapabilities);
  }

  get id(): string {
    return this.definition.id;
  }

  get name(): string {
    return this.definition.name;
  }

  get capabilities(): string[] {
    return this.definition.capabilities;
  }

  /**
   * 同步执行
   */
  async invoke(input: AgentInput): Promise<AgentResult> {
    try {
      const graph = createAgentGraph(this.llm, this.tools, this.definition.systemPrompt);

      const messages: BaseMessage[] = [new HumanMessage(input.message)];
      if (input.context) {
        // 将上下文作为系统消息前置
        const contextStr = Object.entries(input.context)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\n');
        messages.unshift(new SystemMessage(`Context:\n${contextStr}`));
      }

      const result = await graph.invoke({ messages });
      const lastMsg = result.messages[result.messages.length - 1];

      if (lastMsg instanceof AIMessage) {
        const content = typeof lastMsg.content === 'string'
          ? lastMsg.content
          : JSON.stringify(lastMsg.content);
        return { content };
      }

      return { content: '', error: 'No response from agent' };
    } catch (err: any) {
      return { content: '', error: err.message };
    }
  }

  /**
   * 流式执行
   */
  async *stream(input: AgentInput, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    try {
      const graph = createAgentGraph(this.llm, this.tools, this.definition.systemPrompt);

      const messages: BaseMessage[] = [new HumanMessage(input.message)];
      if (input.context) {
        const contextStr = Object.entries(input.context)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\n');
        messages.unshift(new SystemMessage(`Context:\n${contextStr}`));
      }

      for await (const event of streamAgentGraph(graph, messages, signal)) {
        if (signal?.aborted) break;

        if (event.type === 'chunk') {
          yield { type: 'chunk', data: { content: event.content, reasoning: event.reasoning } };
        } else if (event.type === 'tool') {
          if (event.toolCall) {
            yield { type: 'tool_call', data: event.toolCall };
          }
          if (event.toolResult) {
            yield { type: 'tool_result', data: event.toolResult };
          }
        } else if (event.type === 'done') {
          yield { type: 'done', data: null };
        }
      }
    } catch (err: any) {
      yield { type: 'error', data: { message: err.message } };
    }
  }

  /**
   * 工具去重（按 name，内部优先）
   */
  private deduplicateTools(tools: MCPToolDefinition[]): MCPToolDefinition[] {
    const map = new Map<string, MCPToolDefinition>();
    for (const tool of tools) {
      if (!map.has(tool.name)) {
        map.set(tool.name, tool);
      }
    }
    return Array.from(map.values());
  }
}

/**
 * Worker 工厂
 */
export function createWorker(
  definition: WorkerAgentDefinition,
  baseConfig: SessionConfig
): AgentWorker {
  return new AgentWorker(definition, baseConfig);
}
