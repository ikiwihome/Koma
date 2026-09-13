import type { MediaAssetSource, ProviderAssetInput } from '../../types';
import type { PromptCompilationReferenceItem, PromptCompilationReferenceKind } from './types';

/**
 * 每种媒体类型的引用上限：image 不限；video / audio 各 3 个，超出的引用回退到 name。
 * 上限按 provider 实际可消费的 reference 数量定（视频/音频接受多源的 provider 罕见）。
 */
const KIND_CAPS: Record<PromptCompilationReferenceKind, number | undefined> = {
  image: undefined,
  video: 3,
  audio: 3,
};

const KIND_LABEL: Record<PromptCompilationReferenceKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
};

/**
 * Koma 即梦协议下的占位符 label：
 *   image → image_file（最终成 @image_file_N）
 *   video → video_file
 *   audio → audio_file
 * 与上游 multipart 字段名一一对应。
 */
const KOMA_JIMENG_KIND_LABEL: Record<PromptCompilationReferenceKind, string> = {
  image: 'image_file',
  video: 'video_file',
  audio: 'audio_file',
};

export interface ParsedPromptReference {
  id: string;
  fullMatch: string;
  from: number;
  to: number;
}

export interface CompilePromptReferencesResult {
  compiledPrompt: string;
  /** 扁平的全能参考数组，沿用历史字段。按推入顺序排（primary → extras → 被 @ 的 refs） */
  compiledReferences: Array<MediaAssetSource | ProviderAssetInput>;
  /**
   * 按 kind 拆分的引用 URL 数组。供 Koma 即梦渠道作为 metadata.image_urls /
   * video_urls / audio_urls 单独透传给上游，让网关分别落到 image_file_N /
   * video_file_N / audio_file_N 字段。
   * 仅识别 string / ProviderAssetInput.value 形态的远程 URL，非字符串源跳过。
   */
  compiledByKind: {
    image: string[];
    video: string[];
    audio: string[];
  };
  unresolvedMentions: string[];
}

export const PROMPT_REFERENCE_REGEX = /@ref_([a-zA-Z0-9_-]+)/g;

