/**
 * CreationPlan — 全局创作意图
 *
 * 借鉴 Claude Code 的 plan.md 模式，在创作流程开始前生成全局意图，
 * 确保整个创作链路（分析 → 分镜 → 提示词 → 生图）保持风格和叙事一致性。
 */
import type { CreationContext } from './CreationContext';
import { parseLLMJSON } from '../utils/llmJsonParser';

export interface CreationPlanStyle {
  visualStyle: string;
  toneKeywords: string[];
  colorPalette?: string;
}

export interface CreationPlanNarrative {
  themes: string[];
  targetAudience: string;
  pacing: 'fast' | 'moderate' | 'slow';
}

export interface CharacterRelationship {
  characterA: string;
  characterB: string;
  relationship: string;
}

export interface SceneConstraint {
  sceneId: string;
  mustInclude: string[];
  mustExclude: string[];
}

export interface CreationPlan {
  id: string;
  projectId: string;
  status: 'draft' | 'approved' | 'locked';
  createdAt: number;
  style: CreationPlanStyle;
  narrative: CreationPlanNarrative;
  characterRelationships: CharacterRelationship[];
  sceneConstraints: SceneConstraint[];
}

const PLAN_GENERATION_PROMPT = `请分析以下剧本，生成创作计划。

剧本内容：
<script>
{script}
</script>

已知角色：{characters}
已知场景：{scenes}

请返回以下 JSON 格式（不要附加说明文字）：
{
  "style": {
    "visualStyle": "整体视觉风格描述，如'赛博朋克暗色调'",
    "toneKeywords": ["关键词1", "关键词2"],
    "colorPalette": "主色调描述（可选）"
  },
  "narrative": {
    "themes": ["主题1", "主题2"],
    "targetAudience": "目标受众",
    "pacing": "fast|moderate|slow"
  },
  "characterRelationships": [
    { "characterA": "角色A", "characterB": "角色B", "relationship": "关系描述" }
  ],
  "sceneConstraints": [
    { "sceneId": "场景名", "mustInclude": ["必须包含的元素"], "mustExclude": ["必须排除的元素"] }
  ]
}`;

/**
 * 通过 LLM 分析剧本自动生成 CreationPlan
 */
export async function generateCreationPlan(
  ctx: CreationContext,
  script: string,
): Promise<CreationPlan> {
  const characterNames = ctx.characters.map(c => c.name).join('、') || '无';
  const sceneNames = ctx.scenes.map(s => s.name).join('、') || '无';

  const prompt = PLAN_GENERATION_PROMPT
    .replace('{script}', script.slice(0, 8000))  // 截取前 8000 字符用于分析
    .replace('{characters}', characterNames)
    .replace('{scenes}', sceneNames);

  const response = await ctx.llmProvider.chat([
    { role: 'system', content: '你是一个专业的影视创作顾问，擅长分析剧本并制定创作计划。只返回合法 JSON。' },
    { role: 'user', content: prompt },
  ], {
    source: 'ScriptAnalysisService.creationPlan',
    operation: 'creation_plan',
    taskKind: 'analyze',
    taskProfileId: 'script-analysis',
  });

  const data = parseLLMJSON<Omit<CreationPlan, 'id' | 'projectId' | 'status' | 'createdAt'>>(response);

  // 验证 pacing 值
  const validPacing = ['fast', 'moderate', 'slow'] as const;
  const pacing = validPacing.includes(data.narrative?.pacing as any)
    ? data.narrative.pacing
    : 'moderate';

  return {
    id: `plan_${Date.now()}`,
    projectId: ctx.projectId,
    status: 'draft',
    createdAt: Date.now(),
    style: {
      visualStyle: data.style?.visualStyle || '',
      toneKeywords: data.style?.toneKeywords || [],
      colorPalette: data.style?.colorPalette,
    },
    narrative: {
      themes: data.narrative?.themes || [],
      targetAudience: data.narrative?.targetAudience || '',
      pacing,
    },
    characterRelationships: data.characterRelationships || [],
    sceneConstraints: data.sceneConstraints || [],
  };
}

/**
 * 将 CreationPlan 的风格信息转为 prompt prefix
 */
export function planToStylePrefix(plan: CreationPlan): string {
  const parts: string[] = [];

  if (plan.style.visualStyle) {
    parts.push(`视觉风格: ${plan.style.visualStyle}`);
  }
  if (plan.style.toneKeywords.length > 0) {
    parts.push(`基调: ${plan.style.toneKeywords.join('、')}`);
  }
  if (plan.style.colorPalette) {
    parts.push(`色调: ${plan.style.colorPalette}`);
  }
  if (plan.narrative.themes.length > 0) {
    parts.push(`主题: ${plan.narrative.themes.join('、')}`);
  }

  return parts.join('。');
}

/**
 * 将 CreationPlan 的角色关系转为上下文描述
 */
export function planToRelationshipContext(plan: CreationPlan): string {
  if (plan.characterRelationships.length === 0) return '';

  const lines = plan.characterRelationships.map(
    r => `${r.characterA} 与 ${r.characterB}: ${r.relationship}`
  );
  return `【角色关系】\n${lines.join('\n')}`;
}
