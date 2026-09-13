/**
 * 组合自动补全
 * 合并 @ mention 和 / 运镜命令的补全源
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
import { searchCommands } from './cameraCommandTypes';

export type MentionDataSource = () => MentionItem[];

// Mention 类型标签
function getMentionTypeLabel(type: MentionType): string {
  switch (type) {
    case 'char': return '🎬 角色';
    case 'prop': return '🎬 道具';
    case 'scene': return '场景';
    case 'shot': return '分镜锚点';
    case 'grid': return '网格锚点';
    case 'storyboard': return '故事板锚点';
    case 'previous_storyboard': return '上一故事板';
    default: return '';
  }
}

/**
 * 创建 Mention 补全源 (@ 触发)
 */
function createMentionCompletions(dataSource: MentionDataSource) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/@\w*/);
    if (!word) return null;

    const query = word.text.slice(1).toLowerCase();
    const items = dataSource();

    const options: Completion[] = items
      .filter((item) => {
        if (!query) return true;
        return item.name.toLowerCase().includes(query) || item.type.includes(query);
      })
      .map((item) => ({
        label: item.name,
        type: item.type === 'char' ? 'variable' : item.type === 'prop' ? 'property' : 'class',
        detail: getMentionTypeLabel(item.type),
        info: item.description,
        apply: (view, _completion, from, to) => {
          const mentionStr = createMentionString(item.type, item.id);
          view.dispatch({
            changes: { from, to, insert: mentionStr + ' ' },
            selection: { anchor: from + mentionStr.length + 1 },
          });
        },
        boost: item.type === 'char' ? 2 : item.type === 'scene' ? 1 : 0,
      }));

    if (options.length === 0) return null;

    return {
      from: word.from,
      to: word.to,
      options,
      filter: false,
    };
  };
}

/**
 * 创建运镜命令补全源 (/ 触发)
 * 选择后直接插入中文文字
 */
function createCommandCompletions() {
  return (context: CompletionContext): CompletionResult | null => {
    // 匹配 / 开头的输入
    const word = context.matchBefore(/\/[^\s]*/);
    if (!word) return null;

    const query = word.text.slice(1).toLowerCase();
    const commands = searchCommands(query);

    if (commands.length === 0) return null;

    const options: Completion[] = commands.map((cmd) => ({
      label: `${cmd.nameZh} ${cmd.nameEn}`,
      displayLabel: cmd.nameZh,
      type: cmd.category === 'camera' ? 'keyword' : 'type',
      detail: cmd.category === 'camera' ? '🎬 运镜' : '📐 景别',
      info: `${cmd.nameEn}\n${cmd.description}`,
      apply: (view, _completion, from, to) => {
        // 直接插入中文名称
        const text = cmd.nameZh;
        view.dispatch({
          changes: { from, to, insert: text + ' ' },
          selection: { anchor: from + text.length + 1 },
        });
      },
      boost: cmd.category === 'camera' ? 1 : 0,
    }));

    return {
      from: word.from,
      to: word.to,
      options,
      filter: false,
    };
  };
}

/**
 * 创建组合自动补全扩展
 */
export function createCombinedAutocomplete(mentionDataSource: MentionDataSource) {
  return autocompletion({
    override: [
      createMentionCompletions(mentionDataSource),
      createCommandCompletions(),
    ],
    activateOnTyping: true,
    maxRenderedOptions: 25,
    icons: true,
    closeOnBlur: false,
  });
}

/**
 * 组合补全列表样式
 */
export const combinedAutocompleteTheme = EditorView.theme({
  '.cm-tooltip': {
    zIndex: '99999 !important',
  },
  '.cm-tooltip-autocomplete': {
    minWidth: '220px',
    maxWidth: '450px',
    zIndex: '99999 !important',
    background: 'var(--token-bg-elevated) !important',
    border: '1px solid var(--token-border-focus) !important',
    borderRadius: '8px',
    boxShadow: 'var(--token-shadow-md)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete ul': {
    maxHeight: '350px',
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
  '.cm-completionInfo': {
    padding: '8px 12px',
    background: 'var(--token-bg-surface)',
    color: 'var(--token-text-secondary)',
    fontSize: '12px',
    borderTop: '1px solid var(--token-border-base)',
    maxWidth: '300px',
    whiteSpace: 'pre-wrap',
  },
});
