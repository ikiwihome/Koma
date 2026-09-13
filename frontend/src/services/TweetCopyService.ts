/**
 * 推文文案服务（Tweet Copy Service）
 *
 * 两个核心能力：
 * 1. generateTweetScript：从一集剧本提炼出整段连续推文旁白脚本（剧本级）
 * 2. distributeTweetToShots：把推文旁白按分镜切分到每个 Shot.tweetCopy（分镜级）
 *
 * 推文文案是市面上多数小说推文 / 漫剧 / 一键成片工具的标准输入：
 * 紧凑、口语化、按句切分的解说旁白，可直接做 TTS 配音 + 字幕。
 */
import type { Shot } from '../types';
import type { CreationContext } from './CreationContext';
import { resolvePromptTemplate } from '../store/promptTemplates';
import { parseLLMJSON } from '../utils/llmJsonParser';
import { runWithTask } from './taskRunner';

/**
 * 从一集剧本生成连续推文旁白脚本。
 *
 * 输出是一段以换行切句的纯文本，可以直接用作 TTS 配音脚本，
 * 也是后续 distributeTweetToShots 的输入。
 *
 * 支持流式：传入 onStream 后会启用 LLM 流式接口，每收到一段增量就触发回调，
 * 上层可以把 accumulated 实时写到 UI 的 textarea，达到"打字机"效果。
 * 不传 onStream 则走非流式同步等待。
 */
export async function generateTweetScript(
  ctx: CreationContext,
  script: string,
  onProgress?: (progress: number, step?: string) => void,
  onStream?: (delta: string, accumulated: string) => void,
): Promise<string> {
  if (!script || !script.trim()) {
    throw new Error('剧本内容为空，无法生成推文文案');
  }

  const { result } = await runWithTask({
    projectId: ctx.projectId,
    category: 'script',
    subType: 'script-analysis',
    targetType: 'episode',
    targetId: ctx.episodeId,
    targetName: '推文文案生成',
    type: 'script-analysis',
    metadata: { kind: 'tweet-script-generation', streaming: !!onStream },
    execute: async (taskCtx) => {
      const update = (percent: number, step?: string) => {
        onProgress?.(percent, step);
        taskCtx.progress(percent, step);
      };
      update(5, '加载推文文案模板...');
      const resolvedPrompt = await resolvePromptTemplate('tweet_script_generation', { script });

      update(15, onStream ? '正在流式生成推文旁白...' : '调用 LLM 生成推文旁白...');

      // 流式 / 非流式分流：onStream 存在 → 走 LLM 的 stream 接口，每个 chunk 透传给上层
      // 推文不再硬限字数，进度终点按"原文长度 × 30%"估算（推文典型为原文 25%–35%）。
      // 真实超过时会自然封顶到 90%，不会倒退。
      const estimatedTargetLen = Math.max(400, Math.floor(script.length * 0.3));
      let lastReportedPercent = 15;
      const handleChunk = onStream
        ? (delta: string, accumulated: string) => {
            onStream(delta, accumulated);
            const approxPercent = Math.min(90, 15 + Math.floor((accumulated.length / estimatedTargetLen) * 75));
            if (approxPercent > lastReportedPercent + 4) {
              lastReportedPercent = approxPercent;
              update(approxPercent, '正在流式生成推文旁白...');
            }
          }
        : undefined;

      const response = await ctx.llmProvider.chat(
        [{ role: 'user', content: resolvedPrompt.prompt }],
        onStream ? { stream: true } : undefined,
        handleChunk,
      );

      update(95, '清洗输出...');
      const cleaned = sanitizeTweetScript(response);

      // 流式收尾：让上层用清洗后的最终版本覆盖之前的增量累积，避免残留 ```json 包裹等
      if (onStream && cleaned !== response.trim()) {
        onStream('', cleaned);
      }

      update(100, '推文文案生成完成');
      return cleaned;
    },
  });
  return result;
}

interface DistributeResult {
  shotId: string;
  tweetCopy: string;
}

