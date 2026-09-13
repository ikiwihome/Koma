import type { Character, EpisodeAnalysis, EpisodeRef, Prop, Scene } from '../../types';

export type EpisodeRefsKey = 'characterRefs' | 'sceneRefs' | 'propRefs';
export type AssetWithEpisodeRefs = Character | Scene | Prop;

export function addAssetIdToEpisodeAnalysisRefs<T extends EpisodeAnalysis>(
  analysis: T,
  refsKey: EpisodeRefsKey,
  assetId: string
): T {
  const refs = Array.isArray(analysis[refsKey]) ? analysis[refsKey] : [];
  if (refs.includes(assetId)) return analysis;
  return {
    ...analysis,
    [refsKey]: [...refs, assetId],
  };
}

export function mergeEpisodeRefs(
  primaryRefs: EpisodeRef[] | undefined,
  secondaryRefs: EpisodeRef[] | undefined = []
): EpisodeRef[] | undefined {
  if (!primaryRefs?.length && !secondaryRefs?.length) return primaryRefs;

  const merged = new Map<string, EpisodeRef>();
  for (const ref of secondaryRefs || []) {
    merged.set(ref.episodeId, ref);
  }
  for (const ref of primaryRefs || []) {
    merged.set(ref.episodeId, ref);
  }
  return [...merged.values()];
}

export function withEpisodeRef<T extends AssetWithEpisodeRefs>(
  asset: T,
  episodeRef: EpisodeRef | null
): T {
  if (!episodeRef) return asset;
  const refs = asset.episodeRefs || [];
  if (refs.some(ref => ref.episodeId === episodeRef.episodeId)) return asset;
  return {
    ...asset,
    episodeRefs: [...refs, episodeRef],
  };
}

export function withoutEpisodeRef<T extends AssetWithEpisodeRefs>(
  asset: T,
  episodeId: string | undefined
): T {
  if (!episodeId || !asset.episodeRefs?.length) return asset;

  const episodeRefs = asset.episodeRefs.filter(ref => ref.episodeId !== episodeId);
  if (episodeRefs.length === asset.episodeRefs.length) return asset;

  return {
    ...asset,
    episodeRefs,
  };
}

export function getUnboundAssetsForEpisode<T extends AssetWithEpisodeRefs>(
  assets: T[],
  analysisRefs: string[] | undefined,
  episodeId: string | undefined
): T[] {
  if (!episodeId) return [];

  const analysisRefIds = new Set(Array.isArray(analysisRefs) ? analysisRefs : []);
  return assets.filter(asset => {
    if (analysisRefIds.has(asset.id)) return false;
    return !(asset.episodeRefs?.some(ref => ref.episodeId === episodeId) ?? false);
  });
}

export function filterAssetsForEpisode<T extends AssetWithEpisodeRefs>(
  assets: T[],
  analysisRefs: string[] | undefined,
  episodeId: string | undefined
): T[] {
  if (!analysisRefs?.length || !episodeId) return assets;

  const analysisRefIds = new Set(analysisRefs);
  return assets.filter(asset => {
    if (analysisRefIds.has(asset.id)) return true;

    return asset.episodeRefs?.some(ref => ref.episodeId === episodeId) ?? false;
  });
}
