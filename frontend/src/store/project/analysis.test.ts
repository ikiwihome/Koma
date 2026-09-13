import { beforeEach, describe, expect, it, vi } from 'vitest';

const batchLoadEpisodeTimelineMock = vi.fn();

vi.mock('../../services/electronService', () => ({
  electronService: {
    isElectron: vi.fn(() => true),
  },
  batchApi: {
    loadEpisodeTimeline: (...args: unknown[]) => batchLoadEpisodeTimelineMock(...args),
  },
}));

vi.mock('./core', () => ({
  getProjectPath: vi.fn(),
}));

vi.mock('./mediaUrlRemap', () => ({
  remapTimelineClipSourcesToLocal: vi.fn(async (_projectPath: string, timeline: unknown) => ({ timeline })),
}));

vi.mock('./episodes', () => ({
  saveEpisode: vi.fn(),
}));

vi.mock('./mediaState', () => ({
  normalizeShotsMediaState: vi.fn((shots: unknown) => shots),
}));

describe('loadEpisodeTimeline future-version boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    batchLoadEpisodeTimelineMock.mockReset();
  });

  it('rethrows unsupported future timeline versions instead of swallowing them as null', async () => {
    batchLoadEpisodeTimelineMock.mockResolvedValue({ version: 99, tracks: [] });

    const { loadEpisodeTimeline } = await import('./analysis');

    await expect(loadEpisodeTimeline('project-1', 'episode-1')).rejects.toThrow('Unsupported timeline version: 99');
  });

  it('still returns null for non-version-related read failures', async () => {
    batchLoadEpisodeTimelineMock.mockRejectedValue(new Error('IO failed'));

    const { loadEpisodeTimeline } = await import('./analysis');

    await expect(loadEpisodeTimeline('project-1', 'episode-1')).resolves.toBeNull();
  });
});
