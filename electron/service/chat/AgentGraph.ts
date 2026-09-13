/**
 * LangGraph 智能体图构建
 * ReAct 模式: agent -> (tool?) -> agent -> END
 */
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { BaseMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SessionConfig, MCPToolDefinition, ToolCall, ToolResult } from './types';
import { mcpManager } from './mcp';
import { mcpRegistry } from '../plugin/registries';
import { getDecryptedApiKey } from '../settings/ChannelConfigService';
import { llmProviderRegistry } from './providers';

// 状态定义
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  pendingToolCalls: Annotation<ToolCall[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
});

type AgentStateType = typeof AgentState.State;

/**
 * 创建 LLM 实例
 * 从 LLMProviderRegistry 获取 Provider，不再硬编码 switch-case。
 * 未知 providerType 降级为 'openai-compatible'（兼容自定义 OpenAI 网关）。
 */
export function createLLM(config: SessionConfig): BaseChatModel {
  const storedApiKey = config.llmProfileId
    ? (() => {
        try { return getDecryptedApiKey(config.llmProfileId); }
        catch { return null; }
      })()
    : null;

  const providerType = config.modelProvider || 'openai';
  const resolvedType = llmProviderRegistry.has(providerType)
    ? providerType
    : 'openai-compatible';

  return llmProviderRegistry.create(resolvedType, {
    modelName: config.modelName,
    apiKey: storedApiKey || config.apiKey,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });
}

// JSON Schema 转 Zod Schema (简化版)
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }

  const type = schema.type as string;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  switch (type) {
    case 'object': {
      if (!properties) return z.object({}).passthrough();

      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(properties)) {
        let fieldSchema = jsonSchemaToZod(prop);
        if (!required?.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }
        shape[key] = fieldSchema;
      }
      return z.object(shape).passthrough();
    }
    case 'array':
      return z.array(jsonSchemaToZod((schema.items as Record<string, unknown>) || {}));
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      return z.any();
  }
}

// MCP 工具转换为 LangChain 工具
export function createToolsFromMCP(
  mcpTools: MCPToolDefinition[],
  enabledTools?: string[]
): DynamicStructuredTool[] {
  const filtered = enabledTools
    ? mcpTools.filter(t => enabledTools.includes(t.name))
    : mcpTools;

  return filtered.map(tool => {
    const schema = jsonSchemaToZod(tool.inputSchema);

    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description || `Tool: ${tool.name}`,
      schema,
      func: async (input) => {
        try {
          // 根据工具来源选择调用方式
          let result: unknown;
          if (tool.pluginId) {
            // 内部插件注册的工具
            result = await mcpRegistry.tools.callTool(tool.name, input as Record<string, unknown>);
          } else {
            // 外部 MCP 连接的工具
            result = await mcpManager.callTool(tool.name, input as Record<string, unknown>);
          }
          return JSON.stringify(result);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  });
}

// 创建智能体图
export function createAgentGraph(
  llm: BaseChatModel,
  tools: DynamicStructuredTool[],
  systemPrompt?: string
) {
  // 绑定工具到 LLM
  const llmWithTools = (tools.length > 0 ? llm.bindTools!(tools) : llm) as BaseChatModel;

  // Agent 节点: 调用 LLM
  async function agentNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const messages = state.messages;

    // 添加系统提示词
    let messagesToSend = messages;
    if (systemPrompt && messages.length > 0 && !(messages[0] instanceof SystemMessage)) {
      messagesToSend = [new SystemMessage(systemPrompt), ...messages];
    }

    const response = await llmWithTools.invoke(messagesToSend);

    // 提取工具调用
    const toolCalls: ToolCall[] = [];
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const tc of response.tool_calls) {
        toolCalls.push({
          id: tc.id || `tc_${Date.now()}`,
          name: tc.name,
          arguments: tc.args as Record<string, unknown>,
        });
      }
    }

    return {
      messages: [response],
      pendingToolCalls: toolCalls,
    };
  }

  // Tool 节点: 执行工具
  async function toolNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const toolCalls = state.pendingToolCalls;
    const toolMessages: ToolMessage[] = [];

    for (const tc of toolCalls) {
      const tool = tools.find(t => t.name === tc.name);
      if (!tool) {
        toolMessages.push(new ToolMessage({
          content: JSON.stringify({ error: `Tool not found: ${tc.name}` }),
          tool_call_id: tc.id,
        }));
        continue;
      }

      try {
        const result = await tool.invoke(tc.arguments);
        toolMessages.push(new ToolMessage({
          content: typeof result === 'string' ? result : JSON.stringify(result),
          tool_call_id: tc.id,
        }));
      } catch (err: any) {
        toolMessages.push(new ToolMessage({
          content: JSON.stringify({ error: err.message }),
          tool_call_id: tc.id,
        }));
      }
    }

    return {
      messages: toolMessages,
      pendingToolCalls: [],
    };
  }

  // 条件路由: 判断是否需要调用工具
  function shouldCallTool(state: AgentStateType): 'tool' | typeof END {
    return state.pendingToolCalls.length > 0 ? 'tool' : END;
  }

  // 构建图
  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tool', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldCallTool, {
      tool: 'tool',
      [END]: END,
    })
    .addEdge('tool', 'agent');

  return graph.compile();
}

// 流式执行图
export async function* streamAgentGraph(
  graph: ReturnType<typeof createAgentGraph>,
  messages: BaseMessage[],
  signal?: AbortSignal
): AsyncGenerator<{
  type: 'chunk' | 'tool' | 'done';
  content?: string;
  reasoning?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  messages?: BaseMessage[];
}> {
  const stream = await graph.stream(
    { messages },
    { signal }
  );

  for await (const event of stream) {
    if (signal?.aborted) {
      break;
    }

    // agent 节点输出
    if ('agent' in event) {
      const agentOutput = event.agent as AgentStateType;
      const lastMessage = agentOutput.messages[agentOutput.messages.length - 1];

      if (lastMessage instanceof AIMessage) {
        const content = typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

        // 提取思考过程（如果有）
        let reasoning: string | undefined;
        let actualContent = content;

        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          reasoning = thinkMatch[1].trim();
          actualContent = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        }

        yield {
          type: 'chunk',
          content: actualContent,
          reasoning,
        };

        // 如果有工具调用
        if (agentOutput.pendingToolCalls.length > 0) {
          for (const tc of agentOutput.pendingToolCalls) {
            yield {
              type: 'tool',
              toolCall: tc,
            };
          }
        }
      }
    }

    // tool 节点输出
    if ('tool' in event) {
      const toolOutput = event.tool as AgentStateType;
      for (const msg of toolOutput.messages) {
        if (msg instanceof ToolMessage) {
          yield {
            type: 'tool',
            toolResult: {
              toolCallId: msg.tool_call_id || '',
              name: '',
              result: msg.content,
            },
          };
        }
      }
    }
  }

  yield { type: 'done' };
}

export default createAgentGraph;
