import { describe, expect, it } from 'vitest';
import { MediaType, type Clip, type Track } from '../../types/editor';
import {
  batchChainAwareMaxDurations,
  findTransitionByClipPair,
  getAddableTransitionCount,
  getChainAwareMaxDuration,
  getClipAudioFade,
  getClipOpacityFromPlans,
  getClipOpacityMultiplier,
  getClipResolvedWindow,
  getExistingTransitionCount,
  getMaxTransitionDuration,
  getSortedTrackClips,
  getTimelineDuration,
  normalizeTimelineTracks,
  normalizeTrackTransitions,
  resolveTimelineTracks,
  resolveTrackTimeline,
} from './transitionResolver';

function createClip(id: string, start: number, duration: number): Clip {
  return {
    id,
    assetId: `asset-${id}`,
    trackId: 'track-1',
    start,
    duration,
    offset: 0,
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

function createTrack(): Track {
  return {
    id: 'track-1',
    type: 'video',
    order: 0,
    clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2), createClip('clip-c', 5, 2)],
  };
}

describe('transitionResolver', () => {
  // 阶段 2-B 清理：legacy clip.transition 字段已删除，原 'normalizes legacy
  // clip transitions into track transitions' 测试也一并删除。

  it('rejects non-adjacent transitions but allows chain transitions', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
      { id: 't2', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      { id: 't3', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
    ];

    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toEqual([
      { id: 't2', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      { id: 't3', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
    ]);
  });

  it('computes overlap-aware resolved timeline duration', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
    ];

    const resolved = resolveTrackTimeline(track);
    expect(resolved.duration).toBe(6);
    expect(getTimelineDuration([track])).toBe(6);
    expect(resolved.clipWindows.find((clip) => clip.clipId === 'clip-b')?.resolvedStart).toBe(2);
    expect(resolved.transitionPlans[0]).toMatchObject({
      activeStartTime: 2,
      activeEndTime: 3,
      cutPointTime: 3,
    });
  });

  it('computes max duration and opacity interpolation for the active transition', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
    ];

    expect(getMaxTransitionDuration(track, 'clip-a', 'clip-b')).toBe(2);
    expect(getClipOpacityMultiplier(track, 'clip-a', 2.5)).toBeCloseTo(0.5, 5);
    expect(getClipOpacityMultiplier(track, 'clip-b', 2.5)).toBeCloseTo(0.5, 5);
    expect(getClipOpacityMultiplier(track, 'clip-c', 2.5)).toBe(1);
  });

  // --- P0 补充测试 ---

  it('rejects transition with missing or invalid fields (FX-ILLEGAL-005)', () => {
    const track = createTrack();
    // type undefined
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: undefined as unknown as 'fade', duration: 0.5 },
    ];
    expect(normalizeTrackTransitions(track).transitions).toHaveLength(0);

    // fromClipId missing
    track.transitions = [
      { id: 't2', fromClipId: '', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    expect(normalizeTrackTransitions(track).transitions).toHaveLength(0);

    // toClipId referencing non-existent clip
    track.transitions = [
      { id: 't3', fromClipId: 'clip-a', toClipId: 'non-existent', type: 'fade', duration: 0.5 },
    ];
    expect(normalizeTrackTransitions(track).transitions).toHaveLength(0);

    // duration missing (NaN/undefined) — now rejected by Number.isFinite guard
    track.transitions = [
      { id: 't4', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: undefined as unknown as number },
    ];
    expect(normalizeTrackTransitions(track).transitions).toHaveLength(0);
  });

  it('rejects transition with duration=0', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0 },
    ];
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(0);
  });

  it('accepts transition with duration=maxDuration', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
    };
    // maxDuration = min(3, 2) = 2, clampMax = 2 - 0.1 = 1.9
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 2 },
    ];
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(1);
    expect(normalized.transitions?.[0].duration).toBe(1.9);
  });

  it('cleans up transition when fromClip is removed', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    // Remove clip-a
    track.clips = track.clips.filter((c) => c.id !== 'clip-a');
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(0);
  });

  it('cleans up transition when clip is moved breaking adjacency', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      ],
    };
    // Move clip-b so it's no longer adjacent (gap between them)
    track.clips[1] = { ...track.clips[1], start: 5 };
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(0);
  });

  it('cleans up transition when a clip is inserted breaking adjacency', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      ],
    };
    // Insert clip-x between them, pushing clip-b to index 2
    const clipX: Clip = createClip('clip-x', 3, 1);
    track.clips = [track.clips[0], clipX, { ...track.clips[1], start: 4 }];
    const normalized = normalizeTrackTransitions(track);
    // clip-a→clip-b are no longer adjacent (clip-x is between them)
    expect(normalized.transitions).toHaveLength(0);
  });

  it('rejects transition on single-clip track', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-a', type: 'fade', duration: 0.5 },
      ],
    };
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(0);
  });

  it('rejects transition referencing clips from another track', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-foreign', type: 'fade', duration: 0.5 },
      ],
    };
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(0);
  });

  it('rejects transitions on non-video tracks', () => {
    const track: Track = {
      id: 'track-audio',
      type: 'audio',
      order: 0,
      clips: [
        { ...createClip('clip-a', 0, 3), trackId: 'track-audio', type: MediaType.AUDIO },
        { ...createClip('clip-b', 3, 2), trackId: 'track-audio', type: MediaType.AUDIO },
      ],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      ],
    };
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(0);
    expect(getMaxTransitionDuration(track, 'clip-a', 'clip-b')).toBe(0);
  });

  it('getClipOpacityFromPlans matches getClipOpacityMultiplier', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
    ];
    const { transitionPlans } = resolveTrackTimeline(track);
    const times = [0, 1, 2, 2.25, 2.5, 2.75, 3, 4, 5];
    for (const t of times) {
      expect(getClipOpacityFromPlans(transitionPlans, 'clip-a', t))
        .toBeCloseTo(getClipOpacityMultiplier(track, 'clip-a', t), 10);
      expect(getClipOpacityFromPlans(transitionPlans, 'clip-b', t))
        .toBeCloseTo(getClipOpacityMultiplier(track, 'clip-b', t), 10);
    }
  });

  // --- 链式转场测试 ---

  it('allows chain transitions A->B + B->C', () => {
    const track = createTrack(); // A(0,3), B(3,2), C(5,2)
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
    ];
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(2);
  });

  it('rejects chain transition when middle clip too short for both', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 1), createClip('clip-c', 4, 2)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.8 },
        { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.8 },
      ],
    };
    const normalized = normalizeTrackTransitions(track);
    // B.duration=1, t1 uses 0.8 of B budget, remaining=0.2, clampMax=0.1
    // t2 gets clamped to 0.1 instead of rejected
    expect(normalized.transitions).toHaveLength(2);
    expect(normalized.transitions?.[0].id).toBe('t1');
    expect(normalized.transitions?.[1].id).toBe('t2');
    expect(normalized.transitions?.[1].duration).toBeCloseTo(0.1, 5);
  });

  it('chain transitions resolve non-overlapping active windows', () => {
    const track = createTrack(); // A(0,3), B(3,2), C(5,2)
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
      { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 1 },
    ];
    const resolved = resolveTrackTimeline(track);
    expect(resolved.transitionPlans).toHaveLength(2);
    const [plan1, plan2] = resolved.transitionPlans;
    // T1 active ends before or at T2 active start — no overlap
    expect(plan1.activeEndTime).toBeLessThanOrEqual(plan2.activeStartTime);
  });

  it('getChainAwareMaxDuration respects neighbor transition', () => {
    const track = createTrack(); // A(0,3), B(3,2), C(5,2)
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
      { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
    ];
    // B.duration=2, t1 uses 1s of B's budget, so t2 max = min(2, 2-1) - 0.1 = 0.9
    expect(getChainAwareMaxDuration(track, 't2')).toBe(0.9);
    // t1 max = min(2, 3, 2-0.5) - 0.1 = 1.4
    expect(getChainAwareMaxDuration(track, 't1')).toBe(1.4);
  });

  it('rejects two outgoing transitions from the same clip', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
        { id: 't2', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.3 },
      ],
    };
    const normalized = normalizeTrackTransitions(track);
    expect(normalized.transitions).toHaveLength(1);
    expect(normalized.transitions?.[0].id).toBe('t1');
  });

  // --- 工具函数测试 ---

  it('getSortedTrackClips sorts by start then by id', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-c', 5, 2), createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
    };
    const sorted = getSortedTrackClips(track);
    expect(sorted.map((c) => c.id)).toEqual(['clip-a', 'clip-b', 'clip-c']);
  });

  it('getSortedTrackClips breaks ties by id', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-z', 0, 2), createClip('clip-a', 0, 3)],
    };
    const sorted = getSortedTrackClips(track);
    expect(sorted[0].id).toBe('clip-a');
    expect(sorted[1].id).toBe('clip-z');
  });

  it('findTransitionByClipPair returns matching transition', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    expect(findTransitionByClipPair(track, 'clip-a', 'clip-b')?.id).toBe('t1');
    expect(findTransitionByClipPair(track, 'clip-b', 'clip-c')).toBeUndefined();
  });

  it('findTransitionByClipPair returns undefined when no transitions', () => {
    const track = createTrack();
    expect(findTransitionByClipPair(track, 'clip-a', 'clip-b')).toBeUndefined();
  });

  it('normalizeTimelineTracks normalizes all tracks', () => {
    const videoTrack = createTrack();
    videoTrack.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    const audioTrack: Track = {
      id: 'track-audio',
      type: 'audio',
      order: 1,
      clips: [
        { ...createClip('a1', 0, 3), trackId: 'track-audio', type: MediaType.AUDIO },
      ],
      transitions: [
        { id: 'bad', fromClipId: 'a1', toClipId: 'a1', type: 'fade', duration: 0.5 },
      ],
    };
    const result = normalizeTimelineTracks([videoTrack, audioTrack]);
    expect(result).toHaveLength(2);
    expect(result[0].transitions).toHaveLength(1);
    expect(result[1].transitions).toHaveLength(0);
  });

  it('resolveTimelineTracks resolves all tracks', () => {
    const track1 = createTrack();
    track1.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
    ];
    const track2: Track = {
      id: 'track-2',
      type: 'video',
      order: 1,
      clips: [createClip('clip-d', 0, 4), createClip('clip-e', 4, 3)],
    };
    const resolved = resolveTimelineTracks([track1, track2]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].duration).toBe(6);
    expect(resolved[1].duration).toBe(7);
  });

  it('getClipResolvedWindow finds clip across tracks', () => {
    const track1: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3)],
    };
    const track2: Track = {
      id: 'track-2',
      type: 'video',
      order: 1,
      clips: [createClip('clip-x', 0, 5)],
    };
    const window = getClipResolvedWindow([track1, track2], 'clip-x');
    expect(window).toBeDefined();
    expect(window?.clipId).toBe('clip-x');
    expect(window?.resolvedStart).toBe(0);
    expect(window?.resolvedEnd).toBe(5);
  });

  it('getClipResolvedWindow returns undefined for missing clip', () => {
    const track = createTrack();
    expect(getClipResolvedWindow([track], 'non-existent')).toBeUndefined();
  });

  // --- 链式转场精确值测试 ---

  it('chain transitions produce correct clipWindows and duration', () => {
    const track = createTrack(); // A(0,3), B(3,2), C(5,2)
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
      { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 1 },
    ];
    const resolved = resolveTrackTimeline(track);
    // t2 clamped to 0.9 (budget=1, clampMax=0.9)
    // Total overlap = 1 + 0.9 = 1.9, duration = 7 - 1.9 = 5.1
    expect(resolved.duration).toBeCloseTo(5.1, 5);

    const windowA = resolved.clipWindows.find((w) => w.clipId === 'clip-a');
    const windowB = resolved.clipWindows.find((w) => w.clipId === 'clip-b');
    const windowC = resolved.clipWindows.find((w) => w.clipId === 'clip-c');
    expect(windowA).toMatchObject({ resolvedStart: 0, resolvedEnd: 3 });
    expect(windowB).toMatchObject({ resolvedStart: 2, resolvedEnd: 4 });
    expect(windowC?.resolvedStart).toBeCloseTo(3.1, 5);
    expect(windowC?.resolvedEnd).toBeCloseTo(5.1, 5);
  });

  it('chain opacity: middle clip fades in then fades out', () => {
    const track = createTrack(); // A(0,3), B(3,2), C(5,2)
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 },
      { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 1 },
    ];
    // t2 clamped to 0.9. T1 active: [2, 3), T2 active: [3.1, 4.0)
    expect(getClipOpacityMultiplier(track, 'clip-b', 2.0)).toBeCloseTo(0, 5);   // T1 start
    expect(getClipOpacityMultiplier(track, 'clip-b', 2.5)).toBeCloseTo(0.5, 5); // T1 mid
    expect(getClipOpacityMultiplier(track, 'clip-b', 2.99)).toBeCloseTo(0.99, 1); // T1 near end
    expect(getClipOpacityMultiplier(track, 'clip-b', 3.05)).toBeCloseTo(1, 5);  // gap between T1 and T2
    expect(getClipOpacityMultiplier(track, 'clip-b', 3.55)).toBeCloseTo(0.5, 1); // T2 mid
  });

  it('getChainAwareMaxDuration: isolated transition (no neighbor)', () => {
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
      transitions: [
        { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      ],
    };
    // No neighbor, so chain-aware max = base max = min(3, 2) - 0.1 = 1.9
    expect(getChainAwareMaxDuration(track, 't1')).toBe(1.9);
  });

  it('getChainAwareMaxDuration: transitionId not found returns 0', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    expect(getChainAwareMaxDuration(track, 'non-existent')).toBe(0);
  });

  it('getChainAwareMaxDuration: both sides have neighbors', () => {
    // D(0,4) -> E(4,3) -> F(7,2) -> G(9,5)
    const track: Track = {
      id: 'track-1',
      type: 'video',
      order: 0,
      clips: [
        createClip('d', 0, 4),
        createClip('e', 4, 3),
        createClip('f', 7, 2),
        createClip('g', 9, 5),
      ],
      transitions: [
        { id: 't1', fromClipId: 'd', toClipId: 'e', type: 'fade', duration: 1 },
        { id: 't2', fromClipId: 'e', toClipId: 'f', type: 'fade', duration: 0.5 },
        { id: 't3', fromClipId: 'f', toClipId: 'g', type: 'fade', duration: 0.5 },
      ],
    };
    // t2: fromClip=E(dur=3), toClip=F(dur=2)
    // E has incoming t1(dur=1), so E budget = 3-1 = 2
    // F has outgoing t3(dur=0.5), so F budget = 2-0.5 = 1.5
    // base max = min(3, 2) = 2
    // chain max = min(2, 2, 1.5) - 0.1 = 1.4
    expect(getChainAwareMaxDuration(track, 't2')).toBe(1.4);
  });

  // --- getExistingTransitionCount ---

  it('getExistingTransitionCount returns 0 for empty video track', () => {
    const track: Track = { id: 'video-empty', type: 'video', clips: [], order: 0 };
    expect(getExistingTransitionCount(track)).toBe(0);
  });

  it('getExistingTransitionCount returns count of valid transitions', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    expect(getExistingTransitionCount(track)).toBe(1);
  });

  it('getExistingTransitionCount excludes invalid transitions', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      { id: 't2', fromClipId: 'clip-a', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
    ];
    expect(getExistingTransitionCount(track)).toBe(1);
  });

  // --- getAddableTransitionCount ---

  it('getAddableTransitionCount returns 0 for non-video track', () => {
    const track: Track = { id: 'audio-1', type: 'audio', clips: [], order: 0 };
    expect(getAddableTransitionCount(track)).toBe(0);
  });

  it('getAddableTransitionCount returns 0 for single clip', () => {
    const track: Track = {
      id: 'track-1', type: 'video', order: 0,
      clips: [createClip('clip-a', 0, 3)],
    };
    expect(getAddableTransitionCount(track)).toBe(0);
  });

  it('getAddableTransitionCount returns count of addable cut points', () => {
    const track = createTrack();
    expect(getAddableTransitionCount(track)).toBe(2);
  });

  it('getAddableTransitionCount excludes cut points with existing transitions', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
    ];
    expect(getAddableTransitionCount(track)).toBe(1);
  });

  it('getAddableTransitionCount returns 0 when all cut points have transitions', () => {
    const track = createTrack();
    track.transitions = [
      { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
      { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
    ];
    expect(getAddableTransitionCount(track)).toBe(0);
  });

  it('getAddableTransitionCount skips non-adjacent clips with gaps', () => {
    const track: Track = {
      id: 'track-1', type: 'video', order: 0,
      clips: [createClip('clip-a', 0, 3), createClip('clip-b', 5, 2)],
    };
    expect(getAddableTransitionCount(track)).toBe(0);
  });

  describe('getClipAudioFade (equal-power crossfade)', () => {
    function buildPlans() {
      const track: Track = {
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 3)],
        transitions: [{ id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 1 }],
      };
      return resolveTrackTimeline(track).transitionPlans;
    }

    it('returns 1 outside transition region', () => {
      const plans = buildPlans();
      expect(getClipAudioFade(plans, 'clip-a', 0)).toBe(1);
      expect(getClipAudioFade(plans, 'clip-b', 4)).toBe(1);
    });

    it('fromClip fades out with cos curve', () => {
      const plans = buildPlans();
      const fade = getClipAudioFade(plans, 'clip-a', 2.5);
      // progress = 0.5, cos(0.5 * PI/2) = cos(PI/4) ≈ 0.707
      expect(fade).toBeCloseTo(Math.cos(0.5 * Math.PI / 2), 6);
    });

    it('toClip fades in with sin curve', () => {
      const plans = buildPlans();
      const fade = getClipAudioFade(plans, 'clip-b', 2.5);
      // progress = 0.5, sin(0.5 * PI/2) = sin(PI/4) ≈ 0.707
      expect(fade).toBeCloseTo(Math.sin(0.5 * Math.PI / 2), 6);
    });

    it('energy is preserved: from^2 + to^2 ≈ 1', () => {
      const plans = buildPlans();
      for (const progress of [0.0, 0.25, 0.5, 0.75, 0.99]) {
        const time = 2.0 + progress;
        const fromFade = getClipAudioFade(plans, 'clip-a', time);
        const toFade = getClipAudioFade(plans, 'clip-b', time);
        expect(fromFade ** 2 + toFade ** 2).toBeCloseTo(1, 5);
      }
    });

    it('at transition start, fromClip is full and toClip is silent', () => {
      const plans = buildPlans();
      expect(getClipAudioFade(plans, 'clip-a', 2.0)).toBeCloseTo(1, 6);
      expect(getClipAudioFade(plans, 'clip-b', 2.0)).toBeCloseTo(0, 6);
    });

    it('returns 1 for unrelated clip', () => {
      const plans = buildPlans();
      expect(getClipAudioFade(plans, 'clip-c', 2.5)).toBe(1);
    });
  });

  describe('clampedIds propagation', () => {
    it('resolveTrackTimeline returns clampedIds for over-budget transitions', () => {
      const track: Track = {
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 1), createClip('clip-b', 1, 1)],
        transitions: [{ id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 5 }],
      };
      const resolved = resolveTrackTimeline(track);
      expect(resolved.clampedIds.has('t1')).toBe(true);
      expect(resolved.transitionPlans[0].duration).toBeLessThan(5);
    });

    it('resolveTrackTimeline returns empty clampedIds when no clamping needed', () => {
      const track: Track = {
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 3)],
        transitions: [{ id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 }],
      };
      const resolved = resolveTrackTimeline(track);
      expect(resolved.clampedIds.size).toBe(0);
    });
  });

  describe('normalizeTimelineTracks skip-normalize semantics', () => {
    it('normalizeTimelineTracks returns referentially stable clips when no transitions change', () => {
      const track: Track = {
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 2)],
        transitions: [{ id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 }],
      };
      const normalized1 = normalizeTimelineTracks([track]);
      const normalized2 = normalizeTimelineTracks(normalized1);
      expect(normalized2[0].transitions).toEqual(normalized1[0].transitions);
    });

    // 阶段 2-B 清理：legacy clip.transition 字段已删除，对应 test 一并删除。
  });

  describe('batchChainAwareMaxDurations', () => {
    it('returns empty map for track with no transitions', () => {
      const track = normalizeTrackTransitions({
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 3)],
      });
      const result = batchChainAwareMaxDurations(track);
      expect(result.size).toBe(0);
    });

    it('matches individual getChainAwareMaxDuration for single transition', () => {
      const rawTrack: Track = {
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 3)],
        transitions: [{ id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 }],
      };
      const normalized = normalizeTrackTransitions(rawTrack);
      const batchResult = batchChainAwareMaxDurations(normalized);
      const singleResult = getChainAwareMaxDuration(rawTrack, 't1');

      expect(batchResult.get('t1')).toBeCloseTo(singleResult, 9);
    });

    it('matches individual results for chained transitions (A→B→C)', () => {
      const rawTrack: Track = {
        id: 'track-1', type: 'video', order: 0,
        clips: [
          createClip('clip-a', 0, 3),
          createClip('clip-b', 3, 3),
          createClip('clip-c', 6, 3),
        ],
        transitions: [
          { id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 },
          { id: 't2', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'fade', duration: 0.5 },
        ],
      };
      const normalized = normalizeTrackTransitions(rawTrack);
      const batchResult = batchChainAwareMaxDurations(normalized);

      expect(batchResult.get('t1')).toBeCloseTo(getChainAwareMaxDuration(rawTrack, 't1'), 9);
      expect(batchResult.get('t2')).toBeCloseTo(getChainAwareMaxDuration(rawTrack, 't2'), 9);
    });

    it('returns 0 for transitions with non-adjacent clips', () => {
      const track = normalizeTrackTransitions({
        id: 'track-1', type: 'video', order: 0,
        clips: [createClip('clip-a', 0, 3), createClip('clip-b', 3, 3)],
        transitions: [{ id: 't1', fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', duration: 0.5 }],
      });
      // Force a non-video track type
      const audioTrack: Track = { ...track, type: 'audio' };
      const result = batchChainAwareMaxDurations(audioTrack);
      expect(result.get('t1')).toBe(0);
    });
  });
});
