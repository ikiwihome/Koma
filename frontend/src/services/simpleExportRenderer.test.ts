import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaType, type Clip, type Track } from '../types/editor';
import { resolveTrackTimeline } from './transition/transitionResolver';
import { SimpleExportRenderer } from './simpleExportRenderer';

vi.mock('../engine/simpleKeyframe', () => ({
  getAnimatedProperties: vi.fn((clip: Clip) => ({
    x: clip.x,
    y: clip.y,
    scale: clip.scale,
    rotation: clip.rotation,
    opacity: clip.opacity,
  })),
}));

function createCanvasContext() {
  const alphaSnapshots: number[] = [];
  const ctx = {
    fillStyle: '#000',
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(() => {
      alphaSnapshots.push(ctx.globalAlpha);
    }),
    measureText: vi.fn(() => ({ width: 100 })),
    fillText: vi.fn(),
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    textAlign: 'center',
    textBaseline: 'middle',
    font: '',
  } as unknown as CanvasRenderingContext2D;

  return { ctx, alphaSnapshots };
}

function mockCanvas2DContext(ctx: CanvasRenderingContext2D) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((
    (contextId: string) => (contextId === '2d' ? ctx : null)
  ) as HTMLCanvasElement['getContext']);
}

function createClip(id: string, start: number, duration: number, trackId = 'track-1'): Clip {
  return {
    id,
    assetId: `asset-${id}`,
    trackId,
    start,
    duration,
    offset: 0,
    name: id,
    type: MediaType.IMAGE,
    src: `${id}.png`,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
  };
}

function createTrack(): Track {
  return {
    id: 'track-1',
    type: 'video',
    order: 0,
    clips: [
      createClip('clip-a', 0, 3),
      createClip('clip-b', 3, 3),
      createClip('clip-c', 6, 2),
    ],
    transitions: [
      {
        id: 'transition-1',
        fromClipId: 'clip-a',
        toClipId: 'clip-b',
        type: 'fade',
        duration: 1,
      },
    ],
  };
}

function createRenderer() {
  return new SimpleExportRenderer({
    width: 1920,
    height: 1080,
    fps: 30,
    format: 'mp4',
    quality: 'medium',
    outputPath: '/tmp/out.mp4',
  });
}

