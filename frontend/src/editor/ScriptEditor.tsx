/**
 * 智能剧本编辑器组件
 * 基于 CodeMirror 6，支持 @mention 智能引用和 /命令 运镜快捷输入
 */
import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { EditorState, Extension, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, tooltips } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { completionKeymap } from '@codemirror/autocomplete';
import { createMentionPlugin, createMentionAtomicDelete, mentionTheme } from './mentionPlugin';
import type { MentionClickHandler } from './mentionPlugin';
import { createMentionTooltip, tooltipTheme } from './mentionTooltip';
import { createCombinedAutocomplete, combinedAutocompleteTheme } from './combinedAutocomplete';
import { createKeywordHighlightPlugin, createKeywordTooltip, createKeywordAtomicDelete, keywordHighlightTheme } from './keywordHighlightPlugin';
import type { MentionItem, MentionType } from './mentionTypes';
import { normalizeMentionId, resolveBuiltInMentionItem } from './mentionTypes';

import './ScriptEditor.scss';

export interface ScriptEditorProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
  // Mention 相关
  mentionItems?: MentionItem[];
  onMentionClick?: MentionClickHandler;
  // 运镜/景别功能：/ 快捷输入 + 关键字高亮
  enableCameraCommands?: boolean;
  // 样式选项
  showLineNumbers?: boolean;
  darkTheme?: boolean;
  // 样式
  className?: string;
}

/**
 * 智能剧本编辑器
 */
