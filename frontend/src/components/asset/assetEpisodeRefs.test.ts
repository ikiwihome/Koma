import { describe, expect, it } from 'vitest';
import type { Character, EpisodeAnalysis, EpisodeRef } from '../../types';
import {
  addAssetIdToEpisodeAnalysisRefs,
  filterAssetsForEpisode,
  getUnboundAssetsForEpisode,
  mergeEpisodeRefs,
  withEpisodeRef,
  withoutEpisodeRef,
} from './assetEpisodeRefs';

function createAnalysis(overrides: Partial<EpisodeAnalysis> = {}): EpisodeAnalysis {
  return {
    episodeId: 'ep-1',
    characterRefs: ['char-1'],
    sceneRefs: ['scene-1'],
    propRefs: ['prop-1'],
    shots: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const episodeRef: EpisodeRef = {
  episodeId: 'ep-1',
  episodeName: '第 1 集',
  firstAppearance: true,
};

const otherEpisodeRef: EpisodeRef = {
  episodeId: 'ep-2',
  episodeName: '第 2 集',
  firstAppearance: false,
};

function createCharacter(id: string, episodeRefs?: EpisodeRef[]): Character {
  return {
    id,
    name: id,
    role: 'supporting',
    gender: 'unknown',
    prompt: '',
    ...(episodeRefs !== undefined ? { episodeRefs } : {}),
  };
}

describe('assetEpisodeRefs', () => {
  it('adds a created asset id to episode analysis refs without duplicating', () => {
    const analysis = createAnalysis();

    const added = addAssetIdToEpisodeAnalysisRefs(analysis, 'characterRefs', 'char-2');
    expect(added.characterRefs).toEqual(['char-1', 'char-2']);
    expect(added.sceneRefs).toBe(analysis.sceneRefs);

    const duplicate = addAssetIdToEpisodeAnalysisRefs(added, 'characterRefs', 'char-2');
    expect(duplicate.characterRefs).toEqual(['char-1', 'char-2']);
  });

  it('attaches an episode ref to an asset without duplicating the same episode', () => {
    const character: Character = {
      id: 'char-1',
      name: '测试角色',
      role: 'supporting',
      gender: 'unknown',
      prompt: '',
    };

    const withRef = withEpisodeRef(character, episodeRef);
    expect(withRef.episodeRefs).toEqual([episodeRef]);

    const duplicate = withEpisodeRef(withRef, episodeRef);
    expect(duplicate.episodeRefs).toEqual([episodeRef]);
  });

  it('merges stored episode refs over edited refs by episode id', () => {
    const edited: EpisodeRef[] = [{ ...episodeRef, episodeName: '旧名称' }];
    const stored: EpisodeRef[] = [{ ...episodeRef, episodeName: '第 1 集' }];

    expect(mergeEpisodeRefs(stored, edited)).toEqual(stored);
  });

  it('keeps current episode assets and excludes unused project assets when refs are present', () => {
    const assets = [
      createCharacter('char-in-analysis', [otherEpisodeRef]),
      createCharacter('char-current-ref', [episodeRef]),
      createCharacter('char-unused-without-refs'),
      createCharacter('char-unused-empty-refs', []),
      createCharacter('char-other-episode', [otherEpisodeRef]),
    ];

    const filtered = filterAssetsForEpisode(assets, ['char-in-analysis'], 'ep-1');

    expect(filtered.map(asset => asset.id)).toEqual(['char-in-analysis', 'char-current-ref']);
  });

  it('keeps all assets when analysis refs are empty', () => {
    const assets = [
      createCharacter('char-unused-without-refs'),
      createCharacter('char-other-episode', [otherEpisodeRef]),
    ];

    expect(filterAssetsForEpisode(assets, [], 'ep-1')).toBe(assets);
  });

  it('returns only project assets not already bound to the current episode', () => {
    const assets = [
      createCharacter('char-in-analysis'),
      createCharacter('char-current-ref', [episodeRef]),
      createCharacter('char-unused-without-refs'),
      createCharacter('char-unused-empty-refs', []),
      createCharacter('char-other-episode', [otherEpisodeRef]),
    ];

    const candidates = getUnboundAssetsForEpisode(assets, ['char-in-analysis'], 'ep-1');

    expect(candidates.map(asset => asset.id)).toEqual([
      'char-unused-without-refs',
      'char-unused-empty-refs',
      'char-other-episode',
    ]);
  });

  it('returns no bind candidates without an episode context', () => {
    const assets = [createCharacter('char-unused-without-refs')];

    expect(getUnboundAssetsForEpisode(assets, [], undefined)).toEqual([]);
  });

  it('removes only the current episode ref from an asset', () => {
    const character = createCharacter('char-1', [episodeRef, otherEpisodeRef]);

    const removed = withoutEpisodeRef(character, 'ep-1');

    expect(removed.episodeRefs).toEqual([otherEpisodeRef]);
    expect(character.episodeRefs).toEqual([episodeRef, otherEpisodeRef]);
  });
});
