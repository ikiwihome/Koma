/**
 * CapabilityBridge
 * 将 CapabilityDescriptor 转换为 LangChain DynamicStructuredTool
 * 使 Agent 能通过 LangGraph 调用 Capability
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { capabilityRegistry } from '../plugin/capability';
import type { CapabilityDescriptor } from '../plugin/capability/types';

// JSON Schema → Zod（复用 AgentGraph 的逻辑）
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any();

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
    default:
      return z.any();
  }
}

/**
 * 将一组 CapabilityDescriptor 转为 LangChain DynamicStructuredTool[]
 */
export function createCapabilityTools(
  capabilities: CapabilityDescriptor[]
): DynamicStructuredTool[] {
  return capabilities
    .filter(cap => cap.type === 'tool')
    .map(cap => {
      const schema = cap.inputSchema ? jsonSchemaToZod(cap.inputSchema) : z.object({}).passthrough();

      return new DynamicStructuredTool({
        name: cap.name,
        description: cap.description || `Capability: ${cap.name}`,
        schema,
        func: async (input) => {
          const result = await capabilityRegistry.invoke(cap.id, input);
          if (result.success) {
            return JSON.stringify(result.data);
          }
          return JSON.stringify({ error: result.error });
        },
      });
    });
}

/**
 * 根据标签需求解析并创建工具
 */
export function resolveAndCreateTools(requirements: string[]): DynamicStructuredTool[] {
  const resolved = capabilityRegistry.resolve(requirements);
  return createCapabilityTools(resolved);
}
