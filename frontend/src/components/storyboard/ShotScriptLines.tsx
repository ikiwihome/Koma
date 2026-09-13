/**
 * 分镜内字幕行块列表（Phase 3 新组件）
 *
 * 取代旧的 ShotScriptInput textarea。每个分镜的"剧本"是若干字幕行块，
 * 每块可单独编辑、删除、在任意位置插入新行；同分镜内 / 跨分镜之间均可
 * 拖拽排序（拖拽逻辑在 Storyboard 顶层 DndContext 中处理）。
 *
 * 本组件本身只负责单分镜内的渲染与逐块编辑回调；上下文（DndContext）
 * 由 Storyboard 提供，跨分镜拖动 onDragEnd 由父级捕获。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ShotScriptLine } from '../../types';
import { createScriptLine } from '../../types';

interface ShotScriptLinesProps {
  shotId: string;
  lines: ShotScriptLine[];
  /** 每次 lines 变更（编辑 / 删除 / 同分镜内排序 / 任意位置插入）回调 */
  onLinesChange: (shotId: string, lines: ShotScriptLine[]) => void;
}

/** 单行块（行内编辑 + 拖拽手柄 + 删除按钮 + 行前 ⊕ 插入） */
interface SortableLineProps {
  shotId: string;
  line: ShotScriptLine;
  onDraftChange: (lineId: string, text: string) => void;
  onTextCommit: (lineId: string, text: string) => void;
  onDelete: (lineId: string) => void;
  onInsertAbove: (lineId: string) => void;
}

