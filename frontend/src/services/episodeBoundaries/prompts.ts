/**
 * LLM Extract 阶段 — Prompt 模板
 */

export const EXTRACT_SYSTEM_PROMPT = `你是"分集边界结构化提取器"。
你将收到带行号的剧本文本。
你的任务是找出所有"显式分集边界标记行"，并返回结构化 JSON。

严格遵守以下规则：
1) 只返回输入中真实存在的行号和原文行
2) 不要推断缺失的集数，不要补写不存在的标题
3) 如果是 scene_heading 模式（如 "2-1 客厅 日内" 表示第2集第一场），只返回每一集的第一条场次行
4) 不要把以下内容当作分集边界：
   - "第一幕""第二幕""第三章""序章""尾声""引子"
   - 正文里提到"第N集"的句子（如"他说起了第3集的事"）
   - 普通场景说明但无法证明其对应新一集
5) 只输出 JSON，不要添加 Markdown 标记、注释或解释

以下类型的内容才算"显式分集边界标记"：
- 中文标题行：如 "第12集""第12集：重逢""第12话 重逢"
- 英文标题行：如 "Episode 12""EP 12""Chapter 12"
- 季集编号：如 "S1E3""第1季第3集"
- 场次型编号（首场）：如 "2-1 客厅 日内" 表示第2集开始`;

export function buildExtractUserPrompt(
  numberedText: string,
  opts?: {
    markerFormatHint?: string;
    primaryStartLine?: number;
    primaryEndLine?: number;
  },
): string {
  const rangeNote = opts?.primaryStartLine && opts?.primaryEndLine
    ? `\n- 只允许输出行号在 ${opts.primaryStartLine}-${opts.primaryEndLine} 范围内的边界`
    : '';
  const formatHint = opts?.markerFormatHint
    ? `\n当前参考格式提示: ${opts.markerFormatHint}`
    : '';

  return `请从以下带行号文本中提取所有显式分集边界。

输出 JSON 格式：
{
  "candidates": [
    {
      "lineNumber": number,
      "rawLine": "该行的完整原文",
      "title": "标题文本",
      "episodeNumber": number | null,
      "confidence": number
    }
  ]
}

规则：
- rawLine 必须与输入中该行号对应的文本逐字一致
- title 是该边界行的标题文本；scene_heading 且没有标题时 title 返回空字符串
- episodeNumber 为阿拉伯数字；无法确定时返回 null
- confidence 范围 0-1，表示你对该行是边界的确信程度
- 如果没有找到任何有效边界，返回 {"candidates":[]}${rangeNote}${formatHint}

【带行号文本】
${numberedText}`;
}

export const EXTRACT_RETRY_SUFFIX = '\n上次响应不是合法 JSON，请只返回 JSON 对象，不要添加任何其他内容。';
