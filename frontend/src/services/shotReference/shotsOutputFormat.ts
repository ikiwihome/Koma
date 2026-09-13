/**
 * 视频提示词模板"## 六、最终标准输出格式"中【分镜镜头内容】子段的渲染器。
 *
 * 不同 imageMode 决定输出结构：
 *   - 'normal' / 默认：2-3 镜头硬切骨架（4 个时长各自的预算文本沿用历史）
 *   - 'grid-9'：3×3 九宫格 9 帧时序锚点骨架（单镜头连续延展，固定机位）
 *   - 'grid-4'：2×2 四宫格 4 帧时序锚点骨架（单镜头连续延展，更细粒度的镜头控制）
 *
 * 渲染器跟模板的"## 六"上文（场景行 / 锁定段 / 上下单元衔接段）解耦——这一层
 * 只产出"分镜镜头内容"这一个子段。模板把这段抽成 `{{shotsSection}}` 占位。
 */
import type { ShotReferenceBundle } from './types';

export type ShotsOutputMode = 'normal' | 'grid-9' | 'grid-4';

export interface ShotsSectionParams {
  mode: ShotsOutputMode;
  /** 视频总时长（秒） */
  duration: number;
}

export function renderShotsSection(params: ShotsSectionParams): string {
  if (params.mode === 'grid-9') return renderGrid9ShotsSection(params.duration);
  if (params.mode === 'grid-4') return renderGrid4ShotsSection(params.duration);
  return renderNormalShotsSection(params.duration);
}

/**
 * 决定 shots 段渲染模式。
 *
 * grid-4 / grid-9 只有在 bundle 里确实存在 grid-anchor 图片时才启用。`imageMode`
 * 只是图片生成意图，不能在无真实分镜图时让视频提示词内置 `@grid_anchor`
 * 或宫格 cell 结构；否则会让下游进入一个不存在的图片锚点协议。
 */
export function decideShotsMode(bundle: ShotReferenceBundle, explicitCellCount?: 4 | 9): ShotsOutputMode {
  if (!bundle.hasGridAnchor) {
    return 'normal';
  }
  if (explicitCellCount === 4) return 'grid-4';
  if (explicitCellCount === 9) return 'grid-9';
  return (bundle.gridCellCount ?? 9) === 4 ? 'grid-4' : 'grid-9';
}

// ──────────────────────────────────────────────────────────────────
// normal 多镜头骨架（沿用历史模板正文）
// ──────────────────────────────────────────────────────────────────

const NORMAL_DURATION_BUDGET: Record<number, string> = {
  6: '（2-3个镜头时长总和必须精确为6秒，每个镜头2-3秒，每个镜头都必须完整填写对应核心要素，且所有元素在全文中每次出现都必须独立标注映射）',
  10: '（2-3个镜头时长总和必须精确为10秒；2镜头方案单镜头4-6秒，3镜头方案单镜头3-4秒；每个镜头都必须完整填写对应核心要素，且所有元素在全文中每次出现都必须独立标注映射）',
  15: '（2-3个镜头时长总和必须精确为15秒；2镜头方案单镜头7-8秒，3镜头方案单镜头4-6秒；每个镜头都必须完整填写对应核心要素，且所有元素在全文中每次出现都必须独立标注映射）',
  20: '（2-3个镜头时长总和必须精确为20秒；2镜头方案单镜头9-11秒，3镜头方案单镜头6-8秒；每个镜头都必须完整填写对应核心要素，且所有元素在全文中每次出现都必须独立标注映射）',
};

