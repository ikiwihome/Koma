import { describe, expect, it } from 'vitest';
import type { ShotReferenceBundle, ShotReferenceItem } from './types';
import { compileShotPromptToBundle, _resolveTokenIndex } from './compile';

function item(partial: Partial<ShotReferenceItem> & Pick<ShotReferenceItem, 'kind' | 'mentionToken'>): ShotReferenceItem {
  return {
    id: partial.id ?? `${partial.mentionToken}-id`,
    label: partial.label ?? '示例项',
    source: { kind: 'image', remoteUrl: `https://example.com/${partial.mentionToken}.png`, createdAt: 1 },
    priority: partial.priority ?? 50,
    ...partial,
  };
}

function bundle(items: ShotReferenceItem[]): ShotReferenceBundle {
  return {
    items,
    hasGridAnchor: items.some(i => i.kind === 'grid-anchor'),
    hasShotImage: items.some(i => i.kind === 'shot-anchor' || i.kind === 'grid-anchor'),
    capacity: { maxRefs: 10, truncatedCount: 0, truncatedKinds: [] },
  };
}

describe('compileShotPromptToBundle — 基础 token 翻译', () => {
  it('@shot_anchor / @scene_xx / @char_xx / @prop_xx 翻译为对应位置的 @Image N', () => {
    const bdl = bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
      item({ kind: 'scene', mentionToken: '@scene_dorm' }),
      item({ kind: 'character', mentionToken: '@char_zhouming' }),
      item({ kind: 'prop', mentionToken: '@prop_phone' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '@shot_anchor 中，@char_zhouming 坐在 @scene_dorm 床上玩 @prop_phone',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toBe('@Image 1 中，@Image 3 坐在 @Image 2 床上玩 @Image 4');
    expect(result.references).toHaveLength(4);
    expect(result.debug.unmappedTokens).toEqual([]);
  });

  it('@grid_anchor 翻译为 references[N=对应位置] 的 @Image N', () => {
    const bdl = bundle([
      item({ kind: 'grid-anchor', mentionToken: '@grid_anchor' }),
      item({ kind: 'character', mentionToken: '@char_zhouming' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '基于 @grid_anchor 的 9 帧时序，@char_zhouming 完成本镜头动作',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toContain('@Image 1');
    expect(result.compiledPrompt).toContain('@Image 2');
    expect(result.compiledPrompt).not.toContain('@grid_anchor');
    expect(result.compiledPrompt).not.toContain('@char_');
  });

  it('@user_<idx> 翻译为对应位置的 @Image N', () => {
    const bdl = bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
      item({ kind: 'user-upload', mentionToken: '@user_0' }),
      item({ kind: 'user-upload', mentionToken: '@user_1' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '主图 @shot_anchor + 用户参考 @user_0 与 @user_1',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toBe('主图 @Image 1 + 用户参考 @Image 2 与 @Image 3');
  });

  it('@storyboard_anchor / @previous_storyboard_anchor 翻译为对应位置的 @Image N', () => {
    const bdl = bundle([
      item({ kind: 'previous-storyboard-anchor', mentionToken: '@previous_storyboard_anchor' }),
      item({ kind: 'storyboard-anchor', mentionToken: '@storyboard_anchor' }),
      item({ kind: 'character', mentionToken: '@char_zhouming' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '继承 @previous_storyboard_anchor，当前板 @storyboard_anchor 中 @char_zhouming 情绪递进',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toBe('继承 @Image 1，当前板 @Image 2 中 @Image 3 情绪递进');
    expect(result.debug.unmappedTokens).toEqual([]);
  });
});

describe('compileShotPromptToBundle — 已经是 @Image N / @图片N 的处理', () => {
  it('合法的位置编码原样保留并归一化协议', () => {
    const bdl = bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
      item({ kind: 'scene', mentionToken: '@scene_x' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '使用 @Image1 与 @图片 2 做参考',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toBe('使用 @Image 1 与 @Image 2 做参考');
    expect(result.debug.overflowImageNumbers).toEqual([]);
  });

  it('越界的位置编码（N > items.length）被剥离并记录', () => {
    const bdl = bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '@shot_anchor 是主图，@Image 3 不存在',
      bundle: bdl,
    });

    // @shot_anchor → @Image 1；@Image 3 越界被剥离
    expect(result.compiledPrompt).toBe('@Image 1 是主图， 不存在');
    expect(result.debug.overflowImageNumbers).toEqual([3]);
  });
});

describe('compileShotPromptToBundle — 未匹配 token', () => {
  it('未在 bundle 中找到且无 fallback 的 token 会被剥离并记录', () => {
    const bdl = bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
    ]);

    const result = compileShotPromptToBundle({
      prompt: '@shot_anchor + @char_unknown_id 一起出镜',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toContain('@Image 1');
    expect(result.compiledPrompt).not.toContain('@char_unknown_id');
    expect(result.debug.unmappedTokens).toContain('@char_unknown_id');
  });

  it('资产存在但没有图片时，用 mentionFallbacks 降级为可读名称', () => {
    const bdl: ShotReferenceBundle = {
      ...bundle([
        item({ kind: 'grid-anchor', mentionToken: '@grid_anchor' }),
      ]),
      mentionFallbacks: [
        { mentionToken: '@prop_meat', label: '红烧肉' },
        { mentionToken: '@prop_book', label: '字典' },
      ],
    };

    const result = compileShotPromptToBundle({
      prompt: '@grid_anchor 中，@prop_meat 红烧肉 放在桌面，随后举起 @prop_book。',
      bundle: bdl,
    });

    expect(result.compiledPrompt).toBe('@Image 1 中， 红烧肉 放在桌面，随后举起 字典。');
    expect(result.compiledPrompt).not.toContain('@prop_');
    expect(result.debug.unmappedTokens).toEqual(['@prop_meat', '@prop_book']);
  });

  it('多次出现的同一未匹配 token 在 unmappedTokens 中只算一次', () => {
    const bdl = bundle([]);
    const result = compileShotPromptToBundle({
      prompt: '@scene_xx 又是 @scene_xx',
      bundle: bdl,
    });
    expect(result.debug.unmappedTokens).toEqual(['@scene_xx']);
  });
});

describe('compileShotPromptToBundle — references 数组', () => {
  it('references 严格按 bundle.items 顺序产出', () => {
    const sceneAsset = { kind: 'image' as const, remoteUrl: 'https://example.com/scene.png', createdAt: 1 };
    const charAsset = { kind: 'image' as const, remoteUrl: 'https://example.com/char.png', createdAt: 1 };
    const bdl = bundle([
      item({ kind: 'scene', mentionToken: '@scene_x', source: sceneAsset }),
      item({ kind: 'character', mentionToken: '@char_x', source: charAsset }),
    ]);

    const result = compileShotPromptToBundle({ prompt: '空文本', bundle: bdl });
    expect(result.references[0]).toBe(sceneAsset);
    expect(result.references[1]).toBe(charAsset);
  });

  it('空 bundle 时 references 为空', () => {
    const result = compileShotPromptToBundle({ prompt: '纯文字', bundle: bundle([]) });
    expect(result.references).toEqual([]);
    expect(result.compiledPrompt).toBe('纯文字');
  });
});

describe('_resolveTokenIndex', () => {
  it('返回 1-based 位置', () => {
    const bdl = bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
      item({ kind: 'scene', mentionToken: '@scene_x' }),
    ]);
    expect(_resolveTokenIndex('@shot_anchor', bdl)).toBe(1);
    expect(_resolveTokenIndex('@scene_x', bdl)).toBe(2);
    expect(_resolveTokenIndex('@unknown', bdl)).toBeUndefined();
  });
});
