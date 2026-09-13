import type { MediaAssetSource, ProviderAssetInput } from '../../types';
import { isAssetMentionType, parseMentions } from '../../editor/mentionTypes';
import type { AssetMentionType, ParsedMention } from '../../editor/mentionTypes';
import type { PromptCompilationDebug, PromptCompilationInput } from './types';

function buildMatchIds(type: AssetMentionType, assetId: string, altIds?: string[]): Set<string> {
  const ids = new Set<string>();

  const add = (id?: string) => {
    if (!id) return;
    ids.add(id);
    const prefix = `${type}_`;
    if (id.startsWith(prefix)) {
      ids.add(id.slice(prefix.length));
    }
  };

  add(assetId);
  for (const alt of altIds || []) add(alt);

  return ids;
}

function truncateDataUrl(value: string, keep = 120): string {
  if (!value.startsWith('data:')) return value;
  const len = value.length;
  return `${value.slice(0, keep)}...(data-url ${len} chars)`;
}

function refKey(ref: MediaAssetSource | ProviderAssetInput): string {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && 'transport' in ref && 'value' in ref) {
    return `${(ref as ProviderAssetInput).transport}:${(ref as ProviderAssetInput).value}`;
  }
  // StoredMediaAsset-ish
  const anyRef = ref as any;
  return anyRef?.remoteUrl || anyRef?.localPath || JSON.stringify(anyRef);
}

function getReadableAssetLabel(asset: NonNullable<PromptCompilationInput['selectedAssets']>[number]): string {
  return String(asset.name || asset.textValue || '').trim();
}

function buildReadableMentionReplacement(params: {
  prompt: string;
  mention: ParsedMention;
  fallbackLabel?: string;
}): string {
  const fallbackLabel = params.fallbackLabel?.trim();
  if (!fallbackLabel) return '';

  const afterMention = params.prompt.slice(params.mention.to);
  if (afterMention.trimStart().startsWith(fallbackLabel)) {
    return '';
  }
  return fallbackLabel;
}

function applyMentionReplacements(
  prompt: string,
  replacements: Array<{ from: number; to: number; replacement: string }>,
): string {
  let compiledPrompt = prompt;
  for (const item of replacements.sort((left, right) => right.from - left.from)) {
    compiledPrompt = compiledPrompt.slice(0, item.from) + item.replacement + compiledPrompt.slice(item.to);
  }
  return compiledPrompt;
}

export function compileGrokTTI(params: {
  prompt: string;
  selectedAssets: PromptCompilationInput['selectedAssets'];
  /**
   * Additional references (optional) that should NOT affect @Image N indices.
   * They will be appended after selected assets.
   */
  extraReferences?: Array<MediaAssetSource | ProviderAssetInput>;
}): {
  compiledPrompt: string;
  compiledReferences: Array<MediaAssetSource | ProviderAssetInput>;
  debug: PromptCompilationDebug;
} {
  const mentions = parseMentions(params.prompt);

  // Keep only assets that have an actual source (otherwise they can't be used as image refs).
  const selectedAssets = params.selectedAssets ?? [];
  const usableAssets = selectedAssets.filter(a => Boolean(a.source));
  const assetMatchIds = usableAssets.map(a => ({
    asset: a,
    matchIds: buildMatchIds(a.type, a.assetId, a.altIds),
  }));
  const allAssetMatchIds = selectedAssets.map(a => ({
    asset: a,
    matchIds: buildMatchIds(a.type, a.assetId, a.altIds),
  }));

  const replacements: Array<{ from: number; to: number; replacement: string }> = [];
  const unmappedMentions: PromptCompilationDebug['unmappedMentions'] = [];

  for (const mention of mentions) {
    if (!isAssetMentionType(mention.type)) {
      continue;
    }
    const hit = assetMatchIds.find(({ asset, matchIds }) => asset.type === mention.type && matchIds.has(mention.id));
    if (!hit) {
      unmappedMentions.push({ type: mention.type, id: mention.id, fullMatch: mention.fullMatch });
      const knownAsset = allAssetMatchIds.find(({ asset, matchIds }) => asset.type === mention.type && matchIds.has(mention.id));
      replacements.push({
        from: mention.from,
        to: mention.to,
        replacement: buildReadableMentionReplacement({
          prompt: params.prompt,
          mention,
          fallbackLabel: knownAsset ? getReadableAssetLabel(knownAsset.asset) : undefined,
        }),
      });
      continue;
    }
    const idx = usableAssets.findIndex(a => a === hit.asset);
    if (idx >= 0) {
      replacements.push({ from: mention.from, to: mention.to, replacement: `@Image ${idx + 1}` }); // @Image 1..N
    }
  }

  const compiledPrompt = applyMentionReplacements(params.prompt, replacements);

  const selectedRefs = usableAssets.map(a => a.source!).filter(Boolean);
  const selectedKeys = new Set(selectedRefs.map(refKey));
  const extraRefs = (params.extraReferences || []).filter(r => !selectedKeys.has(refKey(r)));

  const compiledReferences: Array<MediaAssetSource | ProviderAssetInput> = [
    ...selectedRefs,
    ...extraRefs,
  ];

  const debug: PromptCompilationDebug = {
    protocol: 'grok-image-index',
    originalPrompt: params.prompt,
    compiledPrompt,
    mentions,
    assetToImageIndex: usableAssets.map((a, i) => ({
      type: a.type,
      assetId: a.assetId,
      image: `@Image ${i + 1}`,
    })),
    unmappedMentions,
  };

  // Avoid giant console output by normalizing any data-url previews in debug payload consumers.
  // (Callers can log compiledReferences with truncation.)
  void truncateDataUrl;

  return { compiledPrompt, compiledReferences, debug };
}

