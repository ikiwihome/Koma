import { describe, expect, it } from 'vitest';
import type { ShotReferenceBundle, ShotReferenceItem } from './types';
import {
  renderGridSequenceNotice,
  renderShotMentionReferenceTable,
  renderShotReferenceTable,
  summarizeBundle,
} from './render';

function item(partial: Partial<ShotReferenceItem> & Pick<ShotReferenceItem, 'kind' | 'mentionToken'>): ShotReferenceItem {
  return {
    id: partial.id ?? 'id',
    label: partial.label ?? '示例项',
    source: { kind: 'image', remoteUrl: 'https://example.com/x.png', createdAt: 1 },
    priority: partial.priority ?? 50,
    ...partial,
  };
}

function bundle(items: ShotReferenceItem[], truncatedCount = 0): ShotReferenceBundle {
  return {
    items,
    hasGridAnchor: items.some(i => i.kind === 'grid-anchor'),
    hasShotImage: items.some(i => i.kind === 'shot-anchor' || i.kind === 'grid-anchor'),
    capacity: { maxRefs: 6, truncatedCount, truncatedKinds: [] },
  };
}

describe('renderShotReferenceTable', () => {
  it('空 bundle 输出无视觉参考说明', () => {
    const out = renderShotReferenceTable(bundle([]));
    expect(out).toContain('本镜头无任何视觉参考');
    expect(out).toContain('不要使用 @shot_anchor / @grid_anchor');
  });

  it('只有资产参考但无分镜图时明确禁止锚点 token', () => {
    const out = renderShotReferenceTable(bundle([
      item({ kind: 'scene', mentionToken: '@scene_xx', label: '场景：宿舍' }),
      item({ kind: 'character', mentionToken: '@char_zhouming', label: '角色：周明' }),
    ]));
    expect(out).toContain('本集合不含真实分镜锚定图 / 宫格锚定图');
    expect(out).toContain('不要使用 @shot_anchor / @grid_anchor');
  });

  it('每项映射成 references[N] / @Image N 一行', () => {
    const out = renderShotReferenceTable(bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor', label: '分镜锚点首帧' }),
      item({ kind: 'scene', mentionToken: '@scene_xx', label: '场景：宿舍' }),
      item({ kind: 'character', mentionToken: '@char_zhouming', label: '角色：周明' }),
    ]));
    expect(out).toContain('references[0] / @Image 1：分镜锚点首帧');
    expect(out).toContain('references[1] / @Image 2：场景：宿舍');
    expect(out).toContain('references[2] / @Image 3：角色：周明');
    // 提醒 LLM 用 @Image N 严格引用
    expect(out).toContain('@Image N');
  });

  it('含截断时输出备注', () => {
    const out = renderShotReferenceTable(bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
    ], 3));
    expect(out).toContain('另有 3 项次要资产');
    expect(out).toContain('不应引用未列出的位置');
  });
});

describe('renderGridSequenceNotice', () => {
  it('bundle 不含 grid-anchor 时返回空串', () => {
    const out = renderGridSequenceNotice(bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
    ]));
    expect(out).toBe('');
  });

  it('bundle 含 grid-anchor 时输出九宫格时序说明，且引用具体的 references 位置', () => {
    const b = bundle([
      item({ kind: 'grid-anchor', mentionToken: '@grid_anchor', label: '分镜九宫格锚点' }),
      item({ kind: 'scene', mentionToken: '@scene_xx', label: '场景' }),
    ]);
    b.gridCellCount = 9;
    const out = renderGridSequenceNotice(b);
    expect(out).toContain('九宫格锚点专属说明');
    expect(out).toContain('references[0] / @Image 1');
    expect(out).toContain('3×3 九宫格图');
    expect(out).toContain('左→右、上→下');
    expect(out).toContain('9 个镜头硬切结构');
    expect(out).toContain('镜头 9：收束');
  });

  it('bundle.gridCellCount=4 时输出四宫格说明，明确 4 镜头硬切', () => {
    const b = bundle([
      item({ kind: 'grid-anchor', mentionToken: '@grid_anchor', label: '分镜四宫格锚点' }),
    ]);
    b.gridCellCount = 4;
    const out = renderGridSequenceNotice(b);
    expect(out).toContain('四宫格锚点专属说明');
    expect(out).toContain('2×2 四宫格图');
    expect(out).toContain('4 个镜头硬切结构');
    expect(out).toContain('镜头 1：起手');
    expect(out).toContain('镜头 4：收束');
    expect(out).not.toContain('镜头 5');
  });
});

describe('renderShotMentionReferenceTable', () => {
  it('故事板等可编辑提示词阶段只暴露语义 mention，不暴露 @Image N', () => {
    const out = renderShotMentionReferenceTable(bundle([
      item({ kind: 'previous-storyboard-anchor', mentionToken: '@previous_storyboard_anchor', label: '上一故事板锚点' }),
      item({ kind: 'scene', mentionToken: '@scene_room', label: '场景：叶赎居所室内' }),
      item({ kind: 'character', mentionToken: '@char_yeshu', label: '角色：叶赎' }),
    ]));

    expect(out).toContain('@previous_storyboard_anchor 上一故事板锚点');
    expect(out).toContain('@scene_room 场景：叶赎居所室内');
    expect(out).toContain('@char_yeshu 角色：叶赎');
    expect(out).toContain('禁止输出 @Image N');
    expect(out).not.toContain('references[0]');
    expect(out).not.toContain('@Image 1');
  });
});

describe('summarizeBundle', () => {
  it('空 bundle 返回 (empty)', () => {
    expect(summarizeBundle(bundle([]))).toBe('(empty)');
  });

  it('正常 bundle 返回简短 kind:label 摘要', () => {
    const out = summarizeBundle(bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor', label: '分镜锚点首帧' }),
      item({ kind: 'scene', mentionToken: '@scene_xx', label: '场景：宿舍' }),
    ]));
    expect(out).toContain('shot-anchor');
    expect(out).toContain('scene');
    expect(out).toContain('|');
  });

  it('含截断时附加 +N truncated', () => {
    const out = summarizeBundle(bundle([
      item({ kind: 'shot-anchor', mentionToken: '@shot_anchor' }),
    ], 2));
    expect(out).toContain('+2 truncated');
  });
});
