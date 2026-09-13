/**
 * 对话输入编辑器（CodeMirror 6）— 独立组件。
 *
 * 能力：
 * - inline @ 自动补全（输入 @ 触发，弹出图片缩略图选项）
 * - inline 高亮：文本中的 @ref_<id> 自动渲染成带缩略图的 chip
 * - Enter 在 autocomplete 打开时仅选中、不触发发送（解决"选中即发送"bug）
 * - Enter 关闭 autocomplete 后才回调 onSubmit
 * - 暴露 ref API：focus / setText / getText
 *
 * 文本中的引用编码：`@ref_${ref.id}`。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import {
  autocompletion,
  Completion,
  CompletionContext,
  CompletionResult,
  closeCompletion,
  completionStatus,
} from '@codemirror/autocomplete';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import styles from './ChatPromptEditor.module.scss';
import { cssVars } from '../../theme/runtime';

export interface ChatEditorRef {
  id: string;
  label: string;
  source: string;
  origin?: 'upload' | 'generated';
  badge?: string;
}

export interface ChatPromptEditorRef {
  focus: () => void;
  setText: (text: string) => void;
  getText: () => string;
}

interface ChatPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  references: ChatEditorRef[];
  placeholder?: string;
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
}

// 引用编码：@图片N（label-based，与 extractChatImageMentionLabels / chatMediaGeneration 保持一致）
const REF_REGEX = /@(图片\d+)/g;

class ReferenceChipWidget extends WidgetType {
  private tooltip: HTMLDivElement | null = null;
  private boundEnter?: (e: MouseEvent) => void;
  private boundLeave?: () => void;
  private boundScroll?: () => void;

  constructor(readonly ref: ChatEditorRef) { super(); }

  private clearTooltip() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = styles.refChip;
    span.dataset.refId = this.ref.id;

    if (this.ref.source) {
      const img = document.createElement('img');
      img.src = this.ref.source;
      img.alt = this.ref.label;
      img.className = styles.refChipImage;
      span.appendChild(img);
    }

    const name = document.createElement('span');
    name.textContent = `@${this.ref.label}`;
    span.appendChild(name);

    this.boundEnter = (e: MouseEvent) => {
      if (!this.ref.source) return;
      this.clearTooltip();
      const tip = document.createElement('div');
      tip.className = styles.refTooltip;
      const big = document.createElement('img');
      big.src = this.ref.source;
      big.className = styles.refTooltipImage;
      tip.appendChild(big);
      document.body.appendChild(tip);
      this.tooltip = tip;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      tip.style.left = `${rect.left}px`;
      tip.style.top = `${Math.max(8, rect.top - 220)}px`;
    };
    this.boundLeave = () => this.clearTooltip();
    this.boundScroll = () => this.clearTooltip();

    span.addEventListener('mouseenter', this.boundEnter);
    span.addEventListener('mouseleave', this.boundLeave);
    // 滚动 / 输入框失焦也清理 tooltip，避免孤儿显示
    window.addEventListener('scroll', this.boundScroll, true);
    window.addEventListener('blur', this.boundScroll);

    return span;
  }

  destroy(_dom: HTMLElement): void {
    this.clearTooltip();
    if (this.boundScroll) {
      window.removeEventListener('scroll', this.boundScroll, true);
      window.removeEventListener('blur', this.boundScroll);
    }
  }

  eq(other: ReferenceChipWidget): boolean {
    return other.ref.id === this.ref.id
      && other.ref.label === this.ref.label
      && other.ref.source === this.ref.source;
  }
}

function buildRefDecorations(view: EditorView, refsByLabel: Map<string, ChatEditorRef>): DecorationSet {
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const text = view.state.doc.toString();
  REF_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_REGEX.exec(text)) !== null) {
    const label = m[1]; // "图片N"
    const ref = refsByLabel.get(label);
    if (!ref) continue;
    decos.push({
      from: m.index,
      to: m.index + m[0].length,
      deco: Decoration.replace({ widget: new ReferenceChipWidget(ref), inclusive: false }),
    });
  }
  decos.sort((a, b) => a.from - b.from);
  return Decoration.set(decos.map(d => d.deco.range(d.from, d.to)));
}

function createRefPlugin(getRefsByLabel: () => Map<string, ChatEditorRef>) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildRefDecorations(view, getRefsByLabel());
    }
    update(update: ViewUpdate) {
      this.decorations = buildRefDecorations(update.view, getRefsByLabel());
    }
  }, { decorations: p => p.decorations });
}

function makeAutocomplete(refs: ChatEditorRef[]) {
  return autocompletion({
    override: [
      (ctx: CompletionContext): CompletionResult | null => {
        // 触发：光标前是 @ 后跟 0+ 标识符字符
        const word = ctx.matchBefore(/@[\w一-龥]*/);
        if (!word || (word.from === word.to && !ctx.explicit)) return null;

        const filter = word.text.slice(1).toLowerCase();
        const options: Completion[] = refs.map(ref => ({
          label: ref.label,
          detail: ref.badge ?? (ref.origin === 'upload' ? '已上传' : ref.origin === 'generated' ? '历史生成' : ''),
          apply: `@${ref.label} `,
          info: () => {
            const wrap = document.createElement('div');
            wrap.className = styles.completionInfo;
            if (ref.source) {
              const img = document.createElement('img');
              img.src = ref.source;
              img.className = styles.completionInfoImage;
              wrap.appendChild(img);
            }
            const txt = document.createElement('span');
            txt.textContent = ref.label;
            wrap.appendChild(txt);
            return wrap;
          },
        })).filter(opt =>
          !filter || (typeof opt.label === 'string' && opt.label.toLowerCase().includes(filter)),
        );

        return {
          from: word.from,
          to: word.to,
          options,
          filter: false, // 我们自己 filter
        };
      },
    ],
    closeOnBlur: true,
    activateOnTyping: true,
    defaultKeymap: true,
  });
}

