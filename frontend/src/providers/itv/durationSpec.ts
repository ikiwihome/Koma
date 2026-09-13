/**
 * 视频时长规格（VideoDurationSpec）
 *
 * 不同 ITV 渠道对生成视频的"时长"参数支持方式不同：
 *   - 部分模型只接受**枚举**（如 grok-imagine-video：6 / 12 / 16 / 20）
 *   - 部分模型接受**连续范围**（如 Seedance 2.0：4–16s）
 *
 * 历史上整个工程把 grok 风格的 [6,10,12,16,20] 写死在多处：
 *   - utils/videoDuration.ts 的 ALLOWED_VIDEO_DURATIONS
 *   - storyboard/ShotCard.tsx 的 InputNumber min/max
 *   - ShotAnalysisService schema 的 duration 描述
 *   - promptTemplates 里若干模板字面量
 *
 * 这导致切到即梦后输入 5 秒会被强制吸附到 6，且 prompt 里仍写"只能填 6/10/12/16/20"。
 *
 * 这里抽象 VideoDurationSpec 作为运行时配置：
 *   - Provider 注册时声明自己的 spec
 *   - Storyboard / 提示词编译都按当前选择的 ITV channel 解析出 spec 再用
 */

export type VideoDurationSpec =
  | { kind: 'enum'; values: number[]; default: number }
  | { kind: 'range'; min: number; max: number; step: number; default: number };

/**
 * 兜底 spec：保留历史 grok-imagine 风格枚举。
 * 找不到 provider 或 selection 没设时使用。
 */
export const DEFAULT_VIDEO_DURATION_SPEC: VideoDurationSpec = {
  kind: 'enum',
  values: [6, 12, 16, 20],
  default: 6,
};

/**
 * 把任意输入吸附到 spec 允许的最近值。
 * - enum：吸附到最近枚举值（平局取较大）
 * - range：clamp + step 对齐
 * 任何无法解析的输入返回 spec.default。
 */
export function clampDurationToSpec(value: unknown, spec: VideoDurationSpec): number {
  const numeric = coerceFiniteNumber(value);
  if (numeric == null) return spec.default;

  if (spec.kind === 'enum') {
    return spec.values.reduce((nearest, current) => {
      const distNearest = Math.abs(nearest - numeric);
      const distCurrent = Math.abs(current - numeric);
      if (distCurrent < distNearest) return current;
      if (distCurrent === distNearest && current > nearest) return current;
      return nearest;
    }, spec.values[0] ?? spec.default);
  }

  // range
  const { min, max, step } = spec;
  const clamped = Math.min(Math.max(numeric, min), max);
  if (step <= 0) return clamped;
  const stepsFromMin = Math.round((clamped - min) / step);
  const aligned = min + stepsFromMin * step;
  return Math.min(Math.max(aligned, min), max);
}

export function isAllowedDurationForSpec(value: number, spec: VideoDurationSpec): boolean {
  if (!Number.isFinite(value)) return false;
  if (spec.kind === 'enum') return spec.values.includes(value);
  if (value < spec.min || value > spec.max) return false;
  if (spec.step > 0) {
    const offsetSteps = (value - spec.min) / spec.step;
    return Math.abs(offsetSteps - Math.round(offsetSteps)) < 1e-6;
  }
  return true;
}

/**
 * 提供给模板编译时注入的人类可读约束描述。
 * 用于 LLM prompt 里告诉模型"duration 只能填什么"。
 */
export function formatSpecPromptHint(spec: VideoDurationSpec): string {
  if (spec.kind === 'enum') {
    return `只能填写 ${spec.values.join('、')} 之一`;
  }
  const { min, max, step } = spec;
  if (step <= 0 || step === 1) {
    return `必须在 ${min}–${max} 秒范围内（整数）`;
  }
  return `必须在 ${min}–${max} 秒范围内（步长 ${step}）`;
}

/**
 * UI 输入控件需要的 min/max/step bound。
 * enum 时 step 给 1（占位，UI 应优先用 Select 而非 InputNumber），
 * 但如果实在用 InputNumber，会被 clamp 到 enum 区间。
 */
export function specToInputBounds(spec: VideoDurationSpec): { min: number; max: number; step: number } {
  if (spec.kind === 'enum') {
    const values = spec.values.length > 0 ? spec.values : [spec.default];
    return { min: Math.min(...values), max: Math.max(...values), step: 1 };
  }
  return { min: spec.min, max: spec.max, step: spec.step };
}

/**
 * ITV providerType → 时长 spec 映射（兜底层）。
 *
 * 注意：spec 实际上跟"模型"挂钩而非"provider runtime"。例如 Koma 官方的"即梦"渠道
 * 复用 grok2api-imagine-itv runtime 但用 seedance-2.5 模型，上游路由完全不同，
 * 时长能力也不同。所以 lookup 优先走 modelId 命中，再回落到 providerType。
 */
const ITV_DURATION_SPECS_BY_PROVIDER: Record<string, VideoDurationSpec> = {
  // grok-imagine-video：上游仅接受 6/12/16/20
  'grok2api-imagine-itv': { kind: 'enum', values: [6, 12, 16, 20], default: 6 },
  // Koma 官方：上游约束 4-15s 连续
  'koma-suihe-itv': { kind: 'range', min: 4, max: 15, step: 1, default: 5 },
  // 旧的独立 seedance（直连 toapis.com）保留映射，避免回归
  'seedance': { kind: 'range', min: 4, max: 15, step: 1, default: 5 },
};

