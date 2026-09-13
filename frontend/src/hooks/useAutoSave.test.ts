import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaType, type TimelineData } from '../types/editor';
import { useAutoSave } from './useAutoSave';

const saveTimelineMock = vi.fn();
const saveProjectMock = vi.fn();
const loadProjectMock = vi.fn();

vi.mock('../store/projectStore', () => ({
  saveTimeline: (...args: unknown[]) => saveTimelineMock(...args),
  saveProject: (...args: unknown[]) => saveProjectMock(...args),
  loadProject: (...args: unknown[]) => loadProjectMock(...args),
}));

function createTimelineData(): TimelineData {
  return {
    version: 0,
    createdAt: 100,
    updatedAt: 100,
    tracks: [
      {
        id: 'track-1',
        type: 'video',
        order: 0,
        clips: [
          {
            id: 'clip-a',
            assetId: 'asset-a',
            trackId: 'track-1',
            start: 0,
            duration: 3,
            offset: 0,
            name: 'clip-a',
            type: MediaType.VIDEO,
            src: 'a.mp4',
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
            start: 3,
            duration: 3,
            offset: 0,
            name: 'clip-b',
            type: MediaType.VIDEO,
            src: 'b.mp4',
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            opacity: 1,
          },
        ],
      },
    ],
  };
}

describe('useAutoSave timeline workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveTimelineMock.mockReset();
    saveProjectMock.mockReset();
    loadProjectMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists debounced timeline saves through the unified timeline boundary', async () => {
    const timeline = createTimelineData();
    saveTimelineMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutoSave({ projectId: 'project-1', debounceMs: 10 }));

    act(() => {
      result.current.triggerSave({ timeline });
    });

    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });

    expect(saveTimelineMock).toHaveBeenCalledTimes(1);
    expect(saveTimelineMock).toHaveBeenCalledWith('project-1', timeline);
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it('merges metadata saves with existing project data in the same workflow', async () => {
    loadProjectMock.mockResolvedValue({
      id: 'project-1',
      title: 'Old Title',
      genre: 'Drama',
      mode: 'drama',
      createdAt: 1,
      updatedAt: 1,
    });
    saveProjectMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutoSave({ projectId: 'project-1', debounceMs: 10 }));

    act(() => {
      result.current.triggerSave({ meta: { title: 'New Title' } });
    });

    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });

    expect(loadProjectMock).toHaveBeenCalledWith('project-1');
    expect(saveProjectMock).toHaveBeenCalledTimes(1);
    expect(saveProjectMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        id: 'project-1',
        title: 'New Title',
        genre: 'Drama',
      })
    );
  });
});
