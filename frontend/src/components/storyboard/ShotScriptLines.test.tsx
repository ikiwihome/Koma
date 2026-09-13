import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShotScriptLines } from './ShotScriptLines';
import type { ShotScriptLine } from '../../types';

describe('ShotScriptLines', () => {
  const baseLines: ShotScriptLine[] = [
    { id: 'line-1', text: '第一行文本' },
  ];

  it('keeps line edits local until blur so parent rerenders do not reset cursor text', () => {
    const onLinesChange = vi.fn();
    const { rerender } = render(
      <ShotScriptLines
        shotId="shot-1"
        lines={baseLines}
        onLinesChange={onLinesChange}
      />,
    );

    const input = screen.getByPlaceholderText('字幕行...') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '第一行中间编辑文本' } });

    expect(onLinesChange).not.toHaveBeenCalled();

    rerender(
      <ShotScriptLines
        shotId="shot-1"
        lines={baseLines}
        onLinesChange={onLinesChange}
      />,
    );

    expect(screen.getByPlaceholderText('字幕行...')).toHaveValue('第一行中间编辑文本');

    fireEvent.blur(screen.getByPlaceholderText('字幕行...'));
    expect(onLinesChange).toHaveBeenCalledTimes(1);
    expect(onLinesChange).toHaveBeenLastCalledWith('shot-1', [
      { id: 'line-1', text: '第一行中间编辑文本' },
    ]);
  });

  it('materializes an active draft before structural line changes', () => {
    const onLinesChange = vi.fn();
    render(
      <ShotScriptLines
        shotId="shot-1"
        lines={baseLines}
        onLinesChange={onLinesChange}
      />,
    );

    const input = screen.getByPlaceholderText('字幕行...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '未失焦的草稿' } });
    fireEvent.click(screen.getByText('添加一行'));

    expect(onLinesChange).toHaveBeenCalledTimes(1);
    const [, nextLines] = onLinesChange.mock.calls[0] as [string, ShotScriptLine[]];
    expect(nextLines[0]).toEqual({ id: 'line-1', text: '未失焦的草稿' });
    expect(nextLines).toHaveLength(2);
  });
});
