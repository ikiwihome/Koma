import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Asset, Track } from '../../types/editor';
import { MediaType } from '../../types/editor';
import { normalizeTimelineTracks } from '../../features/transition/core';
import { SimpleTimeline } from './SimpleTimeline';

vi.mock('./useVideoFrames', () => ({
  useVideoFramesBatch: vi.fn(() => new Map()),
}));

vi.mock('./TransitionOverlay', () => ({
  TransitionOverlay: () => <div data-testid="transition-overlay" />,
}));

const noop = () => {};
const noopAssetDrop = (_asset: Asset) => {};

const baseTrack: Track = {
  id: 'video-main',
  type: 'video',
  order: 0,
  isMainTrack: true,
  clips: [
    {
      id: 'clip-a',
      assetId: 'asset-a',
      trackId: 'video-main',
      start: 0,
      duration: 1,
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
      trackId: 'video-main',
      start: 1,
      duration: 1,
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
};

describe('SimpleTimeline toolbar transitions', () => {
  it('disables clear-all after SimpleEditor-style normalization removes invalid transitions', () => {
    const track: Track = {
      ...baseTrack,
      transitions: [
        {
          id: 'invalid-transition',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          type: 'fade',
          duration: 0,
        },
      ],
    };
    const [normalizedTrack] = normalizeTimelineTracks([track]);

    render(
      <SimpleTimeline
        tracks={[normalizedTrack]}
        currentTime={0}
        duration={2}
        onSeek={noop}
        selectedClipId={null}
        onSelectClip={noop}
        onUpdateClip={noop}
        onMoveClip={noop}
        onAssetDrop={noopAssetDrop}
        draggingAsset={null}
        isPlaying={false}
        togglePlay={noop}
        onDeleteTrack={noop}
        onAddAllTransitions={vi.fn()}
        onDeleteAllTransitions={vi.fn()}
      />
    );

    expect(normalizedTrack.transitions).toEqual([]);
    expect(screen.getByRole('button', { name: '清除转场' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清除转场' })).toHaveAttribute('title', '无转场可清除');
  });

  it('explains when no addable cut points exist', () => {
    const track: Track = {
      ...baseTrack,
      clips: [
        {
          ...baseTrack.clips[0],
          start: 0,
          duration: 1,
        },
        {
          ...baseTrack.clips[1],
          start: 2,
          duration: 1,
        },
      ],
    };

    render(
      <SimpleTimeline
        tracks={[track]}
        currentTime={0}
        duration={3}
        onSeek={noop}
        selectedClipId={null}
        onSelectClip={noop}
        onUpdateClip={noop}
        onMoveClip={noop}
        onAssetDrop={noopAssetDrop}
        draggingAsset={null}
        isPlaying={false}
        togglePlay={noop}
        onDeleteTrack={noop}
        onAddAllTransitions={vi.fn()}
        onDeleteAllTransitions={vi.fn()}
      />
    );

    const addButton = screen.getByRole('button', { name: '一键转场' });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute('title', '暂无可添加转场的切点');
  });

  it('enables clear-all when main track has valid transitions', () => {
    const track: Track = {
      ...baseTrack,
      transitions: [
        {
          id: 'valid-transition',
          fromClipId: 'clip-a',
          toClipId: 'clip-b',
          type: 'fade',
          duration: 0.3,
        },
      ],
    };
    const [normalizedTrack] = normalizeTimelineTracks([track]);

    render(
      <SimpleTimeline
        tracks={[normalizedTrack]}
        currentTime={0}
        duration={2}
        onSeek={noop}
        selectedClipId={null}
        onSelectClip={noop}
        onUpdateClip={noop}
        onMoveClip={noop}
        onAssetDrop={noopAssetDrop}
        draggingAsset={null}
        isPlaying={false}
        togglePlay={noop}
        onDeleteTrack={noop}
        onAddAllTransitions={vi.fn()}
        onDeleteAllTransitions={vi.fn()}
      />
    );

    expect(normalizedTrack.transitions).toHaveLength(1);
    expect(screen.getByRole('button', { name: '清除转场' })).not.toBeDisabled();
  });

  it('opens track context menu with transition actions for main track', () => {
    const onAddAllTransitions = vi.fn();
    const onDeleteAllTransitions = vi.fn();

    render(
      <SimpleTimeline
        tracks={[baseTrack]}
        currentTime={0}
        duration={2}
        onSeek={noop}
        selectedClipId={null}
        onSelectClip={noop}
        onUpdateClip={noop}
        onMoveClip={noop}
        onAssetDrop={noopAssetDrop}
        draggingAsset={null}
        isPlaying={false}
        togglePlay={noop}
        onDeleteTrack={noop}
        onAddAllTransitions={onAddAllTransitions}
        onDeleteAllTransitions={onDeleteAllTransitions}
      />
    );

    fireEvent.contextMenu(screen.getByText('主轨道'));

    expect(screen.getByRole('button', { name: '一键转场 (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除转场 (0)' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '一键转场 (1)' }));
    expect(onAddAllTransitions).toHaveBeenCalledWith('video-main');
  });

  it('does not show batch transition actions for non-main track context menu', () => {
    const secondaryTrack: Track = {
      ...baseTrack,
      id: 'video-secondary',
      isMainTrack: false,
      name: '副轨道',
      clips: baseTrack.clips.map((clip) => ({
        ...clip,
        id: `${clip.id}-secondary`,
        trackId: 'video-secondary',
      })),
    };

    render(
      <SimpleTimeline
        tracks={[baseTrack, secondaryTrack]}
        currentTime={0}
        duration={2}
        onSeek={noop}
        selectedClipId={null}
        onSelectClip={noop}
        onUpdateClip={noop}
        onMoveClip={noop}
        onAssetDrop={noopAssetDrop}
        draggingAsset={null}
        isPlaying={false}
        togglePlay={noop}
        onDeleteTrack={noop}
        onAddAllTransitions={vi.fn()}
        onDeleteAllTransitions={vi.fn()}
        onUpdateTrack={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('副轨道'));

    const menu = screen.getByText('重命名轨道').closest('div');
    expect(menu).not.toBeNull();
    expect(within(menu as HTMLElement).queryByRole('button', { name: /一键转场/i })).not.toBeInTheDocument();
    expect(within(menu as HTMLElement).queryByRole('button', { name: /清除转场/i })).not.toBeInTheDocument();
  });
});