describe('SimpleExportRenderer transition support', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const { ctx } = createCanvasContext();
    mockCanvas2DContext(ctx);
  });

  it('includes both clips during overlap on resolved timeline', () => {
    const track = createTrack();
    const resolved = resolveTrackTimeline(track);
    const renderer = createRenderer() as any;

    renderer.tracks = [track];
    renderer.resolvedWindows = new Map(
      resolved.clipWindows.map((window) => [window.clipId, window] as const)
    );

    const visibleAtTransition = renderer.getVisibleClips(2.5).map((entry: { clip: Clip }) => entry.clip.id);
    const visibleBeforeTransition = renderer.getVisibleClips(1).map((entry: { clip: Clip }) => entry.clip.id);

    expect(visibleAtTransition).toEqual(['clip-a', 'clip-b']);
    expect(visibleBeforeTransition).toEqual(['clip-a']);
  });

  it('applies complementary transition alpha while rendering overlap clips', async () => {
    const { ctx, alphaSnapshots } = createCanvasContext();
    mockCanvas2DContext(ctx);

    const track = createTrack();
    const resolved = resolveTrackTimeline(track);
    const renderer = createRenderer() as any;

    renderer.transitionPlansByTrack = new Map([[track.id, resolved.transitionPlans]]);
    renderer.mediaCache = new Map([
      ['clip-a', { width: 1920, height: 1080 }],
      ['clip-b', { width: 1920, height: 1080 }],
    ]);

    await renderer.renderClip(track.clips[0], 2.5);
    await renderer.renderClip(track.clips[1], 2.5);

    expect(alphaSnapshots).toHaveLength(2);
    expect(alphaSnapshots[0]).toBeCloseTo(0.5, 5);
    expect(alphaSnapshots[1]).toBeCloseTo(0.5, 5);
  });

  it('skips hidden tracks when collecting visible clips', () => {
    const hiddenTrack: Track = {
      ...createTrack(),
      id: 'track-hidden',
      hidden: true,
      clips: [
        createClip('hidden-clip-a', 0, 3, 'track-hidden'),
        createClip('hidden-clip-b', 3, 3, 'track-hidden'),
      ],
      transitions: [
        {
          id: 'hidden-transition',
          fromClipId: 'hidden-clip-a',
          toClipId: 'hidden-clip-b',
          type: 'fade',
          duration: 1,
        },
      ],
    };
    const visibleTrack = createTrack();
    const hiddenResolved = resolveTrackTimeline(hiddenTrack);
    const visibleResolved = resolveTrackTimeline(visibleTrack);
    const renderer = createRenderer() as any;

    renderer.tracks = [hiddenTrack, visibleTrack];
    renderer.resolvedWindows = new Map([
      ...hiddenResolved.clipWindows.map((window) => [window.clipId, window] as const),
      ...visibleResolved.clipWindows.map((window) => [window.clipId, window] as const),
    ]);

    const visibleAtTransition = renderer.getVisibleClips(2.5).map((entry: { clip: Clip }) => entry.clip.id);

    expect(visibleAtTransition).toEqual(['clip-a', 'clip-b']);
  });

  it('skips muted tracks when collecting audio clips', () => {
    const mutedTrack: Track = {
      ...createTrack(),
      id: 'track-muted',
      muted: true,
      clips: [
        { ...createClip('muted-clip-a', 0, 3, 'track-muted'), type: MediaType.VIDEO, src: '/tmp/muted-a.mp4' },
        { ...createClip('muted-clip-b', 3, 3, 'track-muted'), type: MediaType.AUDIO, src: '/tmp/muted-b.wav' },
      ],
      transitions: [
        {
          id: 'muted-transition',
          fromClipId: 'muted-clip-a',
          toClipId: 'muted-clip-b',
          type: 'fade',
          duration: 1,
        },
      ],
    };
    const audibleTrack: Track = {
      ...createTrack(),
      id: 'track-audible',
      clips: [{ ...createClip('audible-clip-a', 0, 4, 'track-audible'), type: MediaType.VIDEO, src: '/tmp/audible-a.mp4' }],
      transitions: [],
    };
    const mutedResolved = resolveTrackTimeline(mutedTrack);
    const audibleResolved = resolveTrackTimeline(audibleTrack);
    const renderer = createRenderer() as any;

    renderer.tracks = [mutedTrack, audibleTrack];
    renderer.resolvedWindows = new Map([
      ...mutedResolved.clipWindows.map((window) => [window.clipId, window] as const),
      ...audibleResolved.clipWindows.map((window) => [window.clipId, window] as const),
    ]);
    renderer.transitionPlansByTrack = new Map([
      [mutedTrack.id, mutedResolved.transitionPlans],
      [audibleTrack.id, audibleResolved.transitionPlans],
    ]);

    const audioClips = renderer.collectAudioClips();

    expect(audioClips).toEqual([
      expect.objectContaining({
        src: '/tmp/audible-a.mp4',
        start: 0,
        duration: 4,
      }),
    ]);
  });

  it('applies transition opacity to text clips', async () => {
    const { ctx } = createCanvasContext();
    mockCanvas2DContext(ctx);
    const track: Track = {
      ...createTrack(),
      clips: [
        { ...createClip('clip-a', 0, 3), type: MediaType.TEXT, src: 'A', text: 'A' },
        { ...createClip('clip-b', 3, 3), type: MediaType.TEXT, src: 'B', text: 'B' },
      ],
    };
    const resolved = resolveTrackTimeline(track);
    const renderer = createRenderer() as any;

    renderer.resolvedWindows = new Map(
      resolved.clipWindows.map((window) => [window.clipId, window] as const)
    );
    renderer.transitionPlansByTrack = new Map([[track.id, resolved.transitionPlans]]);

    await renderer.renderClip(track.clips[0], 2.5);

    expect(ctx.fillText).toHaveBeenCalled();
    expect((ctx as any).globalAlpha).toBeCloseTo(0.5, 5);
  });
  it('passes resolved transition audio data to ffmpeg during export', async () => {
    const track: Track = {
      ...createTrack(),
      clips: [
        { ...createClip('clip-a', 0, 3), type: MediaType.VIDEO, src: '/tmp/clip-a.mp4' },
        { ...createClip('clip-b', 3, 3), type: MediaType.AUDIO, src: '/tmp/clip-b.wav' },
      ],
    };
    const mutedTrack: Track = {
      ...createTrack(),
      id: 'track-muted',
      muted: true,
      clips: [{ ...createClip('muted-clip', 0, 2, 'track-muted'), type: MediaType.AUDIO, src: '/tmp/muted.wav' }],
      transitions: [],
    };
    const ffmpeg = {
      getTempDir: vi.fn().mockResolvedValue('/tmp/export'),
      composeVideo: vi.fn().mockResolvedValue('/tmp/out.mp4'),
      cleanupTemp: vi.fn().mockResolvedValue(undefined),
    };
    (window as any).electronAPI = { ffmpeg };

    const renderer = createRenderer() as any;
    vi.spyOn(renderer, 'preloadMedia').mockResolvedValue(undefined);
    vi.spyOn(renderer, 'renderAllFrames').mockResolvedValue(['/tmp/export/frame_00000.png']);

    const output = await renderer.export([track, mutedTrack], 5);

    expect(output).toBe('/tmp/out.mp4');
    expect(ffmpeg.getTempDir).toHaveBeenCalled();
    expect(ffmpeg.composeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        frameDir: '/tmp/export',
        outputPath: '/tmp/out.mp4',
        audioTracks: [
          expect.objectContaining({
            src: '/tmp/clip-a.mp4',
            start: 0,
            duration: 3,
            fadeOutDuration: 1,
          }),
          expect.objectContaining({
            src: '/tmp/clip-b.wav',
            start: 2,
            duration: 3,
            fadeInDuration: 1,
          }),
        ],
      })
    );
    expect(ffmpeg.composeVideo.mock.calls[0][0].audioTracks).toHaveLength(2);
    expect(ffmpeg.cleanupTemp).toHaveBeenCalledWith('/tmp/export');
  });
  it('collects audio clips using resolved timeline offsets and transition fades', () => {
    const track: Track = {
      ...createTrack(),
      clips: [
        { ...createClip('clip-a', 0, 3), type: MediaType.VIDEO, src: '/tmp/clip-a.mp4' },
        { ...createClip('clip-b', 3, 3), type: MediaType.AUDIO, src: '/tmp/clip-b.wav' },
      ],
    };
    const resolved = resolveTrackTimeline(track);
    const renderer = createRenderer() as any;

    renderer.tracks = [track];
    renderer.resolvedWindows = new Map(
      resolved.clipWindows.map((window) => [window.clipId, window] as const)
    );
    renderer.transitionPlansByTrack = new Map([[track.id, resolved.transitionPlans]]);

    const audioClips = renderer.collectAudioClips();

    expect(audioClips).toEqual([
      expect.objectContaining({
        src: '/tmp/clip-a.mp4',
        start: 0,
        duration: 3,
        offset: 0,
        fadeOutDuration: 1,
      }),
      expect.objectContaining({
        src: '/tmp/clip-b.wav',
        start: 2,
        duration: 3,
        offset: 0,
        fadeInDuration: 1,
      }),
    ]);
  });

  it('renders single clip at full opacity outside transition region', async () => {
    const { ctx, alphaSnapshots } = createCanvasContext();
    mockCanvas2DContext(ctx);

    const track = createTrack();
    const resolved = resolveTrackTimeline(track);
    const renderer = createRenderer() as any;

    renderer.transitionPlansByTrack = new Map([[track.id, resolved.transitionPlans]]);
    renderer.mediaCache = new Map([
      ['clip-a', { width: 1920, height: 1080 }],
    ]);

    // t=1.0 is well before the transition region (2.0–3.0)
    await renderer.renderClip(track.clips[0], 1.0);

    expect(alphaSnapshots).toHaveLength(1);
    expect(alphaSnapshots[0]).toBe(1);
  });

  it('renders track without transitions at full opacity', async () => {
    const { ctx, alphaSnapshots } = createCanvasContext();
    mockCanvas2DContext(ctx);

    const noTransitionTrack: Track = {
      id: 'track-no-trans',
      type: 'video',
      order: 0,
      clips: [createClip('solo-clip', 0, 5, 'track-no-trans')],
      transitions: [],
    };
    const resolved = resolveTrackTimeline(noTransitionTrack);
    const renderer = createRenderer() as any;

    renderer.transitionPlansByTrack = new Map([[noTransitionTrack.id, resolved.transitionPlans]]);
    renderer.mediaCache = new Map([
      ['solo-clip', { width: 1920, height: 1080 }],
    ]);

    await renderer.renderClip(noTransitionTrack.clips[0], 2.5);

    expect(alphaSnapshots).toHaveLength(1);
    expect(alphaSnapshots[0]).toBe(1);
  });
});