export function parsePromptReferences(text: string): ParsedPromptReference[] {
  const refs: ParsedPromptReference[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(PROMPT_REFERENCE_REGEX.source, 'g');

  while ((match = regex.exec(text)) !== null) {
    refs.push({
      id: match[1],
      fullMatch: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }

  return refs;
}

function buildRefKey(ref: MediaAssetSource | ProviderAssetInput): string {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && 'transport' in ref && 'value' in ref) {
    return `${ref.transport}:${ref.value}`;
  }

  const anyRef = ref as unknown as Record<string, unknown> | undefined;
  const remoteUrl = typeof anyRef?.remoteUrl === 'string' ? anyRef.remoteUrl : '';
  const localPath = typeof anyRef?.localPath === 'string' ? anyRef.localPath : '';
  return remoteUrl || localPath || JSON.stringify(ref);
}

interface OrderedVisualReference {
  key: string;
  source: MediaAssetSource | ProviderAssetInput;
}

/**
 * 提示词引用编译。把 prompt 里的 @ref_xxx 替换为：
 *   - image-index 策略：按 kind 分组 @Image N / @Video N / @Audio N（video / audio 上限 3，超出回退到 name）
 *   - koma-jimeng-file 策略：按 kind 分组 @image_file_N / @video_file_N / @audio_file_N，
 *     与 Koma 即梦上游 multipart 字段（image_file_N / video_file_N / audio_file_N）一一对应。
 *   - readable-name 策略：替换为 item.name
 *
 * 智能裁剪：只把 prompt 里实际 @ 到的 reference 推进编号桶 + compiledReferences；
 * 未 @ 的 references 不上传也不占用编号槽。primary + extraReferences 是显式槽位
 * （由调用方塞入），永远参与。
 *
 * compiledReferences 是「全能参考」扁平数组（沿用历史字段）；compiledByKind 是按 kind
 * 拆分的 URL 数组，供 Koma 即梦渠道直接拆到 metadata 上不同字段，让网关分别落到
 * image_file_N / video_file_N / audio_file_N。
 */
export function compilePromptReferences(params: {
  prompt: string;
  references: PromptCompilationReferenceItem[];
  extraReferences?: Array<MediaAssetSource | ProviderAssetInput>;
  replacementStrategy: 'image-index' | 'readable-name' | 'koma-jimeng-file';
  primaryReferenceId?: string;
  ensurePrimaryReference?: boolean;
}): CompilePromptReferencesResult {
  const {
    prompt,
    references,
    extraReferences = [],
    replacementStrategy,
    primaryReferenceId,
    ensurePrimaryReference = false,
  } = params;

  const parsedRefs = parsePromptReferences(prompt);
  const refMap = new Map(references.map(item => [item.id, item]));
  const unresolvedMentions: string[] = [];
  let compiledPrompt = prompt;

  // 只 @-mentioned 的 references 才参与编号 + 入数组。否则上游一连 4 张图、用户只 @ 了一张，
  // 也会被串成 @Image 1..4，让被 @ 的那张拿到 @Image 4。
  // primary + extras 是显式槽位（外层调用方塞的），永远在；其它走"按需"。
  const mentionedRefIds = new Set<string>();
  for (const parsed of parsedRefs) {
    if (refMap.has(parsed.id)) mentionedRefIds.add(parsed.id);
  }

  const primaryReference = primaryReferenceId ? refMap.get(primaryReferenceId) : undefined;
  const primarySourceKey = primaryReference?.source ? buildRefKey(primaryReference.source) : null;

  /**
   * 把 references 按 kind 分桶 + 顺序保留（primary 优先 → extra → references）。
   * 每桶按 KIND_CAPS 截断（image 不限；video / audio 各 3 个）。
   * compiledReferences 是扁平的 image/video/audio 混排数组（全能参考通道），
   * indexByKind 保存 sourceKey → 本桶内编号，用于生成 @Image N / @Video N / @Audio N。
   */
  const orderedVisualRefs: OrderedVisualReference[] = [];
  const orderedVisualKeys = new Set<string>();
  const indexByKind: Record<PromptCompilationReferenceKind, Map<string, number>> = {
    image: new Map(),
    video: new Map(),
    audio: new Map(),
  };
  const counterByKind: Record<PromptCompilationReferenceKind, number> = { image: 0, video: 0, audio: 0 };

  const pushRefByKind = (kind: PromptCompilationReferenceKind, source?: MediaAssetSource | ProviderAssetInput) => {
    if (!source) return;
    const key = buildRefKey(source);
    if (indexByKind[kind].has(key)) return; // 同 kind 同 source 已编号 → 跳过
    const cap = KIND_CAPS[kind];
    if (cap !== undefined && counterByKind[kind] >= cap) return; // 桶已满
    counterByKind[kind] += 1;
    indexByKind[kind].set(key, counterByKind[kind]);
    // 全能参考通道：image / video / audio 一视同仁，按推入顺序进 compiledReferences。
    // 同一 source 跨 kind 复用时也只入一次（key 去重）。
    if (!orderedVisualKeys.has(key)) {
      orderedVisualKeys.add(key);
      orderedVisualRefs.push({ key, source });
    }
  };

  // 优先级 1：primary 引用（一定占位 @Image 1 / @Video 1 / @Audio 1，按其 kind）
  if (primaryReference?.source) {
    pushRefByKind(primaryReference.kind ?? 'image', primaryReference.source);
  }

  // 优先级 2：extraReferences 视为 image 类型
  for (const ref of extraReferences) {
    pushRefByKind('image', ref);
  }

  // 优先级 3：仅 prompt 里 @ 到的 references（按声明顺序）。
  // 未 @ 的不进编号桶、也不进 compiledReferences —— 智能裁剪，避免一张被引用的图被
  // 串到 @Image 4，也避免无关上游资源占用 provider 的引用槽位。
  for (const item of references) {
    if (!mentionedRefIds.has(item.id)) continue;
    if (item.source) {
      pushRefByKind(item.kind ?? 'image', item.source);
    }
  }

  const replacements = parsedRefs.map(parsed => {
    const item = refMap.get(parsed.id);
    if (!item) {
      unresolvedMentions.push(parsed.fullMatch);
      return null;
    }

    if (item.source) {
      const kind = item.kind ?? 'image';
      const sourceKey = buildRefKey(item.source);

      if (replacementStrategy === 'image-index') {
        const index = indexByKind[kind].get(sourceKey);
        if (index != null) {
          return { ...parsed, replacement: `@${KIND_LABEL[kind]} ${index}` };
        }
        // 该 kind 超出上限 / 没占到编号 → 回退到 readable name
      }

      if (replacementStrategy === 'koma-jimeng-file') {
        const index = indexByKind[kind].get(sourceKey);
        if (index != null) {
          return { ...parsed, replacement: `@${KOMA_JIMENG_KIND_LABEL[kind]}_${index}` };
        }
      }

      return { ...parsed, replacement: item.name };
    }

    return {
      ...parsed,
      replacement: item.textValue || item.name,
    };
  }).filter(Boolean) as Array<ParsedPromptReference & { replacement: string }>;

  const sorted = [...replacements].sort((left, right) => right.from - left.from);
  for (const item of sorted) {
    compiledPrompt = compiledPrompt.slice(0, item.from) + item.replacement + compiledPrompt.slice(item.to);
  }

  void ensurePrimaryReference;

  // compiledReferences = image + video + audio 扁平混排，primary 单独剔除（外层会把它
  // 塞进 primaryImage / 首位 referenceImages 等专用槽位，避免重复进 additionalReferences）。
  const compiledReferences = orderedVisualRefs
    .filter(item => item.key !== primarySourceKey)
    .map(item => item.source);

  // 按 kind 提取 URL 字符串供 Koma 即梦协议 metadata 透传。primary 同样剔除（外层另塞）。
  // 来源类型：string（直接 URL）/ ProviderAssetInput.transport=remote-url（取 value）；
  // 其它形态（data-url / koma-local / StoredMediaAsset）跳过 —— Koma 即梦上游网关只下载 http(s)。
  const extractRemoteUrl = (src: MediaAssetSource | ProviderAssetInput): string | null => {
    if (typeof src === 'string') {
      return src.startsWith('http://') || src.startsWith('https://') ? src : null;
    }
    if (src && typeof src === 'object' && 'transport' in src && 'value' in src) {
      const value = String(src.value || '');
      if (src.transport === 'remote-url' && (value.startsWith('http://') || value.startsWith('https://'))) {
        return value;
      }
      return null;
    }
    const anyRef = src as unknown as Record<string, unknown> | undefined;
    const remoteUrl = typeof anyRef?.remoteUrl === 'string' ? anyRef.remoteUrl : '';
    return remoteUrl.startsWith('http') ? remoteUrl : null;
  };
  const compiledByKind = { image: [] as string[], video: [] as string[], audio: [] as string[] };
  // 按各 kind 的 indexByKind 编号顺序填充 URL：(key → index) 反向排序 → URL 数组
  (Object.keys(indexByKind) as PromptCompilationReferenceKind[]).forEach(kind => {
    const entries = Array.from(indexByKind[kind].entries()).sort((a, b) => a[1] - b[1]);
    for (const [key] of entries) {
      if (key === primarySourceKey) continue;
      const ref = orderedVisualRefs.find(item => item.key === key);
      const url = ref ? extractRemoteUrl(ref.source) : null;
      if (url) compiledByKind[kind].push(url);
    }
  });

  return {
    compiledPrompt,
    compiledReferences,
    compiledByKind,
    unresolvedMentions,
  };
}
