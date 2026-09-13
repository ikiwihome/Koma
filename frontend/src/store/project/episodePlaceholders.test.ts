import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../../types';

const loadEpisodeShotsMock = vi.fn();

vi.mock('./analysis', () => ({
  loadEpisodeShots: (...args: unknown[]) => loadEpisodeShotsMock(...args),
}));

describe('findRemovableDefaultEpisodeIds', () => {
  beforeEach(() => {
    loadEpisodeShotsMock.mockReset();
  });

  it('returns empty when placeholder already has shots', async () => {
    loadEpisodeShotsMock.mockResolvedValueOnce([{ id: 'shot-1' }]);

    const { findRemovableDefaultEpisodeIds } = await import('./episodePlaceholders');
    const episodes: Episode[] = [{
      id: 'ep-1',
      projectId: 'project-1',
      number: 1,
      title: '第1集',
      scriptText: '',
      status: 'draft',
      hasAnalysis: false,
      createdAt: 1,
      updatedAt: 1,
    }];

    await expect(findRemovableDefaultEpisodeIds('project-1', episodes)).resolves.toEqual([]);
  });

  it('returns id for empty default placeholder', async () => {
    loadEpisodeShotsMock.mockResolvedValueOnce([]);

    const { findRemovableDefaultEpisodeIds } = await import('./episodePlaceholders');
    const episodes: Episode[] = [{
      id: 'ep-1',
      projectId: 'project-1',
      number: 1,
      title: '第1集',
      scriptText: '',
      status: 'draft',
      hasAnalysis: false,
      createdAt: 1,
      updatedAt: 1,
    }];

    await expect(findRemovableDefaultEpisodeIds('project-1', episodes)).resolves.toEqual(['ep-1']);
  });

  it('skips excluded placeholder ids', async () => {
    const { findRemovableDefaultEpisodeIds } = await import('./episodePlaceholders');
    const episodes: Episode[] = [{
      id: 'ep-1',
      projectId: 'project-1',
      number: 1,
      title: '第1集',
      scriptText: '',
      status: 'draft',
      hasAnalysis: false,
      createdAt: 1,
      updatedAt: 1,
    }];

    await expect(findRemovableDefaultEpisodeIds('project-1', episodes, {
      excludeEpisodeIds: ['ep-1'],
    })).resolves.toEqual([]);
    expect(loadEpisodeShotsMock).not.toHaveBeenCalled();
  });
});
