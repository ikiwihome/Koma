import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MessageInstance } from 'antd/es/message/interface';
import { MediaType, type Track } from '../../types/editor';
import { useTransitionHandlers } from './useTransitionHandlers';

vi.mock('../../utils/generateId', () => ({
  generateId: vi.fn(() => 'generated-transition-id'),
}));

function createTrack(transitions?: Track['transitions']): Track {
  return {
    id: 'track-1',
    type: 'video',
    order: 0,
    clips: [
      {
        id: 'clip-a',
        assetId: 'asset-a',
        trackId: 'track-1',
        start: 0,
        duration: 2,
        offset: 0,
        name: 'Clip A',
        type: MediaType.VIDEO,
        src: 'file://clip-a',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
      },
      {
        id: 'clip-b',
        assetId: 'asset-b',
        trackId: 'track-1',
        start: 2,
        duration: 2,
        offset: 0,
        name: 'Clip B',
        type: MediaType.VIDEO,
        src: 'file://clip-b',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
      },
    ],
    transitions,
  };
}

describe('useTransitionHandlers', () => {
  let tracks: Track[];
  let success: ReturnType<typeof vi.fn>;
  let warning: ReturnType<typeof vi.fn>;
  let info: ReturnType<typeof vi.fn>;
  let updateTracks: (updater: (prev: Track[]) => Track[]) => void;
  let setSelectedTransitionId: ReturnType<typeof vi.fn>;
  let setSelectedClipId: ReturnType<typeof vi.fn>;
  let setSelectedKeyframeId: ReturnType<typeof vi.fn>;
  let isUserDeletingRef: { current: boolean };
  let message: MessageInstance;

  beforeEach(() => {
    tracks = [createTrack()];
    success = vi.fn();
    warning = vi.fn();
    info = vi.fn();
    updateTracks = (updater) => {
      tracks = updater(tracks);
    };
    setSelectedTransitionId = vi.fn();
    setSelectedClipId = vi.fn();
    setSelectedKeyframeId = vi.fn();
    isUserDeletingRef = { current: false };
    message = {
      success,
      warning,
      info,
    } as unknown as MessageInstance;
  });

  it('adds all eligible transitions and reports count', () => {
    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: null,
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleAddAllTransitions('track-1');
    });

    expect(tracks[0].transitions).toEqual([
      {
        id: 'generated-transition-id',
        fromClipId: 'clip-a',
        toClipId: 'clip-b',
        type: 'fade',
        duration: 0.5,
      },
    ]);
    expect(success).toHaveBeenCalledWith('已为 1 个切点添加淡变转场');
    expect(info).not.toHaveBeenCalled();
  });

  it('skips add when normalization removes the candidate transition', () => {
    tracks = [
      {
        ...createTrack(),
        clips: [
          {
            ...createTrack().clips[0],
            duration: 0.1,
          },
          {
            ...createTrack().clips[1],
            duration: 0.1,
          },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: null,
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleAddTransition('track-1', 'clip-a', 'clip-b');
    });

    expect(tracks[0].transitions ?? []).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith('当前切点不满足添加转场条件');
    expect(success).not.toHaveBeenCalled();
  });

  it('does not count transitions that normalize away during bulk add', () => {
    tracks = [
      {
        ...createTrack(),
        clips: [
          {
            ...createTrack().clips[0],
            duration: 0.1,
          },
          {
            ...createTrack().clips[1],
            duration: 0.1,
          },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: null,
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleAddAllTransitions('track-1');
    });

    expect(tracks[0].transitions ?? []).toHaveLength(0);
    expect(info).toHaveBeenCalledWith('所有切点已有转场');
    expect(success).not.toHaveBeenCalled();
  });

  it('reports when all eligible cut points already have transitions', () => {
    tracks = [
      createTrack([
        {
          id: 'existing-transition',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          type: 'fade',
          duration: 0.5,
        },
      ]),
    ];

    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: null,
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleAddAllTransitions('track-1');
    });

    expect(tracks[0].transitions).toHaveLength(1);
    expect(info).toHaveBeenCalledWith('所有切点已有转场');
    expect(success).not.toHaveBeenCalled();
  });

  it('selects transition and clears clip/keyframe selection', () => {
    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: null,
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleSelectTransition('transition-1');
    });

    expect(setSelectedTransitionId).toHaveBeenCalledWith('transition-1');
    expect(setSelectedClipId).toHaveBeenCalledWith(null);
    expect(setSelectedKeyframeId).toHaveBeenCalledWith(null);
  });

  it('clamps updated transition duration to chain-aware max', () => {
    tracks = [
      createTrack([
        {
          id: 'existing-transition',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          type: 'fade',
          duration: 0.5,
        },
      ]),
    ];

    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: null,
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleUpdateTransitionDuration('track-1', 'existing-transition', 9);
    });

    expect(tracks[0].transitions?.[0].duration).toBe(1.9);
  });

  it('deletes a single transition, clears selected state, and marks delete intent', () => {
    tracks = [
      createTrack([
        {
          id: 'existing-transition',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          type: 'fade',
          duration: 0.5,
        },
      ]),
    ];

    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: 'existing-transition',
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleDeleteTransition('track-1', 'existing-transition');
    });

    expect(tracks[0].transitions).toEqual([]);
    expect(setSelectedTransitionId).toHaveBeenCalledWith(null);
    expect(success).toHaveBeenCalledWith('已删除转场');
    expect(isUserDeletingRef.current).toBe(true);
  });

  it('clears all transitions, resets selection, and marks delete intent', async () => {
    tracks = [
      createTrack([
        {
          id: 'existing-transition',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          type: 'fade',
          duration: 0.5,
        },
      ]),
    ];

    const { result } = renderHook(() =>
      useTransitionHandlers({
        updateTracks,
        selectedTransitionId: 'existing-transition',
        setSelectedTransitionId,
        setSelectedClipId,
        setSelectedKeyframeId,
        message,
        isUserDeletingRef,
      })
    );

    act(() => {
      result.current.handleDeleteAllTransitions('track-1');
    });

    await vi.waitFor(() => {
      expect(success).toHaveBeenCalledWith('已清除全部 1 个转场');
    });

    expect(tracks[0].transitions).toEqual([]);
    expect(setSelectedTransitionId).toHaveBeenCalledWith(null);
    expect(isUserDeletingRef.current).toBe(true);
  });
});
