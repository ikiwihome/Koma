/**
 * 对话意图路由 — ReAct 单步：LLM 输出思考 + 决策。
 *
 * 与单纯 classify 的差异：模型会先输出 `thought`（推理过程），再给 `mode`。
 * 这样：
 *  - 用户能看到 AI 是"怎么"决定调用图片生成 / 视频生成 / 普通对话的
 *  - 后续可平滑扩展为 multi-step ReAct（thought → action → observation 循环）
 *
 * 走前端 chatIPC.llm.query → Electron 主进程 → LangChain，复用当前选定的 chat 模型。
 * 调用失败或返回非法 JSON 时回退到关键字匹配 (detectChatMediaMode)。
 */
import { chatIPC } from '../chat/ipc';
import type { LLMQueryRequest } from '../chat/ipc';
import type { LLMModelConfig } from '../types';
import { detectChatMediaMode, type ChatMediaMode } from '../components/chat/chatMediaGeneration';
import { createLogger } from '../store/logger';

const logger = createLogger('ChatIntentRouter');

const VALID_MODES = ['chat', 'text-to-image', 'image-to-image', 'image-to-video', 'text-to-video', 'start-end-to-video', 'reference-to-video'] as const;
type ValidMode = typeof VALID_MODES[number];

interface IntentSafeParseResult {
  success: boolean;
  data?: { thought: string; mode: ValidMode };
  error?: string;
}

function parseIntent(value: unknown): IntentSafeParseResult {
  if (!value || typeof value !== 'object') {
    return { success: false, error: 'not an object' };
  }
  const obj = value as Record<string, unknown>;
  const thought = obj.thought;
  const mode = obj.mode;
  if (typeof thought !== 'string' || thought.length < 1 || thought.length > 500) {
    return { success: false, error: 'invalid thought field' };
  }
  if (typeof mode !== 'string' || !(VALID_MODES as readonly string[]).includes(mode)) {
    return { success: false, error: 'invalid mode field' };
  }
  return { success: true, data: { thought, mode: mode as ValidMode } };
}

export interface ChatIntentDecision {
  mode: ChatMediaMode;
  thought: string;
}

const SYSTEM_PROMPT = `你是一个 ReAct 风格的意图路由器。先做简短思考（thought），再给出决策（mode）。

⚠️ 关键规则 — 区分"看图说话"和"生图"：
用户**带图 + 问"这是什么 / 描述一下 / 识别 / 分析 / 比较 / 风格 / 颜色"等**问题
→ 是让模型"看图回答"，**用 chat 模式**（多模态对话），不是生图。
仅当用户明确要"画 / 生成 / 改 / 重绘 / 仿照画"时，才走 image-to-image 等生图模式。

mode 取值：
- "chat"：所有不需要"生成新媒体"的请求
  · 普通问答、写作、分析、写代码
  · **看图描述、识别、分析、比较**（即使带了图）
- "text-to-image"：要求生成图片，且无参考图
- "image-to-image"：要求基于参考图生成新图（垫图、改图、重绘、仿照画一张）
- "text-to-video"：要求生成视频，无参考图
- "image-to-video"：**仅 1 张**参考图，把它当首帧驱动视频
- "start-end-to-video"：**恰好 2 张**图，第 1 张作首帧、第 2 张作尾帧
- "reference-to-video"：**≥ 2 张**参考图全部送入做多参考驱动（即梦 omni_reference / Grok 多参考）

⚠️ 视频参考图选择规则：
  · 有图 + 让它"动起来" → image-to-video（仅作为 chat 模式下的兜底；多参考由用户手动选 chip，LLM 不要主动选 reference-to-video）
  · 用户明确说"首尾"或"开头到结尾"→ start-end-to-video
  · 默认不要选 reference-to-video（这个模式由用户在 UI 上手动声明）

示例：
  - "这张图里有什么动物？"+图 → {thought:"识别图内容", mode:"chat"}
  - "把这张图改成晚上"+图 → {thought:"基于图改", mode:"image-to-image"}
  - "画一只兔子" → {thought:"无参考图生图", mode:"text-to-image"}
  - "分析这两张图风格差异"+2图 → {thought:"看图分析", mode:"chat"}
  - "让这张图动起来"+图 → {thought:"图生视频", mode:"image-to-video"}

只输出严格的 JSON：{"thought": "短句推理（≤80字）", "mode": "..."}
不输出 markdown、代码块、解释。`;

function buildUserPrompt(text: string, imageCount: number): string {
  return [
    `用户消息：${text || '(空)'}`,
    `提供的参考图数量：${imageCount} 张`,
    '请输出 thought + mode JSON。',
  ].join('\n');
}

function fallbackDecision(text: string, imageCount: number, reason?: string): ChatIntentDecision {
  const mode = detectChatMediaMode(
    text,
    imageCount > 0 ? [{ id: '', file: new File([], ''), type: 'image' } as any] : [],
  );
  return {
    mode,
    thought: reason ? `（关键字回退：${reason}）` : '（关键字回退）',
  };
}

export async function classifyChatIntent(params: {
  text: string;
  /** 准确的参考图数量（决定 image-to-video vs reference-to-video） */
  imageCount: number;
  llmConfig: Pick<LLMModelConfig, 'profileId' | 'provider' | 'modelName' | 'apiKey' | 'baseUrl'>;
}): Promise<ChatIntentDecision> {
  const { text, imageCount, llmConfig } = params;

  if (!chatIPC.llm.isAvailable()) {
    return fallbackDecision(text, imageCount, 'LLM IPC 不可用');
  }

  const request: LLMQueryRequest = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(text, imageCount) },
    ],
    config: {
      profileId: llmConfig.profileId,
      modelProvider: llmConfig.provider,
      modelName: llmConfig.modelName,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      temperature: 0,
      maxTokens: 200,
    },
    options: {
      source: 'chat-intent-router',
      taskKind: 'structured',
      responseFormat: 'json_object',
      timeoutMs: 8000,
    },
  };

  try {
    const response = await chatIPC.llm.query(request);
    if (response.error || !response.content) {
      logger.warn('意图路由 LLM 调用失败，回退关键字', response.error);
      return fallbackDecision(text, imageCount, response.error?.message);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) {
        logger.warn('意图路由响应非 JSON，回退关键字', { content: response.content });
        return fallbackDecision(text, imageCount, 'LLM 返回非 JSON');
      }
      parsed = JSON.parse(match[0]);
    }

    const validated = parseIntent(parsed);
    if (!validated.success || !validated.data) {
      logger.warn('意图路由 JSON 不符合 schema，回退关键字', validated.error);
      return fallbackDecision(text, imageCount, 'JSON 字段缺失');
    }

    let { mode, thought }: { mode: ChatMediaMode; thought: string } = validated.data;
    // 一致性校验：选了需要图的 mode 但实际没图，自动降级
    if (imageCount === 0) {
      if (mode === 'image-to-image') mode = 'text-to-image';
      else if (mode === 'image-to-video') mode = 'text-to-video';
      else if (mode === 'start-end-to-video' || mode === 'reference-to-video') mode = 'text-to-video';
    }
    // 注意：不再自动升级 image-to-video → reference-to-video。
    // 多参考是用户手动声明的子模式（视频创作 → 多参考 chip），不让 LLM 决定。
    // LLM 只在用户走"对话"模式时介入识别意图，多参考路径用户必须显式选择。
    return { mode, thought };
  } catch (err) {
    logger.warn('意图路由抛错，回退关键字', err);
    return fallbackDecision(text, imageCount, err instanceof Error ? err.message : '未知错误');
  }
}
