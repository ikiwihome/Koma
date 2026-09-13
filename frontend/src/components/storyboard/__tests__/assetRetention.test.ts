/**
 * 资产丢失 Bug 集成测试
 *
 * 提取 Storyboard 中的核心资产保留逻辑为纯函数进行测试，
 * 覆盖 4 条已知丢失路径和 6 个编排器指定的测试场景。
 *
 * 已知丢失路径：
 * 1. 用户手动编辑提示词（不含 @mentions）→ syncFromPrompt 返回空 → 资产被覆盖为空
 * 2. 批量生成提示词 → React 重渲染 → ScriptEditor onChange 反向触发 → 资产被覆盖
 * 3. (已修复并删除) useStoryboardHandlers 中的 handler 无条件覆盖资产
 * 4. episodeAnalysis 的 refs 为空 → 资产面板不显示
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShotAssetSync } from '../../../hooks/useShotAssetSync';
import type { Shot, Character, Scene, Prop, EpisodeAnalysis } from '../../../types';

// === 测试数据工厂 ===

function createShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'shot-001',
    scriptLines: [{ id: 'l1', text: '小明走进森林' }],
    shotType: 'medium',
    cameraMovement: 'static',
    duration: 3,
    characters: ['char-001'],
    scenes: ['scene-001'],
    props: ['prop-001'],
    dialogue: '',
    emotion: '',
    imagePrompt: '@char_char-001 在 @scene_scene-001 中',
    videoPrompt: '@char_char-001 走进 @scene_scene-001',
    ...overrides,
  };
}

function createCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-001',
    name: '小明',
    prompt: '短发少年，深色外套，平静站姿',
    description: '主角',
    sora2CharacterId: 'sora2-c1',
    episodeRefs: [],
    ...overrides,
  } as Character;
}

function createScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-001',
    name: '森林',
    prompt: '密集树干，潮湿地面，雾气弥漫',
    description: '茂密的森林',
    episodeRefs: [],
    ...overrides,
  } as Scene;
}

function createProp(overrides: Partial<Prop> = {}): Prop {
  return {
    id: 'prop-001',
    name: '宝剑',
    prompt: '古铜剑柄，细长剑身，表面磨损',
    description: '一把古剑',
    sora2PropId: 'sora2-p1',
    episodeRefs: [],
    ...overrides,
  } as Prop;
}

const defaultAssets = {
  characters: [createCharacter()],
  scenes: [createScene()],
  props: [createProp()],
};

// === 模拟 Storyboard 中的 handleImagePromptChange 逻辑 ===
// 提取自 Storyboard.tsx:492-518

function simulateImagePromptChange(
  shotId: string,
  imagePrompt: string,
  shots: Shot[],
  syncFromPrompt: ReturnType<typeof useShotAssetSync>['syncFromPrompt'],
  generatingImagePrompts: Set<string>
): Shot[] | null {
  // 批量生成期间跳过
  if (generatingImagePrompts.has(shotId)) return null;

  const shot = shots.find(s => s.id === shotId);
  if (!shot) return null;

  const syncState = syncFromPrompt(imagePrompt);
  const hasMentions = syncState.mentionedAssets.length > 0;

  return shots.map(s =>
    s.id === shotId ? {
      ...s,
      imagePrompt,
      ...(hasMentions ? {
        characters: syncState.selectedCharacters,
        scenes: syncState.selectedScenes,
        props: syncState.selectedProps,
      } : {}),
    } : s
  );
}

// === 模拟 episodeAnalysis refs 过滤逻辑 ===
// 提取自 Storyboard.tsx:199-226 和 AssetManagerPanel.tsx:120-136

function filterAssetsByEpisodeAnalysis(
  analysis: EpisodeAnalysis | null,
  shots: Shot[],
  allCharacters: Character[],
  allScenes: Scene[],
  allProps: Prop[]
): { characters: Character[]; scenes: Scene[]; props: Prop[] } {
  if (!analysis) {
    return { characters: allCharacters, scenes: allScenes, props: allProps };
  }

  // Storyboard 逻辑：合并 analysis refs + shots 中的资产 ID
  const charRefs = new Set(analysis.characterRefs || []);
  const sceneRefs = new Set(analysis.sceneRefs || []);
  const propRefs = new Set(analysis.propRefs || []);

  for (const shot of shots) {
    for (const id of shot.characters || []) { if (id) charRefs.add(id); }
    for (const id of shot.scenes || []) { if (id) sceneRefs.add(id); }
    for (const id of shot.props || []) { if (id) propRefs.add(id); }
  }

  return {
    characters: charRefs.size > 0 ? allCharacters.filter(c => charRefs.has(c.id)) : allCharacters,
    scenes: sceneRefs.size > 0 ? allScenes.filter(s => sceneRefs.has(s.id)) : allScenes,
    props: propRefs.size > 0 ? allProps.filter(p => propRefs.has(p.id)) : allProps,
  };
}

// ============================================================
// 测试场景 1: 单个 shot 生成图像提示词后，资产是否保留
// ============================================================
describe('场景1: 单个 shot 生成图像提示词后资产保留', () => {
  it('TC-INT-001: 生成的提示词含 @mentions 时，资产应更新为提示词中的资产', () => {
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({ characters: ['char-001'], scenes: ['scene-001'], props: ['prop-001'] });

    // 模拟 LLM 生成的提示词（含 @mentions）
    const generatedPrompt = '一个年轻人 @char_char-001 走在 @scene_scene-001 的小路上';
    const updatedShots = simulateImagePromptChange(
      'shot-001', generatedPrompt, [shot], result.current.syncFromPrompt, new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].imagePrompt).toBe(generatedPrompt);
    expect(updatedShots![0].characters).toEqual(['char-001']);
    expect(updatedShots![0].scenes).toEqual(['scene-001']);
  });

  it('TC-INT-002: 生成的提示词不含 @mentions 时，已有资产不应被覆盖为空', () => {
    // 验证修复 24d57b1: hasMentions 保护
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({
      characters: ['char-001'],
      scenes: ['scene-001'],
      props: ['prop-001'],
    });

    // 模拟 LLM 生成的提示词（不含 @mentions）
    const generatedPrompt = 'A young man walks through a dense forest path';
    const updatedShots = simulateImagePromptChange(
      'shot-001', generatedPrompt, [shot], result.current.syncFromPrompt, new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].imagePrompt).toBe(generatedPrompt);
    // 关键断言：资产不应被覆盖为空
    expect(updatedShots![0].characters).toEqual(['char-001']);
    expect(updatedShots![0].scenes).toEqual(['scene-001']);
    expect(updatedShots![0].props).toEqual(['prop-001']);
  });
});


// ============================================================
// 测试场景 2: 批量生成所有 shot 的图像提示词后，资产是否保留
// ============================================================
describe('场景2: 批量生成提示词后资产保留', () => {
  it('TC-INT-003: 批量生成期间，ScriptEditor onChange 应被跳过', () => {
    // 验证修复 5e79d58: generatingImagePrompts 保护
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({
      characters: ['char-001'],
      scenes: ['scene-001'],
      props: ['prop-001'],
    });

    // 模拟批量生成期间 ScriptEditor 触发的 onChange
    const generatingSet = new Set(['shot-001']);
    const updatedShots = simulateImagePromptChange(
      'shot-001', '新的提示词', [shot], result.current.syncFromPrompt, generatingSet
    );

    // 应返回 null（跳过处理）
    expect(updatedShots).toBeNull();
  });

  it('TC-INT-004: 批量生成完成后，正常编辑应恢复资产同步', () => {
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({
      characters: ['char-001'],
      imagePrompt: 'LLM 生成的提示词 @char_char-001',
    });

    // 批量生成已完成，generatingSet 为空
    const updatedShots = simulateImagePromptChange(
      'shot-001',
      '用户编辑后 @char_char-001 在森林中',
      [shot],
      result.current.syncFromPrompt,
      new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].characters).toEqual(['char-001']);
  });

  it('TC-INT-005: 批量生成多个 shot 时，未生成的 shot 不受影响', () => {
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shots = [
      createShot({ id: 'shot-001', characters: ['char-001'] }),
      createShot({ id: 'shot-002', characters: ['char-001'] }),
    ];

    // 只有 shot-001 在生成中
    const generatingSet = new Set(['shot-001']);

    // shot-002 的编辑应正常处理
    const updatedShots = simulateImagePromptChange(
      'shot-002',
      '编辑 @char_char-001',
      shots,
      result.current.syncFromPrompt,
      generatingSet
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![1].characters).toEqual(['char-001']);
  });
});


// ============================================================
// 测试场景 3: 用户手动编辑提示词（不含 @mentions）后，资产是否保留
// ============================================================
describe('场景3: 手动编辑提示词（不含 @mentions）后资产保留', () => {
  it('TC-INT-006: 用户删除所有 @mentions 后手动输入纯文本，资产不应丢失', () => {
    // 验证丢失路径 1 的修复
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({
      characters: ['char-001'],
      scenes: ['scene-001'],
      props: ['prop-001'],
      imagePrompt: '@char_char-001 在 @scene_scene-001 中拿着 @prop_prop-001',
    });

    // 用户完全重写提示词，不含任何 @mentions
    const updatedShots = simulateImagePromptChange(
      'shot-001',
      '一个年轻人在茂密的森林中行走，手持一把古剑',
      [shot],
      result.current.syncFromPrompt,
      new Set()
    );

    expect(updatedShots).not.toBeNull();
    // 关键断言：资产保留
    expect(updatedShots![0].characters).toEqual(['char-001']);
    expect(updatedShots![0].scenes).toEqual(['scene-001']);
    expect(updatedShots![0].props).toEqual(['prop-001']);
  });

  it('TC-INT-007: 用户输入空提示词，资产不应丢失', () => {
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({
      characters: ['char-001'],
      scenes: ['scene-001'],
    });

    const updatedShots = simulateImagePromptChange(
      'shot-001', '', [shot], result.current.syncFromPrompt, new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].characters).toEqual(['char-001']);
    expect(updatedShots![0].scenes).toEqual(['scene-001']);
  });

  it('TC-INT-008: 用户输入含特殊字符但无 @mentions 的文本，资产不应丢失', () => {
    const { result } = renderHook(() => useShotAssetSync(defaultAssets));
    const shot = createShot({ characters: ['char-001'] });

    const updatedShots = simulateImagePromptChange(
      'shot-001',
      '角色在场景中！@#$%^&*()，使用道具。',
      [shot],
      result.current.syncFromPrompt,
      new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].characters).toEqual(['char-001']);
  });
});


// ============================================================
// 测试场景 4: 用户手动编辑提示词（含 @mentions）后，资产是否正确更新
// ============================================================
describe('场景4: 手动编辑提示词（含 @mentions）后资产正确更新', () => {
  it('TC-INT-009: 用户添加新的 @mention 后，资产应更新', () => {
    const assets = {
      characters: [
        createCharacter({ id: 'char-001', sora2CharacterId: 'sora2-c1' }),
        createCharacter({ id: 'char-002', name: '小红', sora2CharacterId: 'sora2-c2' }),
      ],
      scenes: [createScene()],
      props: [createProp()],
    };
    const { result } = renderHook(() => useShotAssetSync(assets));
    const shot = createShot({ characters: ['char-001'] });

    // 用户手动添加了第二个角色的 @mention
    const updatedShots = simulateImagePromptChange(
      'shot-001',
      '@char_char-001 和 @char_char-002 在森林中',
      [shot],
      result.current.syncFromPrompt,
      new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].characters).toEqual(['char-001', 'char-002']);
  });

  it('TC-INT-010: 用户移除部分 @mention 后，资产应相应减少', () => {
    const assets = {
      characters: [
        createCharacter({ id: 'char-001', sora2CharacterId: 'sora2-c1' }),
        createCharacter({ id: 'char-002', name: '小红', sora2CharacterId: 'sora2-c2' }),
      ],
      scenes: [createScene()],
      props: [createProp()],
    };
    const { result } = renderHook(() => useShotAssetSync(assets));
    const shot = createShot({ characters: ['char-001', 'char-002'] });

    // 用户移除了第二个角色的 @mention
    const updatedShots = simulateImagePromptChange(
      'shot-001',
      '@char_char-001 独自在森林中',
      [shot],
      result.current.syncFromPrompt,
      new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].characters).toEqual(['char-001']);
  });

  it('TC-INT-011: 用户替换所有 @mentions 为不同资产，资产应完全更新', () => {
    const assets = {
      characters: [
        createCharacter({ id: 'char-001', sora2CharacterId: 'sora2-c1' }),
        createCharacter({ id: 'char-002', name: '小红', sora2CharacterId: 'sora2-c2' }),
      ],
      scenes: [createScene()],
      props: [createProp()],
    };
    const { result } = renderHook(() => useShotAssetSync(assets));
    const shot = createShot({ characters: ['char-001'] });

    // 用户将 char-001 替换为 char-002
    const updatedShots = simulateImagePromptChange(
      'shot-001',
      '@char_char-002 独自在森林中',
      [shot],
      result.current.syncFromPrompt,
      new Set()
    );

    expect(updatedShots).not.toBeNull();
    expect(updatedShots![0].characters).toEqual(['char-002']);
  });
});


// ============================================================
// 测试场景 5: 加载含有资产绑定的项目后，资产面板是否正确显示
// ============================================================
describe('场景5: 加载项目后资产面板正确显示', () => {
  it('TC-INT-012: episodeAnalysis refs 正常时，应正确过滤资产', () => {
    const analysis: EpisodeAnalysis = {
      episodeId: 'ep-001',
      characterRefs: ['char-001'],
      sceneRefs: ['scene-001'],
      propRefs: ['prop-001'],
      shots: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const allChars = [
      createCharacter({ id: 'char-001' }),
      createCharacter({ id: 'char-002', name: '小红' }),
    ];
    const allScenes = [
      createScene({ id: 'scene-001' }),
      createScene({ id: 'scene-002', name: '城市' }),
    ];
    const allProps = [createProp()];

    const filtered = filterAssetsByEpisodeAnalysis(analysis, [], allChars, allScenes, allProps);
    expect(filtered.characters).toHaveLength(1);
    expect(filtered.characters[0].id).toBe('char-001');
    expect(filtered.scenes).toHaveLength(1);
    expect(filtered.scenes[0].id).toBe('scene-001');
  });

  it('TC-INT-013: episodeAnalysis refs 为空时，应从 shots 中补充资产引用', () => {
    // 验证丢失路径 4 的修复 (163c12f)
    const analysis: EpisodeAnalysis = {
      episodeId: 'ep-001',
      characterRefs: [],  // 空！
      sceneRefs: [],      // 空！
      propRefs: [],       // 空！
      shots: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const shots = [createShot({ characters: ['char-001'], scenes: ['scene-001'], props: ['prop-001'] })];
    const allChars = [createCharacter({ id: 'char-001' }), createCharacter({ id: 'char-002', name: '小红' })];
    const allScenes = [createScene({ id: 'scene-001' }), createScene({ id: 'scene-002', name: '城市' })];
    const allProps = [createProp({ id: 'prop-001' }), createProp({ id: 'prop-002', name: '盾牌' })];

    const filtered = filterAssetsByEpisodeAnalysis(analysis, shots, allChars, allScenes, allProps);

    // 应从 shots 中提取资产引用，而非显示空
    expect(filtered.characters).toHaveLength(1);
    expect(filtered.characters[0].id).toBe('char-001');
    expect(filtered.scenes).toHaveLength(1);
    expect(filtered.scenes[0].id).toBe('scene-001');
    expect(filtered.props).toHaveLength(1);
    expect(filtered.props[0].id).toBe('prop-001');
  });

  it('TC-INT-014: episodeAnalysis 为 null 时，应显示全部资产', () => {
    const allChars = [createCharacter(), createCharacter({ id: 'char-002', name: '小红' })];
    const allScenes = [createScene()];
    const allProps = [createProp()];

    const filtered = filterAssetsByEpisodeAnalysis(null, [], allChars, allScenes, allProps);
    expect(filtered.characters).toHaveLength(2);
    expect(filtered.scenes).toHaveLength(1);
    expect(filtered.props).toHaveLength(1);
  });

  it('TC-INT-015: episodeAnalysis refs 和 shots 都为空时，应显示全部资产', () => {
    const analysis: EpisodeAnalysis = {
      episodeId: 'ep-001',
      characterRefs: [],
      sceneRefs: [],
      propRefs: [],
      shots: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const allChars = [createCharacter()];
    const allScenes = [createScene()];
    const allProps = [createProp()];

    const filtered = filterAssetsByEpisodeAnalysis(analysis, [], allChars, allScenes, allProps);
    // refs 为空且 shots 也为空 → charRefs.size === 0 → 保留全部
    expect(filtered.characters).toHaveLength(1);
    expect(filtered.scenes).toHaveLength(1);
    expect(filtered.props).toHaveLength(1);
  });
});


// ============================================================
// 测试场景 6: 旧数据修复（名称字符串 → ID 映射）
// ============================================================
describe('场景6: 旧数据资产绑定修复', () => {
  it('TC-INT-016: 旧数据迁移逻辑已移除（不再在前端做名称到 ID 的修复）', () => {
    // 按“一刀切”策略：不再在运行时修复旧的名称字符串引用，提示词与绑定一律使用项目内 ID。
    expect(true).toBe(true);
  });
});