/**
 * 把整集推文旁白按分镜切分到每个 Shot.tweetCopy。
 *
 * 不直接修改传入的 shots 数组；返回每个分镜对应的 tweetCopy 列表，
 * 调用方决定是否回写到持久化层（saveEpisodeShots）。
 *
 * 如果 LLM 返回的分段数与分镜数不一致，会按位补齐 / 截断，
 * 多余的分段会丢弃，缺失的分镜 tweetCopy 留空。
 */
export async function distributeTweetToShots(
  ctx: CreationContext,
  tweetScript: string,
  shots: Shot[],
  onProgress?: (progress: number, step?: string) => void,
): Promise<DistributeResult[]> {
  if (!tweetScript || !tweetScript.trim()) {
    throw new Error('推文旁白为空，无法分发到分镜');
  }
  if (!shots.length) {
    return [];
  }

  const shotsList = shots
    .map((shot, idx) => {
      const order = idx + 1;
      const content = (shot.scriptLines || []).map(l => l.text).join(' ').replace(/\s+/g, ' ').trim() || '（空）';
      const duration = typeof shot.duration === 'number' && shot.duration > 0 ? shot.duration : 6;
      return `#${order} ${content} (${duration}s)`;
    })
    .join('\n');

  const { result } = await runWithTask({
    projectId: ctx.projectId,
    category: 'analysis',
    subType: 'shot-analysis',
    targetType: 'episode',
    targetId: ctx.episodeId,
    targetName: `推文分发到分镜（${shots.length} 个）`,
    type: 'shot-analysis',
    metadata: { kind: 'tweet-shot-breakdown', shotCount: shots.length },
    execute: async (taskCtx) => {
      const update = (percent: number, step?: string) => {
        onProgress?.(percent, step);
        taskCtx.progress(percent, step);
      };
      update(5, '加载分镜化模板...');
      const resolvedPrompt = await resolvePromptTemplate('tweet_shot_breakdown', {
        tweetScript: tweetScript.trim(),
        shotsList,
      });

      update(15, '调用 LLM 切分推文文案...');
      const response = await ctx.llmProvider.chat([
        { role: 'user', content: resolvedPrompt.prompt },
      ]);

      update(85, '解析分镜化结果...');
      const parsed = parseLLMJSON<unknown>(response);
      const items = extractBreakdownItems(parsed);

      const byIndex = new Map<number, string>();
      for (const item of items) {
        if (typeof item.tweetCopy === 'string' && item.tweetCopy.trim()) {
          byIndex.set(item.shotIndex, item.tweetCopy.trim());
        }
      }

      const out: DistributeResult[] = shots.map((shot, idx) => ({
        shotId: shot.id,
        tweetCopy: byIndex.get(idx + 1) || '',
      }));

      update(100, '推文文案分发完成');
      return out;
    },
  });
  return result;
}

// ========== 内部工具 ==========

function sanitizeTweetScript(raw: string): string {
  let text = (raw || '').trim();
  // 去掉可能的代码块包裹
  text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  // 去掉常见的前缀解释
  text = text.replace(/^(以下是|这是|输出[:：])\s*[^\n]*\n+/i, '').trim();
  return text;
}

interface BreakdownItem {
  shotIndex: number;
  tweetCopy: string;
}

function extractBreakdownItems(parsed: unknown): BreakdownItem[] {
  if (!parsed) return [];
  // 接受两种顶层形态：数组 / { items: [...] } / { breakdown: [...] }
  const candidate: unknown = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>).items)
      ? (parsed as Record<string, unknown>).items
      : Array.isArray((parsed as Record<string, unknown>).breakdown)
        ? (parsed as Record<string, unknown>).breakdown
        : [];
  if (!Array.isArray(candidate)) return [];

  const items: BreakdownItem[] = [];
  for (const raw of candidate) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const idxRaw = obj.shotIndex ?? obj.index ?? obj.shot;
    const copyRaw = obj.tweetCopy ?? obj.copy ?? obj.text;
    const shotIndex = typeof idxRaw === 'number' ? idxRaw : Number.parseInt(String(idxRaw ?? ''), 10);
    if (!Number.isFinite(shotIndex) || shotIndex < 1) continue;
    if (typeof copyRaw !== 'string') continue;
    items.push({ shotIndex, tweetCopy: copyRaw });
  }
  return items;
}

export default {
  generateTweetScript,
  distributeTweetToShots,
};