/**
 * modelId 前缀 → 时长 spec。匹配优先级高于 providerType（按数组顺序首匹配胜出，
 * 所以更具体的前缀必须放在前面）。
 *
 * Seedance 上游约束（Koma 即梦网关 normalizeDuration 行为）：
 *   - seedance-2.5-r / seedance-2.5-f / seedance-2.5: 4-15s
 *
 * Koma 官方激活默认采用 `-r` / `-f` 短后缀；旧 ID `seedance-2.5`
 * 仍保留命中以避免老激活配置回归到 grok 兜底枚举。
 */
const ITV_DURATION_SPECS_BY_MODEL_PREFIX: Array<{ prefix: string; spec: VideoDurationSpec }> = [
  { prefix: 'seedance-2.5-f', spec: { kind: 'range', min: 4, max: 15, step: 1, default: 5 } },
  { prefix: 'seedance', spec: { kind: 'range', min: 4, max: 15, step: 1, default: 5 } },
];

export function getDurationSpecForProviderType(providerType: string | undefined): VideoDurationSpec {
  if (!providerType) return DEFAULT_VIDEO_DURATION_SPEC;
  return ITV_DURATION_SPECS_BY_PROVIDER[providerType] ?? DEFAULT_VIDEO_DURATION_SPEC;
}

export function getDurationSpecForModel(modelId: string | undefined): VideoDurationSpec | undefined {
  if (!modelId) return undefined;
  const matched = ITV_DURATION_SPECS_BY_MODEL_PREFIX.find((entry) => modelId.startsWith(entry.prefix));
  return matched?.spec;
}

interface ChannelLookupModel {
  id: string;
  providerModelName?: string;
  defaults?: Record<string, unknown>;
}

interface ChannelLookupEntry {
  id: string;
  providerType: string;
  models?: ReadonlyArray<ChannelLookupModel>;
}

function readNumericField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readNumericArrayField(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const item of value) {
    const n = readNumericField(item);
    if (n != null) out.push(n);
  }
  return out.length ? out : undefined;
}

/**
 * 把模型 defaults 上的用户配置（durationMin/Max/Step/Values/Default）转成 VideoDurationSpec。
 * 优先识别 enum（durationValues），其次 range（durationMin + durationMax）。
 * 不合法或不完整时返回 undefined。
 */
export function buildDurationSpecFromModelDefaults(
  defaults: Record<string, unknown> | undefined | null,
): VideoDurationSpec | undefined {
  if (!defaults) return undefined;

  const enumValues = readNumericArrayField(defaults.durationValues);
  const explicitDefault = readNumericField(defaults.defaultDuration ?? defaults.durationDefault);

  if (enumValues && enumValues.length > 0) {
    const sorted = [...new Set(enumValues)].sort((a, b) => a - b);
    return {
      kind: 'enum',
      values: sorted,
      default: explicitDefault != null && sorted.includes(explicitDefault)
        ? explicitDefault
        : sorted[0],
    };
  }

  const min = readNumericField(defaults.durationMin);
  const max = readNumericField(defaults.durationMax);
  if (min != null && max != null && max >= min) {
    const step = readNumericField(defaults.durationStep);
    const safeStep = step && step > 0 ? step : 1;
    const fallbackDefault = explicitDefault != null
      ? Math.min(Math.max(explicitDefault, min), max)
      : Math.min(Math.max(5, min), max);
    return {
      kind: 'range',
      min: Math.max(1, Math.floor(min)),
      max: Math.max(1, Math.floor(max)),
      step: safeStep,
      default: fallbackDefault,
    };
  }

  return undefined;
}

/**
 * 通过 itv selection key（"channelId::modelId"）+ 当前 ITV channel 列表反查 spec。
 * 优先级：模型 defaults 显式配置 > modelId 前缀 > providerType > DEFAULT。
 * 调用方负责异步拿到 channels；这里是同步纯函数便于 React 渲染。
 */
export function getDurationSpecForITVSelection(
  selectionKey: string | undefined | null,
  channels: ReadonlyArray<ChannelLookupEntry>,
): VideoDurationSpec {
  if (!selectionKey) return DEFAULT_VIDEO_DURATION_SPEC;
  const sepIndex = selectionKey.indexOf('::');
  const channelId = sepIndex > 0 ? selectionKey.slice(0, sepIndex) : selectionKey;
  const modelId = sepIndex > 0 ? selectionKey.slice(sepIndex + 2) : undefined;

  const channel = channels.find((c) => c.id === channelId);
  const model = modelId
    ? channel?.models?.find((m) => m.id === modelId || m.providerModelName === modelId)
    : undefined;
  const fromModelDefaults = buildDurationSpecFromModelDefaults(model?.defaults);
  if (fromModelDefaults) return fromModelDefaults;

  const byModel = getDurationSpecForModel(modelId);
  if (byModel) return byModel;

  return getDurationSpecForProviderType(channel?.providerType);
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const direct = Number(trimmed);
    if (Number.isFinite(direct)) return direct;
    const matched = trimmed.match(/[-+]?\d+(?:\.\d+)?/)?.[0];
    if (matched) {
      const n = Number(matched);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}