export function compileGrokITV(params: {
  prompt: string;
  primaryImage: MediaAssetSource | ProviderAssetInput;
  selectedAssets: PromptCompilationInput['selectedAssets'];
  /**
   * Additional references (optional) that should NOT affect @Image N indices.
   * They will be appended after selected assets.
   */
  extraReferences?: Array<MediaAssetSource | ProviderAssetInput>;
}): {
  compiledPrompt: string;
  compiledAdditionalReferences: Array<MediaAssetSource | ProviderAssetInput>;
  debug: PromptCompilationDebug;
} {
  const mentions = parseMentions(params.prompt);

  const selectedAssets = params.selectedAssets ?? [];
  const usableAssets = selectedAssets.filter(a => Boolean(a.source));
  const assetMatchIds = usableAssets.map(a => ({
    asset: a,
    matchIds: buildMatchIds(a.type, a.assetId, a.altIds),
  }));
  const allAssetMatchIds = selectedAssets.map(a => ({
    asset: a,
    matchIds: buildMatchIds(a.type, a.assetId, a.altIds),
  }));

  const replacements: Array<{ from: number; to: number; replacement: string }> = [];
  const unmappedMentions: PromptCompilationDebug['unmappedMentions'] = [];

  for (const mention of mentions) {
    if (!isAssetMentionType(mention.type)) {
      continue;
    }
    const hit = assetMatchIds.find(({ asset, matchIds }) => asset.type === mention.type && matchIds.has(mention.id));
    if (!hit) {
      unmappedMentions.push({ type: mention.type, id: mention.id, fullMatch: mention.fullMatch });
      const knownAsset = allAssetMatchIds.find(({ asset, matchIds }) => asset.type === mention.type && matchIds.has(mention.id));
      replacements.push({
        from: mention.from,
        to: mention.to,
        replacement: buildReadableMentionReplacement({
          prompt: params.prompt,
          mention,
          fallbackLabel: knownAsset ? getReadableAssetLabel(knownAsset.asset) : undefined,
        }),
      });
      continue;
    }
    const idx = usableAssets.findIndex(a => a === hit.asset);
    if (idx >= 0) {
      // @Image 1 reserved for primary image; assets start from @Image 2
      replacements.push({ from: mention.from, to: mention.to, replacement: `@Image ${idx + 2}` });
    }
  }

  const compiledPrompt = applyMentionReplacements(params.prompt, replacements);

  // Provider API separates primary image from additional refs.
  // We align indices by:
  // - @Image 1 -> primaryImage
  // - @Image 2.. -> additionalReferences[0..]
  const selectedRefs = usableAssets.map(a => a.source!).filter(Boolean);
  const selectedKeys = new Set(selectedRefs.map(refKey));
  const extraRefs = (params.extraReferences || []).filter(r => !selectedKeys.has(refKey(r)));

  const compiledAdditionalReferences: Array<MediaAssetSource | ProviderAssetInput> = [
    ...selectedRefs,
    ...extraRefs,
  ];

  const debug: PromptCompilationDebug = {
    protocol: 'grok-image-index',
    originalPrompt: params.prompt,
    compiledPrompt,
    mentions,
    assetToImageIndex: [
      { type: 'scene', assetId: '(primary-image)', image: '@Image 1' },
      ...usableAssets.map((a, i) => ({
        type: a.type,
        assetId: a.assetId,
        image: `@Image ${i + 2}`,
      })),
    ],
    unmappedMentions,
  };

  return { compiledPrompt, compiledAdditionalReferences, debug };
}
