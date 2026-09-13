/**
 * 资产匹配服务
 * 用于识别和匹配已有资产，避免重复创建
 */
import type { Character, Scene, Prop } from '../types';
import type { CreationContext } from './CreationContext';
import { calculateAssetFingerprint } from '../store/projectStore';
import { parseLLMJSON } from '../utils/llmJsonParser';

export interface AssetCandidate {
  name: string;
  description?: string;
  type?: string;
}

export interface AssetMatch {
  assetId: string;
  assetType: 'character' | 'scene' | 'prop';
  confidence: number;
  matchReason: string;
}

export interface MatchResult {
  type: 'existing' | 'new';
  assetId?: string;
  candidate: AssetCandidate;
  confidence: number;
  reason: string;
}

// 匹配阈值
const MATCH_THRESHOLDS = {
  AUTO_MATCH: 0.9,    // 高于此值自动匹配
  SUGGEST_MATCH: 0.5, // 高于此值建议匹配
};

export class AssetMatcher {
  private provider: CreationContext['llmProvider'];

  constructor(ctx: CreationContext) {
    this.provider = ctx.llmProvider;
  }

  // 计算字符串相似度（Levenshtein 距离）
  private calculateStringSimilarity(a: string, b: string): number {
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();

    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    // 简单的包含检测
    if (s1.includes(s2) || s2.includes(s1)) {
      return 0.8;
    }

    // Levenshtein 距离计算
    const matrix: number[][] = [];
    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[s1.length][s2.length];
    const maxLength = Math.max(s1.length, s2.length);
    return 1 - distance / maxLength;
  }

  // 计算角色相似度
  calculateCharacterSimilarity(candidate: AssetCandidate, existing: Character): number {
    // 名称相似度（权重最高）
    const nameSimilarity = this.calculateStringSimilarity(candidate.name, existing.name);

    // 名称完全匹配
    if (nameSimilarity === 1) return 1;

    // 描述相似度
    let descSimilarity = 0;
    if (candidate.description && existing.description) {
      descSimilarity = this.calculateStringSimilarity(candidate.description, existing.description);
    }

    // 综合评分
    return nameSimilarity * 0.7 + descSimilarity * 0.3;
  }

  // 计算场景相似度
  calculateSceneSimilarity(candidate: AssetCandidate, existing: Scene): number {
    const nameSimilarity = this.calculateStringSimilarity(candidate.name, existing.name);

    if (nameSimilarity === 1) return 1;

    let descSimilarity = 0;
    if (candidate.description && existing.description) {
      descSimilarity = this.calculateStringSimilarity(candidate.description, existing.description);
    }

    // 检查位置是否相同
    let locationSimilarity = 0;
    if (candidate.description && existing.location) {
      locationSimilarity = this.calculateStringSimilarity(candidate.description, existing.location);
    }

    return nameSimilarity * 0.6 + descSimilarity * 0.25 + locationSimilarity * 0.15;
  }

  // 计算道具相似度
  calculatePropSimilarity(candidate: AssetCandidate, existing: Prop): number {
    const nameSimilarity = this.calculateStringSimilarity(candidate.name, existing.name);

    if (nameSimilarity === 1) return 1;

    let descSimilarity = 0;
    if (candidate.description && existing.description) {
      descSimilarity = this.calculateStringSimilarity(candidate.description, existing.description);
    }

    return nameSimilarity * 0.7 + descSimilarity * 0.3;
  }

  // 在已有角色中查找匹配
  findCharacterMatch(
    candidate: AssetCandidate,
    existingCharacters: Character[]
  ): AssetMatch | null {
    let bestMatch: AssetMatch | null = null;
    let bestScore = 0;

    for (const character of existingCharacters) {
      const similarity = this.calculateCharacterSimilarity(candidate, character);

      if (similarity > bestScore && similarity >= MATCH_THRESHOLDS.SUGGEST_MATCH) {
        bestScore = similarity;
        bestMatch = {
          assetId: character.id,
          assetType: 'character',
          confidence: similarity,
          matchReason: similarity === 1
            ? '名称完全匹配'
            : similarity >= 0.8
              ? '名称高度相似'
              : '描述相似',
        };
      }
    }

    return bestMatch;
  }

