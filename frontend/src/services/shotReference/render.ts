/**
 * ShotReferenceBundle 的提示词模板渲染器。
 *
 * 输出 `{{referenceTable}}` 与 `{{gridSequenceNotice}}` 两个模板变量，让生图和
 * 生视频模板按位置严格引用 references[N]。
 */
import type { ShotReferenceBundle, ShotReferenceItem } from './types';

/**
 * 渲染 references 索引表。LLM 看到这张表后，应在提示词中用 `@Image N` 严格引用对应位置。
 * N 从 1 开始（对应 references[N-1]），跟 grok-image-index 协议一致。
 */
export function renderShotReferenceTable(bundle: ShotReferenceBundle): string {
  if (bundle.items.length === 0) {
    return '本镜头无任何视觉参考——纯文字推理生图 / 生视频；不要使用 @shot_anchor / @grid_anchor。';
  }

  const lines: string[] = [];
  lines.push('## 视觉参考集合（references 数组按位置严格对应 @Image N）');
  bundle.items.forEach((item, idx) => {
    const imageNumber = idx + 1;
    lines.push(`- references[${idx}] / @Image ${imageNumber}：${item.label}`);
  });
  if (!bundle.hasShotImage) {
    lines.push('- 本集合不含真实分镜锚定图 / 宫格锚定图 / 故事板锚定图；不要使用 @shot_anchor / @grid_anchor / @storyboard_anchor。');
  }
  lines.push('');
  lines.push('正文中所有视觉描述必须使用 `@Image N` 引用上面对应位置的参考图。同一元素每次出现都必须重复标注，不允许写"如前所述"或省略。');

  if (bundle.capacity.truncatedCount > 0) {
    lines.push('');
    lines.push(
      `> 备注：本场景另有 ${bundle.capacity.truncatedCount} 项次要资产因模型引用图配额已被裁掉，不在本表内；`
      + '提示词不应引用未列出的位置。',
    );
  }

  return lines.join('\n');
}

/**
 * 渲染给“可编辑提示词推理阶段”看的语义引用表。
 *
 * 这里刻意不暴露 `@Image N` / `references[N]`，因为它们只属于最终 provider
 * 请求编译后的传输协议。LLM 生成并保存到本地的提示词必须保持语义 mention：
 * `@char_<id>` / `@scene_<id>` / `@prop_<id>` / `@storyboard_anchor` 等。
 */
export function renderShotMentionReferenceTable(bundle: ShotReferenceBundle): string {
  if (bundle.items.length === 0) {
    return '本镜头无任何视觉参考——纯文字推理生图；不要使用 @shot_anchor / @grid_anchor / @storyboard_anchor / @previous_storyboard_anchor，也不要输出 @Image N / @图片N。';
  }

  const lines: string[] = [];
  lines.push('## 视觉参考集合（仅使用语义 mention，禁止输出 @Image N / @图片N）');
  bundle.items.forEach((item) => {
    lines.push(`- ${item.mentionToken} ${item.label}`);
  });
  if (!bundle.hasShotImage) {
    lines.push('- 本集合不含真实分镜锚定图 / 宫格锚定图 / 故事板锚定图；不要使用 @shot_anchor / @grid_anchor / @storyboard_anchor。');
  }
  lines.push('');
  lines.push('正文中所有视觉引用都必须使用上方语义 mention。`@Image N` / `@图片N` 只允许在最终请求编译之后出现，严禁写入当前可编辑提示词。');

  if (bundle.capacity.truncatedCount > 0) {
    lines.push('');
    lines.push(
      `> 备注：本场景另有 ${bundle.capacity.truncatedCount} 项次要资产因模型引用图配额已被裁掉，不在本表内；`
      + '提示词不应引用未列出的视觉参考。',
    );
  }

  return lines.join('\n');
}

