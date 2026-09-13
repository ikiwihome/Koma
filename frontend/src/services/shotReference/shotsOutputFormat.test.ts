import { describe, expect, it } from 'vitest';
import type { ShotReferenceBundle, ShotReferenceItem } from './types';
import { decideShotsMode, renderShotsSection } from './shotsOutputFormat';

function bundle(items: ShotReferenceItem[]): ShotReferenceBundle {
  return {
    items,
    hasGridAnchor: items.some(i => i.kind === 'grid-anchor'),
    hasShotImage: items.some(i => i.kind === 'shot-anchor' || i.kind === 'grid-anchor'),
    capacity: { maxRefs: 10, truncatedCount: 0, truncatedKinds: [] },
  };
}

function gridItem(): ShotReferenceItem {
  return {
    kind: 'grid-anchor',
    id: 'shot-1#grid',
    label: '九宫格锚点',
    source: { kind: 'image', remoteUrl: 'https://example.com/grid.png', createdAt: 1 },
    mentionToken: '@grid_anchor',
    priority: 100,
  };
}

function shotAnchor(): ShotReferenceItem {
  return {
    kind: 'shot-anchor',
    id: 'shot-1',
    label: '分镜锚点首帧',
    source: { kind: 'image', remoteUrl: 'https://example.com/shot.png', createdAt: 1 },
    mentionToken: '@shot_anchor',
    priority: 100,
  };
}

describe('decideShotsMode', () => {
  it('bundle 无 grid-anchor + 没传 cellCount → normal', () => {
    expect(decideShotsMode(bundle([shotAnchor()]))).toBe('normal');
    expect(decideShotsMode(bundle([]))).toBe('normal');
  });

  it('没有 grid-anchor 时忽略 explicitCellCount，避免内置不存在的宫格锚点', () => {
    expect(decideShotsMode(bundle([]), 4)).toBe('normal');
    expect(decideShotsMode(bundle([]), 9)).toBe('normal');
    expect(decideShotsMode(bundle([shotAnchor()]), 4)).toBe('normal');
  });

  it('bundle 含 grid-anchor + cellCount=9 → grid-9', () => {
    expect(decideShotsMode(bundle([gridItem()]), 9)).toBe('grid-9');
  });

  it('bundle 含 grid-anchor + cellCount=4 → grid-4', () => {
    expect(decideShotsMode(bundle([gridItem()]), 4)).toBe('grid-4');
  });

  it('bundle 含 grid-anchor + 不传 cellCount → 走 bundle.gridCellCount 兜底（默认 9）', () => {
    expect(decideShotsMode(bundle([gridItem()]))).toBe('grid-9');
  });
});

describe('renderShotsSection — normal', () => {
  it('6s 输出含 2-3 镜头骨架 + 6 秒预算说明', () => {
    const out = renderShotsSection({ mode: 'normal', duration: 6 });
    expect(out).toContain('【分镜镜头内容】');
    expect(out).toContain('镜头1：');
    expect(out).toContain('# 可选镜头2');
    expect(out).toContain('# 可选镜头3');
    expect(out).toContain('精确为6秒');
  });

  it('10s 输出 4-6/3-4 秒预算', () => {
    const out = renderShotsSection({ mode: 'normal', duration: 10 });
    expect(out).toContain('精确为10秒');
    expect(out).toContain('2镜头方案单镜头4-6秒');
    expect(out).toContain('3镜头方案单镜头3-4秒');
  });

  it('15s 输出 7-8/4-6 秒预算', () => {
    const out = renderShotsSection({ mode: 'normal', duration: 15 });
    expect(out).toContain('精确为15秒');
  });

  it('20s 输出 9-11/6-8 秒预算', () => {
    const out = renderShotsSection({ mode: 'normal', duration: 20 });
    expect(out).toContain('精确为20秒');
    expect(out).toContain('2镜头方案单镜头9-11秒');
  });
});