export const ChatPromptEditor = forwardRef<ChatPromptEditorRef, ChatPromptEditorProps>(({
  value,
  onChange,
  onSubmit,
  references,
  placeholder = '',
  disabled = false,
  minRows = 1,
  maxRows = 6,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const refsRef = useRef<ChatEditorRef[]>(references);
  // 用 label 做 key（与文本中 @图片N 一致）
  const refsByLabelRef = useRef<Map<string, ChatEditorRef>>(new Map(references.map(r => [r.label, r])));
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const refsCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());

  refsRef.current = references;
  refsByLabelRef.current = new Map(references.map(r => [r.label, r]));
  onChangeRef.current = onChange;
  onSubmitRef.current = onSubmit;

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current) return;

    const submitKey = keymap.of([
      {
        key: 'Enter',
        run: (view) => {
          // autocomplete 打开时 Enter 不发送（让 autocomplete 处理）
          if (completionStatus(view.state) === 'active') {
            return false; // 不消费，autocomplete 的 Enter 会先处理
          }
          onSubmitRef.current();
          return true;
        },
      },
      {
        key: 'Shift-Enter',
        run: (view) => {
          view.dispatch(view.state.replaceSelection('\n'));
          return true;
        },
      },
      {
        key: 'Escape',
        run: (view) => {
          if (completionStatus(view.state) === 'active') {
            closeCompletion(view);
            return true;
          }
          return false;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        Prec.highest(submitKey),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(disabled)),
        cmPlaceholder(placeholder || ''),
        refsCompartmentRef.current.of([
          createRefPlugin(() => refsByLabelRef.current),
          makeAutocomplete(refsRef.current),
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            fontSize: '15px',
            color: 'var(--token-text-primary)',
            backgroundColor: 'transparent',
          },
          '.cm-content': {
            padding: '6px 0',
            minHeight: 'var(--chat-prompt-editor-min-height)',
            maxHeight: 'var(--chat-prompt-editor-max-height)',
            overflowY: 'auto',
            caretColor: 'var(--token-status-info)',
            fontFamily: 'inherit',
          },
          '.cm-line': { padding: '0' },
          '&.cm-focused': { outline: 'none' },
          '.cm-cursor': { borderLeftColor: 'var(--token-status-info)' },
          '.cm-tooltip.cm-tooltip-autocomplete': {
            background: 'var(--token-bg-card)',
            border: '1px solid var(--token-border-base)',
            borderRadius: '8px',
            boxShadow: 'var(--token-shadow-md)',
            padding: '4px',
          },
          '.cm-tooltip-autocomplete > ul > li': {
            padding: '6px 10px',
            borderRadius: '4px',
            color: 'var(--token-text-secondary)',
            fontSize: '13px',
          },
          '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
            background: 'color-mix(in srgb, var(--token-status-info) 18%, transparent)',
            color: 'var(--token-text-primary)',
          },
          '.cm-completionDetail': {
            color: 'var(--token-text-tertiary)',
            fontSize: '11px',
            marginLeft: '8px',
            fontStyle: 'normal',
          },
          '.cm-tooltip.cm-completionInfo': {
            background: 'var(--token-bg-card)',
            border: '1px solid var(--token-border-base)',
            borderRadius: '8px',
            color: 'var(--token-text-primary)',
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化（如"重新编辑"灌入）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // references 变化时重新构造 ref 插件 + autocomplete（用 compartment 热替换）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: refsCompartmentRef.current.reconfigure([
        createRefPlugin(() => refsByLabelRef.current),
        makeAutocomplete(refsRef.current),
      ]),
    });
  }, [references]);

  // disabled 变化
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(disabled)),
    });
  }, [disabled]);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    setText: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    getText: () => viewRef.current?.state.doc.toString() ?? '',
  }), []);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-placeholder={placeholder}
      style={cssVars({
        '--chat-prompt-editor-min-height': `${minRows * 24}px`,
        '--chat-prompt-editor-max-height': `${maxRows * 24}px`,
      })}
    />
  );
});

ChatPromptEditor.displayName = 'ChatPromptEditor';

export default ChatPromptEditor;
