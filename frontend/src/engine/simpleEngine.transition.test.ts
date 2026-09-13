import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaType, type Clip, type Track } from '../types/editor';
import { SimpleExportRenderer } from '../services/simpleExportRenderer';
import { SimpleMediaEngine, SimpleVideoRenderer } from './simpleEngine';
import { getClipOpacityFromPlans, resolveTrackTimeline } from '../features/transition/core';

vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
  },
}));

vi.mock('./simpleKeyframe', () => ({
  getAnimatedProperties: vi.fn((clip: Clip) => ({
    x: clip.x,
    y: clip.y,
    scale: clip.scale,
    rotation: clip.rotation,
    opacity: clip.opacity,
  })),
}));

function createTextClip(id: string, start: number, duration: number, trackId = 'track-1'): Clip {
  return {
    id,
    assetId: `asset-${id}`,
    trackId,
    start,
    duration,
    offset: 0,
    name: id,
    type: MediaType.TEXT,
    src: id,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
    text: id,
  };
}

function createTrack(): Track {
  return {
    id: 'track-1',
    type: 'video',
    order: 0,
    clips: [
      createTextClip('clip-a', 0, 3),
      createTextClip('clip-b', 3, 3),
      createTextClip('clip-c', 6, 2),
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
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 100 })),
    fillText: vi.fn(() => {
      alphaSnapshots.push(ctx.globalAlpha);
    }),
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

function createExportRenderer() {
  return new SimpleExportRenderer({
    width: 1920,
    height: 1080,
    fps: 30,
    format: 'mp4',
    quality: 'medium',
    outputPath: '/tmp/out.mp4',
  });
}

describe('SimpleVideoRenderer preview/export alignment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCanvas2DContext(createCanvasContext().ctx);
  });

  it('matches visible clips during overlap with export renderer', () => {
    const previewCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => createCanvasContext().ctx),
    } as unknown as HTMLCanvasElement;
    const previewEngine = new SimpleMediaEngine(8);
    const previewRenderer = new SimpleVideoRenderer(previewEngine, previewCanvas) as any;
    const exportRenderer = createExportRenderer() as any;
    const track = createTrack();

    previewRenderer.setTracks([track]);
    exportRenderer.tracks = [track];
    exportRenderer.resolvedWindows = previewRenderer.resolvedWindows;

    const previewVisible = previewRenderer.getVisibleClips(2.5).map((clip: Clip) => clip.id);
    const exportVisible = exportRenderer.getVisibleClips(2.5).map((entry: { clip: Clip }) => entry.clip.id);

    expect(previewVisible).toEqual(['clip-a', 'clip-b']);
    expect(exportVisible).toEqual(previewVisible);
  });

  it('matches transition opacity with export renderer at key timestamps', async () => {
    const previewContext = createCanvasContext();
    const exportContext = createCanvasContext();
    const previewCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => previewContext.ctx),
    } as unknown as HTMLCanvasElement;
    const previewEngine = new SimpleMediaEngine(8);
    const previewRenderer = new SimpleVideoRenderer(previewEngine, previewCanvas) as any;
    mockCanvas2DContext(exportContext.ctx);
    const exportRenderer = createExportRenderer() as any;
    const track = createTrack();
    const checkpoints = [2.25, 2.5, 2.75];

    previewRenderer.setTracks([track]);
    exportRenderer.tracks = [track];
    exportRenderer.resolvedWindows = previewRenderer.resolvedWindows;
    exportRenderer.transitionPlansByTrack = previewRenderer.transitionPlansByTrack;

    for (const time of checkpoints) {
      previewContext.alphaSnapshots.length = 0;
      exportContext.alphaSnapshots.length = 0;

      previewRenderer.renderClip(track.clips[0], time);
      previewRenderer.renderClip(track.clips[1], time);
      await exportRenderer.renderClip(track.clips[0], time);
      await exportRenderer.renderClip(track.clips[1], time);

      expect(previewContext.alphaSnapshots).toHaveLength(2);
      expect(exportContext.alphaSnapshots).toHaveLength(2);
      expect(previewContext.alphaSnapshots[0]).toBeCloseTo(exportContext.alphaSnapshots[0], 5);
      expect(previewContext.alphaSnapshots[1]).toBeCloseTo(exportContext.alphaSnapshots[1], 5);
    }
  });

  it('matches golden transition checkpoints across preview export and resolver outputs', async () => {
    const previewContext = createCanvasContext();
    const exportContext = createCanvasContext();
    const previewCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => previewContext.ctx),
    } as unknown as HTMLCanvasElement;
    const previewEngine = new SimpleMediaEngine(8);
    const previewRenderer = new SimpleVideoRenderer(previewEngine, previewCanvas) as any;
    mockCanvas2DContext(exportContext.ctx);
    const exportRenderer = createExportRenderer() as any;
    const track = createTrack();
    const resolved = resolveTrackTimeline(track);
    const checkpoints = [1, 2, 2.25, 2.5, 2.75, 3, 4] as const;

    previewRenderer.setTracks([track]);
    exportRenderer.tracks = [track];
    exportRenderer.resolvedWindows = previewRenderer.resolvedWindows;
    exportRenderer.transitionPlansByTrack = previewRenderer.transitionPlansByTrack;

    const golden = [] as Array<{
      time: number;
      visible: string[];
      previewAlpha: number[];
      exportAlpha: number[];
      resolverAlpha: number[];
    }>;

    for (const time of checkpoints) {
      previewContext.alphaSnapshots.length = 0;
      exportContext.alphaSnapshots.length = 0;

      const previewVisible = previewRenderer.getVisibleClips(time) as Clip[];
      const exportVisible = exportRenderer.getVisibleClips(time).map((entry: { clip: Clip }) => entry.clip);

      for (const clip of previewVisible) {
        previewRenderer.renderClip(clip, time);
      }

      for (const clip of exportVisible) {
        await exportRenderer.renderClip(clip, time);
      }

      const resolverAlpha = previewVisible.map((clip) =>
        getClipOpacityFromPlans(resolved.transitionPlans, clip.id, time)
      );

      golden.push({
        time,
        visible: previewVisible.map((clip) => clip.id),
        previewAlpha: [...previewContext.alphaSnapshots],
        exportAlpha: [...exportContext.alphaSnapshots],
        resolverAlpha,
      });
    }

    expect(golden).toEqual([
      { time: 1, visible: ['clip-a'], previewAlpha: [1], exportAlpha: [1], resolverAlpha: [1] },
      { time: 2, visible: ['clip-a', 'clip-b'], previewAlpha: [1, 0], exportAlpha: [1, 0], resolverAlpha: [1, 0] },
      { time: 2.25, visible: ['clip-a', 'clip-b'], previewAlpha: [0.75, 0.25], exportAlpha: [0.75, 0.25], resolverAlpha: [0.75, 0.25] },
      { time: 2.5, visible: ['clip-a', 'clip-b'], previewAlpha: [0.5, 0.5], exportAlpha: [0.5, 0.5], resolverAlpha: [0.5, 0.5] },
      { time: 2.75, visible: ['clip-a', 'clip-b'], previewAlpha: [0.25, 0.75], exportAlpha: [0.25, 0.75], resolverAlpha: [0.25, 0.75] },
      { time: 3, visible: ['clip-b'], previewAlpha: [1], exportAlpha: [1], resolverAlpha: [1] },
      { time: 4, visible: ['clip-b'], previewAlpha: [1], exportAlpha: [1], resolverAlpha: [1] },
    ]);
  });
});