describe('renderShotsSection — grid-9', () => {
  it('输出 9 个镜头硬切骨架，每镜头独立成段', () => {
    const out = renderShotsSection({ mode: 'grid-9', duration: 6 });
    expect(out).toContain('9 镜头硬切结构');
    expect(out).toContain('必须输出 9 个镜头');
    // 9 个 镜头独立 header
    for (let n = 1; n <= 9; n += 1) {
      expect(out).toContain(`镜头 ${n}（`);
      expect(out).toContain(`cell ${n}`);
    }
  });

  it('每镜头时长 = duration / 9', () => {
    const out = renderShotsSection({ mode: 'grid-9', duration: 9 });
    expect(out).toContain('1 秒');
    expect(out).toContain('9 镜头总和精确 9 秒');
  });

  it('首镜断言继承上方【上单元结尾锚定帧】；末镜断言收束至上方【本单元结尾锚定帧】（不重复描述内容）', () => {
    const out = renderShotsSection({ mode: 'grid-9', duration: 9 });
    expect(out).toContain('与上方【上单元结尾锚定帧】的衔接');
    expect(out).toContain('与上方【本单元结尾锚定帧】的衔接');
    // 防回归：确保不再以填空 / 详细描述形式重复声明锚定帧内容
    expect(out).not.toContain('人数 / 站位 / 朝向 / 视线 / 持物 / 光线零偏差');
    expect(out).not.toContain('人数 / 站位 / 朝向 / 视线 / 持物 / 光线 / 比例的稳定收束态');
  });
});

describe('e2e: 用户选了 grid 但还没生成图，整链路必须回到无锚点模式', () => {
  it('imageMode=grid-4 + 无 anchor 图 → bundle.hasGridAnchor=false，shotsSection 走 normal', () => {
    // 没有真实生成图时，不能只凭 imageMode 输出 4 镜头宫格结构，
    // 否则模型会写出不存在的 @grid_anchor / cell 对应关系。
    const emptyBundle: ShotReferenceBundle = {
      items: [],
      hasGridAnchor: false,
      hasShotImage: false,
      capacity: { maxRefs: 6, truncatedCount: 0, truncatedKinds: [] },
    };
    // 模拟 ShotPromptService 里的派生逻辑
    const shotImageMode: 'grid-4' | 'grid-9' | 'normal' = 'grid-4';
    const explicitCellCount: 4 | 9 | undefined =
      shotImageMode === 'grid-4' ? 4
      : (shotImageMode === 'grid-9') ? 9
      : undefined;
    const mode = decideShotsMode(emptyBundle, explicitCellCount);
    expect(mode).toBe('normal');

    const section = renderShotsSection({ mode, duration: 6 });
    expect(section).toContain('2-3个镜头时长总和必须精确为6秒');
    expect(section).not.toContain('4 镜头硬切结构');
    expect(section).not.toContain('cell 1');
  });

  it('imageMode=grid-9 + 无 anchor 图 → 仍走 normal，不输出 9 镜头宫格结构', () => {
    const emptyBundle: ShotReferenceBundle = {
      items: [],
      hasGridAnchor: false,
      hasShotImage: false,
      capacity: { maxRefs: 6, truncatedCount: 0, truncatedKinds: [] },
    };
    const mode = decideShotsMode(emptyBundle, 9);
    expect(mode).toBe('normal');
    const section = renderShotsSection({ mode, duration: 9 });
    expect(section).toContain('2-3个镜头时长总和必须精确为9秒');
    expect(section).not.toContain('9 镜头硬切结构');
  });

  it('imageMode=normal → 走 normal 2-3 镜头骨架（不退化）', () => {
    const emptyBundle: ShotReferenceBundle = {
      items: [],
      hasGridAnchor: false,
      hasShotImage: false,
      capacity: { maxRefs: 6, truncatedCount: 0, truncatedKinds: [] },
    };
    const mode = decideShotsMode(emptyBundle, undefined);
    expect(mode).toBe('normal');
    const section = renderShotsSection({ mode, duration: 6 });
    expect(section).toContain('2-3个镜头时长总和必须精确为6秒');
  });
});

describe('renderShotsSection — grid-4', () => {
  it('输出 4 个镜头硬切骨架，每镜头独立成段', () => {
    const out = renderShotsSection({ mode: 'grid-4', duration: 6 });
    expect(out).toContain('4 镜头硬切结构');
    expect(out).toContain('必须输出 4 个镜头');
    expect(out).toContain('镜头 1（');
    expect(out).toContain('镜头 4（');
    expect(out).not.toContain('镜头 5');
  });

  it('每镜头时长 = duration / 4，硬切声明明确', () => {
    const out = renderShotsSection({ mode: 'grid-4', duration: 8 });
    expect(out).toContain('2 秒');
    expect(out).toContain('no dissolves, no cross-fades, use hard cuts only');
    expect(out).toContain('4 镜头总和精确 8 秒');
  });

  it('禁止心理 / 旁白 / 解说被显式写入画面槽位说明', () => {
    const out = renderShotsSection({ mode: 'grid-4', duration: 6 });
    expect(out).toContain('禁止写心理 / 旁白 / 解说');
    expect(out).toContain('最终答案不要输出检查清单或规则复述');
  });
});