export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  value,
  onChange,
  placeholder = '开始编写剧本...\n使用 @ 引用角色/道具/场景，使用 / 快速输入运镜方式',
  readOnly = false,
  minHeight = '200px',
  maxHeight = '400px',
  mentionItems = [],
  onMentionClick,
  enableCameraCommands = true,
  showLineNumbers = true,
  darkTheme = false,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const rootClassName = ['scriptEditorHost', className].filter(Boolean).join(' ');
  // 用于动态更新 mention 相关扩展的 Compartment
  const mentionCompartmentRef = useRef(new Compartment());
  // 记录最后一次从编辑器输出的值，用于避免循环更新
  const lastOutputRef = useRef(value);
  // 标记正在进行外部 value 同步，此时不应触发 onChange（避免反向覆盖数据）
  const isSyncingExternalRef = useRef(false);

  // 更新 onChange 引用
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Mention 解析器 - 支持 ID 规范化匹配
  const mentionResolver = useCallback(
    (type: MentionType, id: string): MentionItem | undefined => {
      // 规范化查找的 ID
      const normalizedSearchId = normalizeMentionId(type, id);
      const explicitItem = mentionItems.find((item) => {
        if (item.type !== type) return false;
        // 规范化 item 的 ID 进行比较
        const normalizedItemId = normalizeMentionId(type, item.id);
        return normalizedItemId === normalizedSearchId || item.id === id;
      });

      if (explicitItem) return explicitItem;

      const builtIn = resolveBuiltInMentionItem(type, id);
      if (builtIn) return builtIn;

      return undefined;
    },
    [mentionItems]
  );

  // Mention 数据源
  const mentionDataSource = useCallback(() => {
    return mentionItems;
  }, [mentionItems]);

  // 创建编辑器扩展（可动态更新）
  const editorExtensions = useMemo((): Extension[] => {
    const exts: Extension[] = [
      // Mention 插件
      createMentionPlugin(mentionResolver, onMentionClick),
      createMentionTooltip(mentionResolver),
      Prec.highest(createMentionAtomicDelete()),
      mentionTheme,
      tooltipTheme,
      // 组合自动补全（@ mention + / 运镜快捷输入）
      createCombinedAutocomplete(mentionDataSource),
      combinedAutocompleteTheme,
    ];

    // 运镜/景别功能：高亮 + 悬浮提示 + 原子删除
    if (enableCameraCommands) {
      exts.push(createKeywordHighlightPlugin());
      exts.push(createKeywordTooltip());
      exts.push(Prec.high(createKeywordAtomicDelete()));
      exts.push(keywordHighlightTheme);
    }

    return exts;
  }, [mentionResolver, mentionDataSource, onMentionClick, enableCameraCommands]);

  // 创建基础扩展（不变的部分）
  const baseExtensions = useMemo((): Extension[] => {
    const exts: Extension[] = [
      // 基础功能
      highlightActiveLine(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
      // 自动换行
      EditorView.lineWrapping,

      // tooltip 渲染到 body，避免被 overflow 裁剪
      tooltips({ parent: document.body }),

      // 文档变更监听
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current && !isSyncingExternalRef.current) {
          const newValue = update.state.doc.toString();
          // 记录输出的值，用于在 value 同步 effect 中判断是否需要跳过
          lastOutputRef.current = newValue;
          onChangeRef.current(newValue);
        }
      }),

      // 编辑器样式
      EditorView.theme({
        '&': {
          height: minHeight,
          maxHeight,
          overflow: 'hidden',
          border: '1px solid var(--token-border-base)',
          borderRadius: '8px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          lineHeight: '1.6',
          backgroundColor: 'var(--token-bg-surface)',
        },
        '.cm-scroller': {
          overflow: 'auto',
          height: '100%',
          cursor: 'text',
        },
        '.cm-content': {
          padding: '12px',
          color: 'var(--token-text-primary)',
          caretColor: 'var(--token-accent-base)',
        },
        '.cm-line': {
          padding: '2px 4px',
        },
        '&.cm-focused': {
          outline: 'none',
          borderColor: 'var(--token-border-focus)',
          boxShadow: '0 0 0 2px color-mix(in srgb, var(--token-accent-base) 22%, transparent)',
        },
        '.cm-gutters': {
          backgroundColor: 'var(--token-bg-elevated)',
          borderRight: '1px solid var(--token-border-subtle)',
          color: 'var(--token-text-muted)',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'transparent',
        },
        '.cm-activeLine': {
          backgroundColor: 'transparent',
        },
        '.cm-selectionBackground': {
          backgroundColor: 'color-mix(in srgb, var(--token-accent-base) 20%, transparent) !important',
        },
        '&.cm-focused .cm-selectionBackground': {
          backgroundColor: 'color-mix(in srgb, var(--token-accent-base) 30%, transparent) !important',
        },
        '.cm-cursor': {
          borderLeftColor: 'var(--token-accent-base)',
        },
      }),

      // 占位符
      EditorView.contentAttributes.of({
        'data-placeholder': placeholder,
      }),
    ];

    // 行号
    if (showLineNumbers) {
      exts.unshift(lineNumbers());
    }

    // 只读模式
    if (readOnly) {
      exts.push(EditorState.readOnly.of(true));
    }

    return exts;
  }, [minHeight, maxHeight, placeholder, readOnly, showLineNumbers, darkTheme]);

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current) return;

    const extensionCompartment = mentionCompartmentRef.current;

    // 创建编辑器
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions,
        extensionCompartment.of(editorExtensions),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // 只在挂载时创建

  // 同步外部 value 变化（仅处理外部控制的更新，如撤销/重置）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // 如果编辑器有焦点，说明用户正在输入，不强制同步外部值
    // 避免快速输入时因 React 异步更新导致的竞态条件
    if (view.hasFocus) return;

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      lastOutputRef.current = value;
      // 标记为外部同步，阻止 updateListener 触发 onChange
      // CodeMirror dispatch 是同步的，updateListener 在 dispatch 内部执行
      isSyncingExternalRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
      isSyncingExternalRef.current = false;
    }
  }, [value]);

  // 更新扩展（当 mentionItems 等变化时）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const extensionCompartment = mentionCompartmentRef.current;
    view.dispatch({
      effects: extensionCompartment.reconfigure(editorExtensions),
    });
  }, [editorExtensions]);

  // 点击容器时聚焦编辑器
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view) return;
    // 如果点击的是编辑器内容区域外（但在容器内），聚焦编辑器
    if (e.target === containerRef.current) {
      view.focus();
      // 将光标移到末尾
      view.dispatch({
        selection: { anchor: view.state.doc.length },
      });
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      onClick={handleContainerClick}
    />
  );
};

if (typeof document !== 'undefined' && !document.getElementById('script-editor-placeholder-style')) {
  const placeholderStyle = document.createElement('style');
  placeholderStyle.id = 'script-editor-placeholder-style';
  placeholderStyle.textContent = `
.cm-content[data-placeholder]:empty::before {
  content: attr(data-placeholder);
  color: var(--token-text-muted);
  pointer-events: none;
  position: absolute;
  white-space: pre-wrap;
}
`;
  document.head.appendChild(placeholderStyle);
}

export default ScriptEditor;
