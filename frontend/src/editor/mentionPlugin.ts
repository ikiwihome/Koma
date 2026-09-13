/**
 * CodeMirror Mention 装饰器插件
 * 将 @type_id 格式的文本替换为可读的名称标签
 * 支持原子删除（整体删除 mention）
 */
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { RangeSetBuilder, EditorSelection } from '@codemirror/state';
import type { MentionItem, MentionType } from './mentionTypes';
import { parseMentions } from './mentionTypes';

// Mention 数据解析器类型
export type MentionResolver = (type: MentionType, id: string) => MentionItem | undefined;

// Mention 点击回调
export type MentionClickHandler = (mention: MentionItem) => void;

/**
 * Mention Widget - 显示为可点击的标签
 */
class MentionWidget extends WidgetType {
  constructor(
    readonly mention: MentionItem,
    readonly onClick?: MentionClickHandler
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `mention-widget mention-${this.mention.type}`;
    span.textContent = `@${this.mention.name}`;

    // 样式
    span.style.cssText = `
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      margin: 0 2px;
      border-radius: 4px;
      font-size: 0.9em;
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    // 悬浮效果
    span.addEventListener('mouseenter', () => {
      span.style.filter = 'brightness(0.95)';
    });
    span.addEventListener('mouseleave', () => {
      span.style.filter = 'none';
    });

    // 点击事件
    if (this.onClick) {
      span.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onClick?.(this.mention);
      });
    }

    return span;
  }

  eq(other: MentionWidget): boolean {
    return (
      other.mention.id === this.mention.id &&
      other.mention.type === this.mention.type &&
      other.mention.name === this.mention.name
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 创建 Mention 装饰器
 */
function buildDecorations(
  view: EditorView,
  resolver: MentionResolver,
  onClick?: MentionClickHandler
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const text = doc.toString();
  const mentions = parseMentions(text);

  for (const parsed of mentions) {
    const item = resolver(parsed.type, parsed.id);
    if (item) {
      const widget = Decoration.replace({
        widget: new MentionWidget(item, onClick),
        inclusive: false,
      });
      builder.add(parsed.from, parsed.to, widget);
    }
  }

  return builder.finish();
}

/**
 * 创建 Mention 视图插件
 */
export function createMentionPlugin(
  resolver: MentionResolver,
  onClick?: MentionClickHandler
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, resolver, onClick);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, resolver, onClick);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * 创建 Mention 主题样式
 */
export const mentionTheme = EditorView.baseTheme({
  '.mention-widget': {
    fontFamily: 'inherit',
  },
  '.mention-char': {
    backgroundColor: 'color-mix(in srgb, var(--token-status-info) 18%, transparent)',
    color: 'var(--token-status-info)',
  },
  '.mention-prop': {
    backgroundColor: 'color-mix(in srgb, var(--token-status-warning) 18%, transparent)',
    color: 'var(--token-status-warning)',
  },
  '.mention-scene': {
    backgroundColor: 'color-mix(in srgb, var(--token-status-success) 18%, transparent)',
    color: 'var(--token-status-success)',
  },
  '.mention-shot': {
    backgroundColor: 'color-mix(in srgb, var(--token-accent-base) 18%, transparent)',
    color: 'var(--token-accent-base)',
  },
  '.mention-grid': {
    backgroundColor: 'color-mix(in srgb, var(--token-status-info) 14%, transparent)',
    color: 'var(--token-status-info)',
  },
  '.mention-storyboard': {
    backgroundColor: 'color-mix(in srgb, var(--token-status-warning) 28%, transparent)',
    color: 'var(--token-status-warning)',
    border: '1px solid color-mix(in srgb, var(--token-status-warning) 55%, transparent)',
    boxShadow: '0 0 0 1px color-mix(in srgb, var(--token-status-warning) 12%, transparent)',
    fontWeight: '700',
  },
  '.mention-previous_storyboard': {
    backgroundColor: 'color-mix(in srgb, var(--token-accent-base) 24%, transparent)',
    color: 'var(--token-accent-base)',
    border: '1px solid color-mix(in srgb, var(--token-accent-base) 55%, transparent)',
    boxShadow: '0 0 0 1px color-mix(in srgb, var(--token-accent-base) 12%, transparent)',
    fontWeight: '700',
  },
});

/**
 * 查找位置所在的 mention 范围
 */
function findMentionAt(text: string, pos: number): { from: number; to: number } | null {
  const mentions = parseMentions(text);
  for (const m of mentions) {
    // 如果光标在 mention 范围内（包括边界）
    if (pos >= m.from && pos <= m.to) {
      return { from: m.from, to: m.to };
    }
  }
  return null;
}

/**
 * 原子删除 - Backspace 处理
 */
function atomicBackspace(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;

  // 只处理单光标（非选区）情况
  if (!selection.main.empty) {
    return false;
  }

  const pos = selection.main.head;
  const text = state.doc.toString();

  // 检查光标前面是否有 mention
  // 尝试找光标位置和前一个位置的 mention
  let mention = findMentionAt(text, pos - 1);
  if (!mention && pos > 0) {
    mention = findMentionAt(text, pos);
    // 只有当光标正好在 mention 末尾时才处理
    if (mention && mention.to !== pos) {
      mention = null;
    }
  }

  if (mention) {
    view.dispatch({
      changes: { from: mention.from, to: mention.to },
      selection: EditorSelection.cursor(mention.from),
    });
    return true;
  }

  return false;
}

/**
 * 原子删除 - Delete 处理
 */
function atomicDelete(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;

  // 只处理单光标（非选区）情况
  if (!selection.main.empty) {
    return false;
  }

  const pos = selection.main.head;
  const text = state.doc.toString();

  // 检查光标位置是否在 mention 内或开头
  const mention = findMentionAt(text, pos);

  if (mention) {
    view.dispatch({
      changes: { from: mention.from, to: mention.to },
      selection: EditorSelection.cursor(mention.from),
    });
    return true;
  }

  return false;
}

/**
 * 创建原子删除扩展
 * 当光标在 mention 内部或边界时，整体删除 mention
 */
export function createMentionAtomicDelete() {
  return keymap.of([
    {
      key: 'Backspace',
      run: atomicBackspace,
    },
    {
      key: 'Delete',
      run: atomicDelete,
    },
  ]);
}