function renderNormalShotsSection(duration: number): string {
  const budget = NORMAL_DURATION_BUDGET[duration]
    ?? `（2-3个镜头时长总和必须精确为${duration}秒，每个镜头都必须完整填写对应核心要素，且所有元素在全文中每次出现都必须独立标注映射）`;
  const shotTemplate = (idx: number, opening: boolean, optional: boolean): string => {
    const header = optional
      ? `# 可选镜头${idx}（仅${idx === 2 ? '2' : '3'}镜头方案启用${idx === 2 ? '，3镜头方案删除本段' : '，2镜头方案删除本段'}）\n`
      : '';
    const anchorClause = opening
      ? '首个镜头开场画面必须严格继承上方【上单元结尾锚定帧】描述（仅做继承断言，不要在此重复描述上单元末态内容）；'
      : '';
    return `${header}镜头${idx}：【镜头名称+运镜方式+构图方式】【时长】秒，【景别】，【光线】。双合规性声明：①机位合规性声明：本镜头使用XX机位，人物视线落点为XX，不存在直面镜头风险，符合机位规则；②对话交互合规性声明：本镜头中XX与XX保持面对面相向交流，视线精准匹配，不存在对空气说话问题，符合对话规则。人物与场景比例合规性声明：本镜头内人物与场景、道具之间的相对比例符合现实标准，与基准映射库一致，无比例失真。运镜轨迹：完整描述运镜，核心跟随主体必须带映射；如无运镜则删除本句。镜头画面完整描述：严格依据输入文案书写，所有人物、场景、物品每一次出现都必须单独标注映射；每个人物写清主动作、微动作、重心/接触点、眉眼/嘴角/肩颈/手指等表情与可见情绪外化，动作幅度克制且与台词节拍同步；明确物理反馈、视线落点与对话朝向；${anchorClause}如有台词则写\`角色标准名称  X对角色标准名称  X台词：『完整台词原文』\`。音画同步深度融合指令：写明台词起止时间、语速、声线、语气和可见情绪外化，要求先语音、后口型/表情/动作/运镜，逐字同步；无台词则删除本句。动作捕捉驱动指令：写明动作与语音同步捕捉、表情肌微动和帧级对齐，对应角色必须带映射。镜头衔接锚点：${idx === 3 ? '本镜头末态即上方【本单元结尾锚定帧】（仅做收束断言，不要在此重复描述末态内容），' : '描述切镜锚点，并明确与下一镜头之间仅允许原生画面硬切，禁止叠化；'}no dissolves, no cross-fades, use hard cuts only。镜头位置与运动：机位与运镜说明，所属场景标准名称  X，与上下单元基准一致`;
  };
  return [
    '【分镜镜头内容】',
    shotTemplate(1, true, false),
    '',
    shotTemplate(2, false, true),
    '',
    shotTemplate(3, false, true),
    '',
    budget,
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────
// grid-9：3×3 九宫格 9 帧时序锚点骨架
// ──────────────────────────────────────────────────────────────────

interface CellSpec {
  cell: number;
  label: string;
  /** 0-1 范围内的相对时间位置，乘以 duration 得到秒数 */
  ratio: number;
  role: string;
}

const GRID9_CELLS: CellSpec[] = [
  { cell: 1, label: '左上', ratio: 0, role: '起手 / 定场' },
  { cell: 2, label: '中上', ratio: 0, role: '第 1 拍递进' },
  { cell: 3, label: '右上', ratio: 0, role: '约 1/3 节奏切换' },
  { cell: 4, label: '左中', ratio: 0, role: '第 2 拍递进' },
  { cell: 5, label: '正中', ratio: 0, role: '中段关键节奏' },
  { cell: 6, label: '右中', ratio: 0, role: '约 2/3 节奏切换' },
  { cell: 7, label: '左下', ratio: 0, role: '第 3 拍递进' },
  { cell: 8, label: '中下', ratio: 0, role: '收势前' },
  { cell: 9, label: '右下', ratio: 0, role: '收束 / 末态' },
];

const GRID4_CELLS: CellSpec[] = [
  { cell: 1, label: '左上', ratio: 0, role: '起手 / 定场' },
  { cell: 2, label: '右上', ratio: 0, role: '前段节奏切换' },
  { cell: 3, label: '左下', ratio: 0, role: '后段节奏切换' },
  { cell: 4, label: '右下', ratio: 0, role: '收束 / 末态' },
];

function fmtSeconds(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.05) return `${Math.round(value)}`;
  return value.toFixed(2);
}

/**
 * grid 模式 = N 镜头硬切结构。每镜头对应网格中的一个单元格（按位置：左→右、上→下）。
 * 不再走"单镜头连续延展"——用户的心智模型是：grid cell 数 = 镜头数，且镜头之间是硬切。
 */
function renderGridShotsSection(cells: CellSpec[], duration: number, label: string): string {
  const N = cells.length;
  const shotDuration = duration / N;
  const shotDurationStr = fmtSeconds(shotDuration);
  const lines: string[] = [];

  lines.push(`【分镜镜头内容·${N} 镜头硬切结构】`);
  lines.push('');
  lines.push(`【硬性规则】`);
  lines.push(`1. **必须输出 ${N} 个镜头**：编号从"镜头 1"到"镜头 ${N}"，**每一个都必须独立成段填写完整内容**。**禁止合并、禁止省略、禁止只写其中几个**。少 1 个或多 1 个都判废。`);
  lines.push(`2. 每镜头依次对应 references 中 ${label} 的一个单元格（按位置：左→右、上→下；cell 1 = 首镜，cell ${N} = 末镜）。`);
  lines.push(`3. 每镜头时长 ≈ **${shotDurationStr} 秒**；${N} 镜头总和精确 ${duration} 秒（±0.2 秒）。`);
  lines.push(`4. 镜头之间是原生硬切：\`原生画面硬切；no dissolves, no cross-fades, use hard cuts only\`。`);
  lines.push(`5. 同一人物外观 / 服装 / 持物 / 比例 / 空间位置跨镜头**完全一致**，仅允许动作 / 视线 / 景别 / 机位变化（用自然位置描述即可，不必硬编序号）。`);
  lines.push(`6. 单句台词必须在单镜头内说完（按 3.2 字/秒），不得跨镜头拆分。`);
  lines.push('');
  lines.push(`【输出骨架】（每个 \`镜头 N：\` 都必须独立成段，按下方模板填写）`);
  lines.push('');

  for (const spec of cells) {
    const isFirst = spec.cell === 1;
    const isLast = spec.cell === N;
    const headerLine = `镜头 ${spec.cell}（${shotDurationStr} 秒，对应 ${label} ${spec.label} = cell ${spec.cell}，${spec.role}）：`;
    lines.push(headerLine);
    lines.push(`- 景别 + 机位：__（按节奏选；机位优先 30°-60° 侧拍 / 过肩 OTS / 侧后跟拍）__`);
    lines.push(`- 画面（仅写客观可见画面，禁止写心理 / 旁白 / 解说）：__基于 cell ${spec.cell} 的视觉锚点；人物姿态 + 大致空间位置（自然描述，例如"靠窗床边"，不强制硬编号）+ 上下层级（如有）+ 视线方向 + 持物 + 主动作 + 微动作 + 表情变化 / 可见情绪外化（眉眼、嘴角、肩颈、呼吸、手指、重心）；所有元素带 \`@Image N\` 映射__`);
    if (isFirst) {
      lines.push(`- 与上方【上单元结尾锚定帧】的衔接：开场画面 100% 继承（仅断言继承，不要在此重复描述上单元末态内容）`);
    }
    lines.push(`- 台词（仅当原文明示该镜头有人物开口说话时填）：\`角色 @Image X 对 角色 @Image Y 台词：『完整原文』\`；否则写"无"`);
    lines.push(`- OS/OV（仅当原文明示心理独白 / 画外音时填）：\`【对应角色】OS：『完整原文』；播报全程对应人物嘴巴闭合\`；否则写"无"`);
    if (isLast) {
      lines.push(`- 与上方【本单元结尾锚定帧】的衔接：本镜头收束态即【本单元结尾锚定帧】（仅断言一致，不要在此重复描述末态内容）`);
    } else {
      lines.push(`- 硬切到镜头 ${spec.cell + 1}：\`no dissolves, no cross-fades, use hard cuts only\``);
    }
    lines.push('');
  }

  lines.push(`【结构约束】镜头编号必须从 1 到 ${N} 全齐；每镜头时长之和 = ${duration} 秒；人物镜头必须含主动作 + 微动作 + 表情 / 可见情绪外化；最终答案不要输出检查清单或规则复述。`);
  return lines.join('\n');
}

function renderGrid9ShotsSection(duration: number): string {
  return renderGridShotsSection(GRID9_CELLS, duration, '3×3 九宫格');
}

function renderGrid4ShotsSection(duration: number): string {
  return renderGridShotsSection(GRID4_CELLS, duration, '2×2 四宫格');
}