  // 在已有场景中查找匹配
  findSceneMatch(
    candidate: AssetCandidate,
    existingScenes: Scene[]
  ): AssetMatch | null {
    let bestMatch: AssetMatch | null = null;
    let bestScore = 0;

    for (const scene of existingScenes) {
      const similarity = this.calculateSceneSimilarity(candidate, scene);

      if (similarity > bestScore && similarity >= MATCH_THRESHOLDS.SUGGEST_MATCH) {
        bestScore = similarity;
        bestMatch = {
          assetId: scene.id,
          assetType: 'scene',
          confidence: similarity,
          matchReason: similarity === 1
            ? '名称完全匹配'
            : similarity >= 0.8
              ? '同一地点'
              : '描述相似',
        };
      }
    }

    return bestMatch;
  }

  // 在已有道具中查找匹配
  findPropMatch(
    candidate: AssetCandidate,
    existingProps: Prop[]
  ): AssetMatch | null {
    let bestMatch: AssetMatch | null = null;
    let bestScore = 0;

    for (const prop of existingProps) {
      const similarity = this.calculatePropSimilarity(candidate, prop);

      if (similarity > bestScore && similarity >= MATCH_THRESHOLDS.SUGGEST_MATCH) {
        bestScore = similarity;
        bestMatch = {
          assetId: prop.id,
          assetType: 'prop',
          confidence: similarity,
          matchReason: similarity === 1
            ? '名称完全匹配'
            : similarity >= 0.8
              ? '名称高度相似'
              : '描述相似',
        };
      }
    }

    return bestMatch;
  }

  // 使用 LLM 进行更精确的匹配判断
  async llmAssistedMatch(
    candidate: AssetCandidate,
    potentialMatches: { asset: Character | Scene | Prop; type: string }[]
  ): Promise<MatchResult | null> {
    if (potentialMatches.length === 0) {
      return null;
    }

    const matchList = potentialMatches.map((m, i) => {
      const asset = m.asset as any;
      return `${i + 1}. [${m.type}] ${asset.name}: ${asset.description || '无描述'}`;
    }).join('\n');

    const prompt = `判断以下新资产是否与已有资产为同一个：

新资产：
名称: ${candidate.name}
描述: ${candidate.description || '无'}

已有资产：
${matchList}

请判断新资产是否与某个已有资产相同。如果相同，返回匹配的序号；如果不同，返回 0。

输出格式（JSON）：
{ "matchIndex": 数字, "confidence": 0-1的置信度, "reason": "判断理由" }`;

    try {
      const response = await this.provider.generateText(prompt, '你是一个资产匹配助手');

      const result = parseLLMJSON<{
        matchIndex: number;
        confidence: number;
        reason: string;
      }>(response);

      if (result.matchIndex > 0 && result.matchIndex <= potentialMatches.length) {
        const matched = potentialMatches[result.matchIndex - 1];
        return {
          type: 'existing',
          assetId: (matched.asset as any).id,
          candidate,
          confidence: result.confidence,
          reason: result.reason,
        };
      }

      return {
        type: 'new',
        candidate,
        confidence: result.confidence,
        reason: result.reason,
      };
    } catch {
      return null;
    }
  }

  // 批量匹配角色
  async matchCharacters(
    candidates: AssetCandidate[],
    existingCharacters: Character[]
  ): Promise<MatchResult[]> {
    const results: MatchResult[] = [];

    for (const candidate of candidates) {
      const match = this.findCharacterMatch(candidate, existingCharacters);

      if (match && match.confidence >= MATCH_THRESHOLDS.AUTO_MATCH) {
        results.push({
          type: 'existing',
          assetId: match.assetId,
          candidate,
          confidence: match.confidence,
          reason: match.matchReason,
        });
      } else if (match && match.confidence >= MATCH_THRESHOLDS.SUGGEST_MATCH) {
        // 中等置信度，可能需要用户确认
        results.push({
          type: 'existing',
          assetId: match.assetId,
          candidate,
          confidence: match.confidence,
          reason: `${match.matchReason}（建议确认）`,
        });
      } else {
        results.push({
          type: 'new',
          candidate,
          confidence: 1,
          reason: '未找到匹配的已有资产',
        });
      }
    }

    return results;
  }

  // 检查指纹去重
  checkFingerprintDuplicate(
    candidate: AssetCandidate,
    existingAssets: (Character | Scene | Prop)[]
  ): (Character | Scene | Prop) | null {
    const candidateFingerprint = calculateAssetFingerprint(candidate);

    for (const asset of existingAssets) {
      if (asset.fingerprint === candidateFingerprint) {
        return asset;
      }
    }

    return null;
  }
}

export default AssetMatcher;
