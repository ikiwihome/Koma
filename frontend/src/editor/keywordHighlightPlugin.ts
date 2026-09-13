/**
 * 关键字高亮装饰器插件
 * 用于高亮提示词中的运镜和景别关键字
 * 支持悬浮弹窗和原子删除
 */
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  hoverTooltip,
  keymap,
} from '@codemirror/view';
import { RangeSetBuilder, EditorSelection } from '@codemirror/state';
import { ALL_COMMANDS } from './cameraCommandTypes';
import type { CameraCommand } from './cameraCommandTypes';

// 构建关键字到命令的映射
interface KeywordInfo {
  keyword: string;
  command: CameraCommand;
}

function buildKeywordMap(): KeywordInfo[] {
  const result: KeywordInfo[] = [];

  for (const cmd of ALL_COMMANDS) {
    result.push({ keyword: cmd.nameZh, command: cmd });
    result.push({ keyword: cmd.nameEn, command: cmd });
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        result.push({ keyword: alias, command: cmd });
      }
    }
  }

  // 按长度降序排列
  result.sort((a, b) => b.keyword.length - a.keyword.length);
  return result;
}

const KEYWORD_MAP = buildKeywordMap();

// 构建正则表达式
function buildKeywordRegex(): RegExp {
  const zhKeywords: string[] = [];
  const enKeywords: string[] = [];

  for (const { keyword } of KEYWORD_MAP) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/[\u4e00-\u9fa5]/.test(keyword)) {
      zhKeywords.push(escaped);
    } else {
      enKeywords.push(escaped);
    }
  }

  const patterns: string[] = [];
  if (enKeywords.length > 0) {
    patterns.push(`\\b(${enKeywords.join('|')})\\b`);
  }
  if (zhKeywords.length > 0) {
    patterns.push(`(${zhKeywords.join('|')})`);
  }

  return new RegExp(patterns.join('|'), 'gi');
}

const keywordRegex = buildKeywordRegex();

// 查找命令信息
function findCommand(matchedText: string): CameraCommand | undefined {
  const lower = matchedText.toLowerCase();
  for (const { keyword, command } of KEYWORD_MAP) {
    if (keyword.toLowerCase() === lower) {
      return command;
    }
  }
  return undefined;
}

// 解析文本中的所有关键字匹配
interface KeywordMatch {
  from: number;
  to: number;
  text: string;
  command: CameraCommand;
}

function parseKeywords(text: string): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  keywordRegex.lastIndex = 0;
  let match;

  while ((match = keywordRegex.exec(text)) !== null) {
    const matchedText = match[0];
    const command = findCommand(matchedText);

    if (command) {
      const from = match.index;
      const to = match.index + matchedText.length;

      // 检查重叠
      const overlaps = matches.some(
        m => (from >= m.from && from < m.to) || (to > m.from && to <= m.to) ||
             (from <= m.from && to >= m.to)
      );

      if (!overlaps) {
        matches.push({ from, to, text: matchedText, command });
      }
    }
  }

  matches.sort((a, b) => a.from - b.from);
  return matches;
}

// 查找位置所在的关键字
function findKeywordAt(text: string, pos: number): KeywordMatch | null {
  const matches = parseKeywords(text);
  for (const m of matches) {
    if (pos >= m.from && pos <= m.to) {
      return m;
    }
  }
  return null;
}

// 创建装饰
function createDecoration(command: CameraCommand): Decoration {
  const isCamera = command.category === 'camera';
  return Decoration.mark({
    class: isCamera ? 'keyword-camera' : 'keyword-shot-type',
  });
}

// 构建装饰集
function buildKeywordDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const matches = parseKeywords(text);

  for (const m of matches) {
    builder.add(m.from, m.to, createDecoration(m.command));
  }

  return builder.finish();
}

/**
 * 创建关键字高亮视图插件
 */
export function createKeywordHighlightPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildKeywordDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildKeywordDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * 创建关键字悬浮提示
 */
export function createKeywordTooltip() {
  return hoverTooltip((view, pos, _side) => {
    const text = view.state.doc.toString();
    const match = findKeywordAt(text, pos);

    if (!match) return null;

    return {
      pos: match.from,
      end: match.to,
      above: true,
      create: () => createTooltipDOM(match.command, match.text),
    };
  });
}

