/**
 * CodeMirror Mention 自动补全
 * 输入 @ 时触发补全列表
 */
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import type { MentionItem, MentionType } from './mentionTypes';
import { createMentionString } from './mentionTypes';

// Mention 数据源类型
export type MentionDataSource = () => MentionItem[];

/**
 * 创建 Mention 补全源
 */
function createMentionCompletions(
  dataSource: MentionDataSource
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    // 检查是否在 @ 后面
    const word = context.matchBefore(/@\w*/);
    if (!word) return null;

    // 如果只输入了 @，显示所有选项
    // 如果输入了 @xxx，过滤匹配的选项
    const query = word.text.slice(1).toLowerCase();
    const items = dataSource();

    const options: Completion[] = items
      .filter((item) => {
        if (!query) return true;
        return (
          item.name.toLowerCase().includes(query) ||
          item.type.includes(query)
        );
      })
      .map((item) => ({
        label: item.name,
        type: item.type === 'char' ? 'variable' : item.type === 'prop' ? 'property' : 'class',
        detail: getTypeLabel(item.type),
        info: item.description,
        apply: (view, _completion, from, to) => {
          // 插入 @type_id 格式
          const mentionStr = createMentionString(item.type, item.id);
          view.dispatch({
            changes: { from, to, insert: mentionStr + ' ' },
            selection: { anchor: from + mentionStr.length + 1 },
          });
        },
        boost: item.type === 'char' ? 2 : item.type === 'scene' ? 1 : 0,
      }));

    if (options.length === 0) {
      return null;
    }

    const result: CompletionResult = {
      from: word.from,
      to: word.to,  // 添加结束位置
      options,
      filter: false,  // 禁用内置过滤，我们自己处理
    };
    return result;
  };
}

// 所有显示在列表中的角色/道具都已绑定 Sora2，统一显示标记
function getTypeLabel(type: MentionType): string {
  switch (type) {
    case 'char':
      return '🎬 角色';
    case 'prop':
      return '🎬 道具';
    case 'scene':
      return '场景';
    case 'shot':
      return '分镜锚点';
    case 'grid':
      return '网格锚点';
    case 'storyboard':
      return '故事板锚点';
    case 'previous_storyboard':
      return '上一故事板';
    default:
      return '';
  }
}

/**
 * 创建 Mention 自动补全扩展
 */
export function createMentionAutocomplete(dataSource: MentionDataSource) {
  return autocompletion({
    override: [createMentionCompletions(dataSource)],
    activateOnTyping: true,
    maxRenderedOptions: 20,
    icons: true,
    closeOnBlur: false,  // 防止失焦关闭
  });
}

/**
 * 补全列表自定义样式 (EditorView.theme)
 */
export const autocompleteTheme = EditorView.theme({
  '.cm-tooltip': {
    zIndex: '99999 !important',
  },
  '.cm-tooltip-autocomplete': {
    minWidth: '220px',
    maxWidth: '400px',
    zIndex: '99999 !important',
    background: 'var(--token-bg-elevated) !important',
    border: '1px solid var(--token-border-focus) !important',
    borderRadius: '8px',
    boxShadow: 'var(--token-shadow-md)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete ul': {
    maxHeight: '300px',
    padding: '4px 0',
    margin: '0',
    listStyle: 'none',
  },
  '.cm-tooltip-autocomplete li': {
    padding: '8px 12px !important',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--token-text-primary) !important',
    cursor: 'pointer',
  },
  '.cm-tooltip-autocomplete li[aria-selected]': {
    backgroundColor: 'var(--token-accent-base) !important',
    color: 'var(--token-bg-app) !important',
  },
  '.cm-completionLabel': {
    flex: '1',
    fontWeight: '500',
  },
  '.cm-completionDetail': {
    fontSize: '0.85em',
    color: 'var(--token-text-secondary)',
    marginLeft: 'auto',
  },
  '.cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail': {
    color: 'color-mix(in srgb, var(--token-bg-app) 80%, transparent)',
  },
  '.cm-completionIcon': {
    opacity: '0.7',
  },
});
