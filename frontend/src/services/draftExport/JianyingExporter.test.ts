import { describe, expect, it } from 'vitest';
import { JianyingExporter } from './JianyingExporter';
import { MediaType, type Clip, type Track } from '../../types/editor';

function createClip(id: string, start: number, duration: number): Clip {
  return {
    id,
    assetId: `asset-${id}`,
    trackId: 'track-1',
    start,
    duration,
    offset: 0,
    sourceDuration: duration,
    name: id,
    type: MediaType.VIDEO,
    src: `${id}.mp4`,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
  };
}

describe('JianyingExporter', () => {
  it('exports track-level transitions with overlap-aware target timeranges', async () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 3)],
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

    const exporter = new JianyingExporter();
    const result = await exporter.export(
      [track],
      {
        outputPath: '/tmp/out',
        projectName: 'transition-test',
        fps: 30,
        copyMaterials: false,
      },
      { width: 1920, height: 1080 }
    );

    expect(result.success).toBe(true);
    const draftResult = result as typeof result & {
      draftContent: {
        duration: number;
        tracks: Array<{ segments: Array<{ material_id: string; target_timerange: { start: number } }> }>;
        materials: { transitions: Array<{ duration: number }> };
      };
    };

    expect(draftResult.draftContent.duration).toBe(5_000_000);
    expect(draftResult.draftContent.tracks[0].segments[0].target_timerange.start).toBe(0);
    expect(draftResult.draftContent.tracks[0].segments[1].target_timerange.start).toBe(2_000_000);
    expect(draftResult.draftContent.materials.transitions).toHaveLength(1);
    expect(draftResult.draftContent.materials.transitions[0].duration).toBe(1_000_000);
  });

  it('rejects draft export when invalid transitions are present', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 5, 3)], // gap between clips
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

    const exporter = new JianyingExporter();
    expect(
      exporter.canExport([track], {
        outputPath: '/tmp/out',
        projectName: 'transition-test',
        fps: 30,
        copyMaterials: false,
      })
    ).toBe(false);
  });
});
