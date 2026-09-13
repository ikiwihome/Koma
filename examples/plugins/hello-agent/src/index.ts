/**
 * Hello Agent 示例插件
 * 演示如何创建一个 Worker Agent 插件
 */
import type { ElectronPluginAPI, WorkerAgentDefinition } from '@anthropic/plugin-sdk';

export async function onActivate(api: ElectronPluginAPI): Promise<void> {
  api.log.info('Translation Agent plugin activated');
}

export async function onDeactivate(): Promise<void> {
  // 清理资源
}

export function createAgent(): WorkerAgentDefinition {
  return {
    id: 'translator',
    name: '翻译助手',
    description: '多语言翻译 Worker，支持中英日韩互译',
    capabilities: ['translation', 'language'],
    tools: [], // 翻译不需要工具
    systemPrompt: `你是一个专业翻译助手。
规则：
1. 自动检测源语言
2. 如果源语言是中文，翻译成英文
3. 如果源语言是其他语言，翻译成中文
4. 保持原文的语气和风格
5. 专业术语附带原文`,
    temperature: 0.3,
    maxTokens: 2048,
  };
}