/**
 * 仅当 bundle 含 grid-anchor 时输出。说明 references[N] 的网格语义和帧时序。
 *  - bundle.gridCellCount === 9 → 3×3 九宫格说明
 *  - bundle.gridCellCount === 4 → 2×2 四宫格说明
 * 不含 grid-anchor 时返回空串，模板替换后无任何额外内容。
 */
export function renderGridSequenceNotice(bundle: ShotReferenceBundle): string {
  if (!bundle.hasGridAnchor) return '';

  const gridIdx = bundle.items.findIndex(item => item.kind === 'grid-anchor');
  const gridImageNumber = gridIdx >= 0 ? gridIdx + 1 : 1;
  const cellCount = bundle.gridCellCount ?? 9;

  if (cellCount === 4) {
    return [
      '## 四宫格锚点专属说明',
      `references[${gridIdx}] / @Image ${gridImageNumber} 是一张 2×2 四宫格图，编码了本分镜的 **4 个镜头视觉锚点**，读取顺序为**左→右、上→下**：`,
      '',
      '| 位置 | 单元格 | 对应镜头 |',
      '|---|---|---|',
      '| 左上 | 1 | 镜头 1：起手 / 定场 |',
      '| 右上 | 2 | 镜头 2：前段节奏切换 |',
      '| 左下 | 3 | 镜头 3：后段节奏切换 |',
      '| 右下 | 4 | 镜头 4：收束 / 末态 |',
      '',
      '本视频严格 **4 个镜头硬切结构**——每个镜头对应网格中的一个单元格，**不能少、不能多**。镜头之间是原生硬切（no dissolves, no cross-fades）。同一人物外观 / 服装 / 持物 / 比例跨镜头完全一致，仅允许动作 / 视线 / 景别 / 机位变化。其它 references 提供的角色 / 场景 / 道具图用于外观锚定。',
    ].join('\n');
  }

  // 默认 9 cell（grid-9 / 老 'grid' 兼容）
  return [
    '## 九宫格锚点专属说明',
    `references[${gridIdx}] / @Image ${gridImageNumber} 是一张 3×3 九宫格图，编码了本分镜的 **9 个镜头视觉锚点**，读取顺序为**左→右、上→下**：`,
    '',
    '| 位置 | 单元格 | 对应镜头 |',
    '|---|---|---|',
    '| 左上 | 1 | 镜头 1：起手 / 定场 |',
    '| 中上 | 2 | 镜头 2：第 1 拍递进 |',
    '| 右上 | 3 | 镜头 3：约 1/3 节奏切换 |',
    '| 左中 | 4 | 镜头 4：第 2 拍递进 |',
    '| 正中 | 5 | 镜头 5：中段关键节奏 |',
    '| 右中 | 6 | 镜头 6：约 2/3 节奏切换 |',
    '| 左下 | 7 | 镜头 7：第 3 拍递进 |',
    '| 中下 | 8 | 镜头 8：收势前 |',
    '| 右下 | 9 | 镜头 9：收束 / 末态 |',
    '',
    '本视频严格 **9 个镜头硬切结构**——每个镜头对应网格中的一个单元格，**不能少、不能多**。镜头之间是原生硬切（no dissolves, no cross-fades）。同一人物外观 / 服装 / 持物 / 比例跨镜头完全一致，仅允许动作 / 视线 / 景别 / 机位变化。其它 references 提供的角色 / 场景 / 道具图用于外观锚定。',
  ].join('\n');
}

/**
 * 用于诊断日志：把 bundle 转为简短摘要字符串，避免日志炸开。
 */
export function summarizeBundle(bundle: ShotReferenceBundle): string {
  if (bundle.items.length === 0) return '(empty)';
  const head = bundle.items
    .map((item, idx) => `[${idx}]${item.kind}:${truncate(item.label, 12)}`)
    .join('|');
  return bundle.capacity.truncatedCount > 0
    ? `${head}|+${bundle.capacity.truncatedCount} truncated`
    : head;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

// 类型重导出方便调用方
export type { ShotReferenceBundle, ShotReferenceItem };