function SortableLine({ shotId, line, onDraftChange, onTextCommit, onDelete, onInsertAbove }: SortableLineProps) {
  // dnd-kit sortable id 必须全局唯一；用 shotId:lineId 编码使跨分镜拖动时父级能解析归属
  const sortableId = `${shotId}::${line.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    data: { shotId, lineId: line.id },
  });
  const [draftText, setDraftText] = useState(line.text);
  const focusedRef = useRef(false);
  const draftTextRef = useRef(line.text);
  const latestLineTextRef = useRef(line.text);

  useEffect(() => {
    latestLineTextRef.current = line.text;
    if (!focusedRef.current) {
      draftTextRef.current = line.text;
      setDraftText(line.text);
    }
  }, [line.text]);

  const handleDraftChange = useCallback((text: string) => {
    draftTextRef.current = text;
    setDraftText(text);
    onDraftChange(line.id, text);
  }, [line.id, onDraftChange]);

  const commitDraft = useCallback(() => {
    const nextText = draftTextRef.current;
    if (nextText !== latestLineTextRef.current) {
      latestLineTextRef.current = nextText;
      onTextCommit(line.id, nextText);
    }
  }, [line.id, onTextCommit]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-1 px-1 py-0.5 hover:bg-bg-hover/40 rounded relative"
    >
      {/* 行前 ⊕ 插入：hover 时显示 */}
      <button
        type="button"
        title="在此行上方插入新行"
        onClick={() => onInsertAbove(line.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity absolute -left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-text-tertiary hover:text-accent bg-bg-elevated rounded-full border border-border-subtle"
      >
        <Plus className="w-2.5 h-2.5" />
      </button>

      {/* 拖拽手柄 */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="拖动排序（支持跨分镜）"
        className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary touch-none flex-shrink-0"
      >
        <GripVertical className="w-3 h-3" />
      </button>

      {/* 行文本 */}
      <input
        type="text"
        value={draftText}
        onChange={(e) => handleDraftChange(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          commitDraft();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitDraft();
            e.currentTarget.blur();
          }
        }}
        placeholder="字幕行..."
        className="flex-1 bg-transparent border-none outline-none text-xs text-text-primary placeholder-text-muted py-0.5"
      />

      {/* 删除按钮：hover 时显示 */}
      <button
        type="button"
        title="删除本行"
        onClick={() => onDelete(line.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 w-4 h-4 flex items-center justify-center text-text-tertiary hover:text-status-danger"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

export const ShotScriptLines: React.FC<ShotScriptLinesProps> = ({ shotId, lines, onLinesChange }) => {
  const sortableIds = lines.map(line => `${shotId}::${line.id}`);
  const draftsRef = useRef(new Map<string, string>());
  const latestLinesRef = useRef(lines);
  const latestShotIdRef = useRef(shotId);
  const latestOnLinesChangeRef = useRef(onLinesChange);

  useEffect(() => {
    latestLinesRef.current = lines;
    latestShotIdRef.current = shotId;
    latestOnLinesChangeRef.current = onLinesChange;
  });

  useEffect(() => {
    const lineIds = new Set(lines.map(line => line.id));
    for (const [lineId, draftText] of draftsRef.current) {
      const line = lines.find(item => item.id === lineId);
      if (!lineIds.has(lineId) || line?.text === draftText) {
        draftsRef.current.delete(lineId);
      }
    }
  }, [lines]);

  const materializeLinesWithDrafts = useCallback(() => (
    lines.map(line => (
      draftsRef.current.has(line.id)
        ? { ...line, text: draftsRef.current.get(line.id) ?? line.text }
        : line
    ))
  ), [lines]);

  useEffect(() => () => {
    if (draftsRef.current.size === 0) return;
    const committedLines = latestLinesRef.current.map(line => (
      draftsRef.current.has(line.id)
        ? { ...line, text: draftsRef.current.get(line.id) ?? line.text }
        : line
    ));
    draftsRef.current.clear();
    latestOnLinesChangeRef.current(latestShotIdRef.current, committedLines);
  }, []);

  const handleDraftChange = useCallback((lineId: string, text: string) => {
    draftsRef.current.set(lineId, text);
  }, []);

  const handleTextCommit = useCallback((lineId: string, text: string) => {
    draftsRef.current.set(lineId, text);
    onLinesChange(shotId, materializeLinesWithDrafts().map(l => l.id === lineId ? { ...l, text } : l));
  }, [shotId, onLinesChange, materializeLinesWithDrafts]);

  const handleDelete = useCallback((lineId: string) => {
    draftsRef.current.delete(lineId);
    onLinesChange(shotId, materializeLinesWithDrafts().filter(l => l.id !== lineId));
  }, [shotId, onLinesChange, materializeLinesWithDrafts]);

  const handleInsertAbove = useCallback((targetLineId: string) => {
    const materializedLines = materializeLinesWithDrafts();
    const idx = materializedLines.findIndex(l => l.id === targetLineId);
    if (idx < 0) return;
    const inserted = createScriptLine('');
    const next = [...materializedLines.slice(0, idx), inserted, ...materializedLines.slice(idx)];
    onLinesChange(shotId, next);
  }, [shotId, onLinesChange, materializeLinesWithDrafts]);

  const handleAppend = useCallback(() => {
    onLinesChange(shotId, [...materializeLinesWithDrafts(), createScriptLine('')]);
  }, [shotId, onLinesChange, materializeLinesWithDrafts]);

  return (
    <div className="flex flex-col gap-0 h-full">
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto pl-3 pr-1 py-1">
          {lines.length === 0 ? (
            <div className="text-xs text-text-muted px-2 py-1">无字幕行</div>
          ) : (
            lines.map(line => (
              <SortableLine
                key={line.id}
                shotId={shotId}
                line={line}
                onDraftChange={handleDraftChange}
                onTextCommit={handleTextCommit}
                onDelete={handleDelete}
                onInsertAbove={handleInsertAbove}
              />
            ))
          )}
        </div>
      </SortableContext>

      {/* 末尾 + 添加一行 */}
      <button
        type="button"
        onClick={handleAppend}
        className="flex items-center gap-1 mx-2 mb-1 px-2 py-1 text-xs text-text-tertiary hover:text-accent hover:bg-bg-hover/40 rounded border border-dashed border-border-subtle"
      >
        <Plus className="w-3 h-3" />
        <span>添加一行</span>
      </button>
    </div>
  );
};

export default ShotScriptLines;
