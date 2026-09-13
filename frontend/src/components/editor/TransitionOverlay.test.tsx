import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaType, type Track, type Transition } from '../../types/editor';
import { TransitionOverlay } from '../../features/transition/ui';

const makeTrack = (transition?: Transition): Track => ({
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
  transitions: transition ? [transition] : [],
});

describe('TransitionOverlay', () => {
  it('shows invalid transition badge while idle', () => {
    const transition: Transition = {
      id: 'transition-1',
      fromClipId: 'clip-a',
      toClipId: 'clip-b',
      type: 'fade',
      duration: 1,
    };
    const track = makeTrack(transition);
    const resolvedClipWindows = new Map([
      ['clip-a', { clipId: 'clip-a', trackId: 'track-1', resolvedStart: 0, resolvedEnd: 2 }],
      ['clip-b', { clipId: 'clip-b', trackId: 'track-1', resolvedStart: 2, resolvedEnd: 4 }],
    ]);

    render(
      <TransitionOverlay
        track={track}
        resolvedClipWindows={resolvedClipWindows}
        pixelsPerSecond={10}
        selectedTransitionId={null}
        invalidTransitions={[transition]}
        onSelectTransition={vi.fn()}
      />
    );

    expect(screen.getByText('⚠ 无效 1.0s')).toBeInTheDocument();
  });

  it('shows add button when transition is eligible and missing', () => {
    const track = makeTrack();
    const resolvedClipWindows = new Map([
      ['clip-a', { clipId: 'clip-a', trackId: 'track-1', resolvedStart: 0, resolvedEnd: 2 }],
      ['clip-b', { clipId: 'clip-b', trackId: 'track-1', resolvedStart: 2, resolvedEnd: 4 }],
    ]);

    render(
      <TransitionOverlay
        track={track}
        resolvedClipWindows={resolvedClipWindows}
        pixelsPerSecond={10}
        selectedTransitionId={null}
        onAddTransition={vi.fn()}
      />
    );

    expect(screen.getByText('+ 转场')).toBeInTheDocument();
  });

  it('hides add button when normalization rejects the candidate transition', () => {
    const track: Track = {
      ...makeTrack(),
      clips: makeTrack().clips.map((clip) => ({
        ...clip,
        duration: 0.1,
      })),
    };
    const resolvedClipWindows = new Map([
      ['clip-a', { clipId: 'clip-a', trackId: 'track-1', resolvedStart: 0, resolvedEnd: 0.1 }],
      ['clip-b', { clipId: 'clip-b', trackId: 'track-1', resolvedStart: 0.1, resolvedEnd: 0.2 }],
    ]);

    render(
      <TransitionOverlay
        track={track}
        resolvedClipWindows={resolvedClipWindows}
        pixelsPerSecond={10}
        selectedTransitionId={null}
        onAddTransition={vi.fn()}
      />
    );

    expect(screen.queryByText('+ 转场')).not.toBeInTheDocument();
  });

  it('shows +/- buttons instead of slider when transition span is narrow', () => {
    const transition: Transition = {
      id: 'transition-1',
      fromClipId: 'clip-a',
      toClipId: 'clip-b',
      type: 'fade',
      duration: 0.5,
    };
    const track = makeTrack(transition);
    const resolvedClipWindows = new Map([
      ['clip-a', { clipId: 'clip-a', trackId: 'track-1', resolvedStart: 0, resolvedEnd: 2 }],
      ['clip-b', { clipId: 'clip-b', trackId: 'track-1', resolvedStart: 1.5, resolvedEnd: 3.5 }],
    ]);

    // pixelsPerSecond=5 → maxDuration≈1.9 * 5 * 0.8 ≈ 7.6px < 60 → buttons
    render(
      <TransitionOverlay
        track={track}
        resolvedClipWindows={resolvedClipWindows}
        pixelsPerSecond={5}
        selectedTransitionId="transition-1"
        onUpdateTransitionDuration={vi.fn()}
        onDeleteTransition={vi.fn()}
      />
    );

    expect(screen.getByTitle('减少 0.1s')).toBeInTheDocument();
    expect(screen.getByTitle('增加 0.1s')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('shows slider when transition span is wide enough', () => {
    const transition: Transition = {
      id: 'transition-1',
      fromClipId: 'clip-a',
      toClipId: 'clip-b',
      type: 'fade',
      duration: 0.5,
    };
    const track = makeTrack(transition);
    const resolvedClipWindows = new Map([
      ['clip-a', { clipId: 'clip-a', trackId: 'track-1', resolvedStart: 0, resolvedEnd: 2 }],
      ['clip-b', { clipId: 'clip-b', trackId: 'track-1', resolvedStart: 1.5, resolvedEnd: 3.5 }],
    ]);

    // pixelsPerSecond=100 → maxDuration≈1.9 * 100 * 0.8 ≈ 152px > 60 → slider
    render(
      <TransitionOverlay
        track={track}
        resolvedClipWindows={resolvedClipWindows}
        pixelsPerSecond={100}
        selectedTransitionId="transition-1"
        onUpdateTransitionDuration={vi.fn()}
        onDeleteTransition={vi.fn()}
      />
    );

    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.queryByTitle('减少 0.1s')).not.toBeInTheDocument();
  });
});
