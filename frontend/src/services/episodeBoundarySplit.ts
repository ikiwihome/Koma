import type { EpisodeBoundary } from './episodeBoundaryDetector';

export interface EpisodeBoundarySegment {
  episodeNumber: number;
  title: string;
  scriptText: string;
}

export function partitionScriptByEpisodeBoundaries(
  script: string,
  boundaries: EpisodeBoundary[],
): EpisodeBoundarySegment[] {
  if (!script.trim() || boundaries.length === 0) {
    return [];
  }

  const ordered = [...boundaries]
    .filter(boundary => boundary.start >= 0 && boundary.start < script.length)
    .sort((a, b) => a.start - b.start);

  return ordered
    .map((boundary, index) => {
      const next = ordered[index + 1];
      const start = index === 0 ? 0 : boundary.start;
      const end = next ? next.start : script.length;
      const scriptText = script.slice(start, end).trim();
      const episodeNumber = boundary.episodeNumber ?? index + 1;
      const fallbackTitle = `第${episodeNumber}集`;

      return {
        episodeNumber,
        title: boundary.title.trim() || fallbackTitle,
        scriptText,
      };
    })
    .filter(segment => segment.scriptText.length > 0);
}
