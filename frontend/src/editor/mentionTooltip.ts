/**
 * CodeMirror Mention Tooltip
 * 悬浮显示 Mention 详情
 */
import { EditorView, hoverTooltip } from '@codemirror/view';
import type { MentionItem, MentionType } from './mentionTypes';
import { parseMentions } from './mentionTypes';
import { electronService } from '../services/electronService';

// Mention 解析器
export type MentionResolver = (type: MentionType, id: string) => MentionItem | undefined;

/**
 * 创建 Mention Tooltip 扩展
 */
export function createMentionTooltip(resolver: MentionResolver) {
  return hoverTooltip((view, pos, _side) => {
    const doc = view.state.doc;
    const line = doc.lineAt(pos);
    const text = line.text;
    const lineStart = line.from;

    // 在当前行查找 Mention。使用 parseMentions，避免正则分组变化后
    // @shot_anchor / @grid_anchor 这类内置锚点解析错位。
    for (const parsed of parseMentions(text)) {
      const from = lineStart + parsed.from;
      const to = lineStart + parsed.to;

      if (pos >= from && pos <= to) {
        const item = resolver(parsed.type, parsed.id);

        if (item) {
          return {
            pos: from,
            end: to,
            above: true,
            create: () => createTooltipDOM(item),
          };
        }
      }
    }

    return null;
  });
}

/**
 * 创建 Tooltip DOM
 */
function createTooltipDOM(item: MentionItem): { dom: HTMLElement } {
  const container = document.createElement('div');
  container.className = 'mention-tooltip';
  container.style.cssText = `
    padding: 12px;
    max-width: 300px;
    font-size: 14px;
    background: var(--token-bg-elevated);
    color: var(--token-text-primary);
    border-radius: 8px;
    box-shadow: var(--token-shadow-md);
  `;

  // 头部：类型标签 + 名称
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  `;

  const typeTag = document.createElement('span');
  typeTag.textContent = getTypeLabel(item.type);
  typeTag.style.cssText = `
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    background-color: ${getTypeColor(item.type).bg};
    color: ${getTypeColor(item.type).text};
  `;

  const name = document.createElement('span');
  name.textContent = item.name;
  name.style.fontWeight = 'bold';

  header.appendChild(typeTag);
  header.appendChild(name);
  container.appendChild(header);

  // 预览图
  if (item.previewImage) {
    const img = document.createElement('img');
    // 使用 electronService 转换本地路径
    img.src = electronService.fs.toLocalUrl(item.previewImage);
    img.alt = item.name;
    img.style.cssText = `
      width: 100%;
      max-height: 150px;
      object-fit: cover;
      border-radius: 4px;
      margin-bottom: 8px;
    `;
    img.onerror = () => {
      img.style.display = 'none';
    };
    container.appendChild(img);
  }

  // 描述
  if (item.description) {
    const desc = document.createElement('div');
    desc.textContent = item.description;
    desc.style.cssText = `
      color: var(--token-text-secondary);
      font-size: 13px;
      line-height: 1.4;
    `;
    container.appendChild(desc);
  }

  // ID
  const idText = document.createElement('div');
  idText.textContent = `ID: ${item.id}`;
  idText.style.cssText = `
    margin-top: 8px;
    font-size: 11px;
    color: var(--token-text-muted);
    font-family: monospace;
  `;
  container.appendChild(idText);

  return { dom: container };
}

function getTypeLabel(type: MentionType): string {
  switch (type) {
    case 'char':
      return '角色';
    case 'prop':
      return '道具';
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

function getTypeColor(type: MentionType): { bg: string; text: string } {
  switch (type) {
    case 'char':
      return {
        bg: 'color-mix(in srgb, var(--token-status-info) 18%, transparent)',
        text: 'var(--token-status-info)',
      };
    case 'prop':
      return {
        bg: 'color-mix(in srgb, var(--token-status-warning) 18%, transparent)',
        text: 'var(--token-status-warning)',
      };
    case 'scene':
      return {
        bg: 'color-mix(in srgb, var(--token-status-success) 18%, transparent)',
        text: 'var(--token-status-success)',
      };
    case 'shot':
      return {
        bg: 'color-mix(in srgb, var(--token-accent-base) 18%, transparent)',
        text: 'var(--token-accent-base)',
      };
    case 'grid':
      return {
        bg: 'color-mix(in srgb, var(--token-status-info) 14%, transparent)',
        text: 'var(--token-status-info)',
      };
    case 'storyboard':
      return {
        bg: 'color-mix(in srgb, var(--token-status-warning) 24%, transparent)',
        text: 'var(--token-status-warning)',
      };
    case 'previous_storyboard':
      return {
        bg: 'color-mix(in srgb, var(--token-accent-base) 22%, transparent)',
        text: 'var(--token-accent-base)',
      };
    default:
      return {
        bg: 'var(--token-bg-hover)',
        text: 'var(--token-text-secondary)',
      };
  }
}

/**
 * Tooltip 样式
 */
export const tooltipTheme = EditorView.baseTheme({
  '.cm-tooltip': {
    border: 'none',
  },
  '.mention-tooltip': {
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
});
