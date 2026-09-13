/**
 * useShotAssetSync 单元测试
 * 覆盖资产同步 Hook 的核心逻辑：syncFromPrompt、handleAssetChange、getDiff
 *
 * 重点验证 4 条已知资产丢失路径的修复：
 * 1. syncFromPrompt 对不含 @mentions 的文本返回空 → 不应覆盖已有资产
 * 2. handleAssetChange 正确添加/移除 mention
 * 3. getAssetIdFromMention 支持 fullId 匹配（带前缀）
 * 4. getDiff 正确计算差异
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShotAssetSync } from './useShotAssetSync';
import type { Character, Scene, Prop } from '../types';

// === 测试数据工厂 ===

function createCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-001',
    name: '小明',
    description: '主角',
    sora2CharacterId: 'sora2-char-001',
    episodeRefs: [],
    ...overrides,
  } as Character;
}

function createScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'scene-001',
    name: '森林',
    description: '茂密的森林',
    episodeRefs: [],
    ...overrides,
  } as Scene;
}

function createProp(overrides: Partial<Prop> = {}): Prop {
  return {
    id: 'prop-001',
    name: '宝剑',
    description: '一把古剑',
    sora2PropId: 'sora2-prop-001',
    episodeRefs: [],
    ...overrides,
  } as Prop;
}

function createAssets(options?: {
  characters?: Partial<Character>[];
  scenes?: Partial<Scene>[];
  props?: Partial<Prop>[];
}) {
  return {
    characters: (options?.characters || [{}]).map(createCharacter),
    scenes: (options?.scenes || [{}]).map(createScene),
    props: (options?.props || [{}]).map(createProp),
  };
}

describe('useShotAssetSync', () => {
  describe('syncFromPrompt', () => {
    // === 正向路径（Happy Path）===

    it('TC-SYNC-001: 应从提示词中解析出角色资产（通过项目内 ID 匹配）', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('一个女孩 @char_char-001 站在窗前');
      expect(state.selectedCharacters).toEqual(['char-001']);
      expect(state.mentionedAssets).toHaveLength(1);
    });

    it('TC-SYNC-002: 应从提示词中解析出场景资产', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('在 @scene_scene-001 中');
      expect(state.selectedScenes).toEqual(['scene-001']);
    });

    it('TC-SYNC-003: 应从提示词中解析出道具资产（通过项目内 ID 匹配）', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('拿起 @prop_prop-001');
      expect(state.selectedProps).toEqual(['prop-001']);
    });

    it('TC-SYNC-004: 应同时解析多种类型的资产', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt(
        '@char_char-001 在 @scene_scene-001 中拿起 @prop_prop-001'
      );
      expect(state.selectedCharacters).toEqual(['char-001']);
      expect(state.selectedScenes).toEqual(['scene-001']);
      expect(state.selectedProps).toEqual(['prop-001']);
    });

    it('TC-SYNC-005: 应通过原始 ID 匹配资产（无 sora2 ID 时）', () => {
      const assets = createAssets({
        characters: [{ id: 'char-001', sora2CharacterId: undefined }],
      });
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('@char_char-001');
      expect(state.selectedCharacters).toEqual(['char-001']);
    });

    it('TC-SYNC-006: 应通过 fullId（带前缀）匹配资产', () => {
      // 修复 24d57b1: getAssetIdFromMention 支持 fullId 匹配
      const assets = createAssets({
        characters: [{ id: 'char_abc', sora2CharacterId: undefined }],
      });
      const { result } = renderHook(() => useShotAssetSync(assets));

      // 解析 @char_abc → type='char', id='abc' → fullId='char_abc' → 匹配 char.id
      const state = result.current.syncFromPrompt('@char_abc');
      expect(state.selectedCharacters).toEqual(['char_abc']);
    });

    // === 逆向路径（资产丢失场景）===

    it('TC-SYNC-007: 不含 @mentions 的纯文本应返回空资产列表', () => {
      // 丢失路径 1: 用户手动编辑提示词（不含 @mentions）→ syncFromPrompt 返回空
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('一个女孩站在窗前，阳光洒在她的脸上');
      expect(state.selectedCharacters).toEqual([]);
      expect(state.selectedScenes).toEqual([]);
      expect(state.selectedProps).toEqual([]);
      expect(state.mentionedAssets).toEqual([]);
    });

    it('TC-SYNC-008: 空字符串应返回空资产列表', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('');
      expect(state.selectedCharacters).toEqual([]);
      expect(state.selectedScenes).toEqual([]);
      expect(state.selectedProps).toEqual([]);
    });

    it('TC-SYNC-009: mention 引用不存在的资产 ID 应被忽略', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('@char_nonexistent @scene_unknown');
      expect(state.selectedCharacters).toEqual([]);
      expect(state.selectedScenes).toEqual([]);
    });

    // === 边界条件 ===

    it('TC-SYNC-010: 重复的 mention 应去重', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt(
        '@char_char-001 和 @char_char-001 在一起'
      );
      expect(state.selectedCharacters).toEqual(['char-001']);
      expect(state.selectedCharacters).toHaveLength(1);
    });

    it('TC-SYNC-011: 多个不同角色应全部解析', () => {
      const assets = createAssets({
        characters: [
          { id: 'char-001', name: '小明', sora2CharacterId: 'sora2-c1' },
          { id: 'char-002', name: '小红', sora2CharacterId: 'sora2-c2' },
        ],
      });
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('@char_char-001 和 @char_char-002');
      expect(state.selectedCharacters).toEqual(['char-001', 'char-002']);
    });

    it('TC-SYNC-012: 空资产列表时应正常返回空结果', () => {
      const assets = { characters: [], scenes: [], props: [] };
      const { result } = renderHook(() => useShotAssetSync(assets));

      const state = result.current.syncFromPrompt('@char_abc @scene_def');
      expect(state.selectedCharacters).toEqual([]);
      expect(state.selectedScenes).toEqual([]);
    });
  });

  describe('handleAssetChange', () => {
    // === 正向路径 ===

    it('TC-ASSET-001: 添加角色应在提示词末尾追加 mention', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const newPrompt = result.current.handleAssetChange(
        'character',
        ['char-001'],
        '一个女孩站在窗前',
        assets
      );
      expect(newPrompt).toContain('@char_char-001');
    });

    it('TC-ASSET-002: 移除角色应从提示词中删除对应 mention', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const newPrompt = result.current.handleAssetChange(
        'character',
        [],
        '一个女孩 @char_char-001 站在窗前',
        assets
      );
      expect(newPrompt).not.toContain('@char_char-001');
    });

    it('TC-ASSET-003: 添加场景应正确追加 scene mention', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const newPrompt = result.current.handleAssetChange(
        'scene',
        ['scene-001'],
        '一片空地',
        assets
      );
      expect(newPrompt).toContain('@scene_scene-001');
    });

    it('TC-ASSET-004: 添加道具应使用项目内 ID', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const newPrompt = result.current.handleAssetChange(
        'prop',
        ['prop-001'],
        '桌上放着',
        assets
      );
      expect(newPrompt).toContain('@prop_prop-001');
    });

    // === 逆向路径 ===

    it('TC-ASSET-005: 空提示词中添加资产应正确生成', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const newPrompt = result.current.handleAssetChange(
        'character',
        ['char-001'],
        '',
        assets
      );
      expect(newPrompt).toBe('@char_char-001');
    });

    it('TC-ASSET-006: 已存在的资产不应重复添加', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const newPrompt = result.current.handleAssetChange(
        'character',
        ['char-001'],
        '已有 @char_char-001 在这里',
        assets
      );
      // 不应出现两个 @char_char-001
      const matches = newPrompt.match(/@char_char-001/g);
      expect(matches).toHaveLength(1);
    });

    // === 状态组合 ===

    it('TC-ASSET-007: 同时添加和移除不同资产', () => {
      const assets = createAssets({
        characters: [
          { id: 'char-001', name: '小明', sora2CharacterId: 'sora2-c1' },
          { id: 'char-002', name: '小红', sora2CharacterId: 'sora2-c2' },
        ],
      });
      const { result } = renderHook(() => useShotAssetSync(assets));

      // 原来有 char-001，现在换成 char-002
      const newPrompt = result.current.handleAssetChange(
        'character',
        ['char-002'],
        '角色 @char_char-001 在场景中',
        assets
      );
      expect(newPrompt).not.toContain('@char_char-001');
      expect(newPrompt).toContain('@char_char-002');
    });
  });

  describe('getDiff', () => {
    it('TC-DIFF-001: 选中但不在提示词中的资产应出现在 toAdd', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const diff = result.current.getDiff('纯文本', ['char-001'], [], []);
      expect(diff.toAdd).toHaveLength(1);
      expect(diff.toAdd[0]).toMatchObject({ type: 'char', name: '小明' });
    });

    it('TC-DIFF-002: 在提示词中但未选中的资产应出现在 toRemove', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const diff = result.current.getDiff('@char_char-001', [], [], []);
      expect(diff.toRemove).toHaveLength(1);
      expect(diff.toRemove[0].type).toBe('char');
    });

    it('TC-DIFF-003: 完全同步时 toAdd 和 toRemove 都应为空', () => {
      const assets = createAssets();
      const { result } = renderHook(() => useShotAssetSync(assets));

      const diff = result.current.getDiff(
        '@char_char-001 @scene_scene-001',
        ['char-001'],
        ['scene-001'],
        []
      );
      expect(diff.toAdd).toEqual([]);
      expect(diff.toRemove).toEqual([]);
    });
  });
});