// 创建 Tooltip DOM
function createTooltipDOM(command: CameraCommand, _matchedText: string): { dom: HTMLElement } {
  const isCamera = command.category === 'camera';

  const container = document.createElement('div');
  container.className = 'keyword-tooltip';
  container.style.cssText = `
    padding: 10px 14px;
    max-width: 280px;
    font-size: 13px;
    background: var(--token-bg-elevated);
    border-radius: 8px;
    box-shadow: var(--token-shadow-md);
    border: 1px solid ${isCamera ? 'color-mix(in srgb, var(--token-status-info) 55%, transparent)' : 'color-mix(in srgb, var(--token-accent-base) 55%, transparent)'};
  `;

  // 头部
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  `;

  const typeTag = document.createElement('span');
  typeTag.textContent = isCamera ? '运镜' : '景别';
  typeTag.style.cssText = `
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    background: ${isCamera ? 'color-mix(in srgb, var(--token-status-info) 18%, transparent)' : 'color-mix(in srgb, var(--token-accent-base) 18%, transparent)'};
    color: ${isCamera ? 'var(--token-status-info)' : 'var(--token-accent-base)'};
  `;

  const name = document.createElement('span');
  name.textContent = command.nameZh;
  name.style.cssText = `
    font-weight: 600;
    color: var(--token-text-primary);
  `;

  const enName = document.createElement('span');
  enName.textContent = command.nameEn;
  enName.style.cssText = `
    color: var(--token-text-tertiary);
    font-size: 12px;
    margin-left: auto;
  `;

  header.appendChild(typeTag);
  header.appendChild(name);
  header.appendChild(enName);
  container.appendChild(header);

  // 描述
  const desc = document.createElement('div');
  desc.textContent = command.description;
  desc.style.cssText = `
    color: var(--token-text-secondary);
    font-size: 12px;
    line-height: 1.5;
  `;
  container.appendChild(desc);

  return { dom: container };
}

/**
 * 原子删除 - Backspace
 */
function atomicBackspace(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;

  if (!selection.main.empty) return false;

  const pos = selection.main.head;
  const text = state.doc.toString();

  // 检查光标前一位或当前位置是否在关键字内
  let match = findKeywordAt(text, pos - 1);
  if (!match) {
    match = findKeywordAt(text, pos);
    if (match && match.to !== pos) {
      match = null;
    }
  }

  if (match) {
    view.dispatch({
      changes: { from: match.from, to: match.to },
      selection: EditorSelection.cursor(match.from),
    });
    return true;
  }

  return false;
}

/**
 * 原子删除 - Delete
 */
function atomicDelete(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;

  if (!selection.main.empty) return false;

  const pos = selection.main.head;
  const text = state.doc.toString();
  const match = findKeywordAt(text, pos);

  if (match) {
    view.dispatch({
      changes: { from: match.from, to: match.to },
      selection: EditorSelection.cursor(match.from),
    });
    return true;
  }

  return false;
}

/**
 * 创建关键字原子删除扩展
 */
export function createKeywordAtomicDelete() {
  return keymap.of([
    { key: 'Backspace', run: atomicBackspace },
    { key: 'Delete', run: atomicDelete },
  ]);
}

/**
 * 关键字高亮主题样式
 */
export const keywordHighlightTheme = EditorView.baseTheme({
  '.keyword-camera': {
    backgroundColor: 'color-mix(in srgb, var(--token-status-info) 18%, transparent)',
    color: 'var(--token-status-info)',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.keyword-shot-type': {
    backgroundColor: 'color-mix(in srgb, var(--token-accent-base) 18%, transparent)',
    color: 'var(--token-accent-base)',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.keyword-tooltip': {
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
});

// 兼容旧导出
export const CAMERA_KEYWORDS_EN = ALL_COMMANDS.filter(c => c.category === 'camera').map(c => c.nameEn);
export const CAMERA_KEYWORDS_ZH = ALL_COMMANDS.filter(c => c.category === 'camera').map(c => c.nameZh);
export const CAMERA_KEYWORDS = [...CAMERA_KEYWORDS_EN, ...CAMERA_KEYWORDS_ZH];
export const SHOT_TYPE_KEYWORDS_EN = ALL_COMMANDS.filter(c => c.category === 'shot').map(c => c.nameEn);
export const SHOT_TYPE_KEYWORDS_ZH = ALL_COMMANDS.filter(c => c.category === 'shot').map(c => c.nameZh);
export const SHOT_TYPE_KEYWORDS = [...SHOT_TYPE_KEYWORDS_EN, ...SHOT_TYPE_KEYWORDS_ZH];
