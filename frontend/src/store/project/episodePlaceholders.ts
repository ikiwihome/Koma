import type { Episode } from '../../types';
import { loadEpisodeShots } from './analysis';

function isDefaultEpisodeCandidate(episode: Episode): boolean {
  return episode.number === 1
    && episode.title === '第1集'
    && episode.status === 'draft'
    && !episode.scriptText?.trim()
    && !episode.hasAnalysis;
}

export async function findRemovableDefaultEpisodeIds(
  projectId: string,
  episodes: Episode[],
  options?: { excludeEpisodeIds?: string[] },
): Promise<string[]> {
  const excludedIds = new Set(options?.excludeEpisodeIds ?? []);
  const candidates = episodes.filter(episode => (
    !excludedIds.has(episode.id) && isDefaultEpisodeCandidate(episode)
  ));

  const removableIds: string[] = [];
  for (const episode of candidates) {
    const shots = await loadEpisodeShots(projectId, episode.id);
    if (shots.length === 0) {
      removableIds.push(episode.id);
    }
  }

  return removableIds;
}
