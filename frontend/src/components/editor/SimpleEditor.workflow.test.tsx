import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleEditor } from './SimpleEditor';
import { MediaType } from '../../types/editor';

const messageErrorMock = vi.fn();
const messageWarningMock = vi.fn();

type EpisodeTimelinePayload = {
  version: number;
  createdAt: number;
  updatedAt?: number;
  tracks: Array<{
    id: string;
    type: string;
    order: number;
    isMainTrack?: boolean;
    clips: Array<Record<string, unknown>>;
    transitions?: Array<Record<string, unknown>>;
  }>;
};

let persistedTimeline: EpisodeTimelinePayload | null = null;

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: (...args: unknown[]) => messageErrorMock(...args),
        warning: (...args: unknown[]) => messageWarningMock(...args),
      },
    }),
  },
}));

vi.mock('./SimpleTimeline', () => ({
  SimpleTimeline: (props: any) => {
    const firstClip = props.tracks[0]?.clips[0];
    const transitions = props.tracks[0]?.transitions ?? [];

    return (
      <div>
        <div data-testid="timeline-clip-name">{firstClip?.name ?? 'no-clip'}</div>
        <div data-testid="timeline-clip-src">{firstClip?.src ?? 'no-src'}</div>
        <div data-testid="timeline-transition-count">{transitions.length}</div>
        <button
          type="button"
          data-testid="rename-first-clip"
          onClick={() => {
            if (firstClip) {
              props.onUpdateClip(firstClip.id, { name: 'Edited clip name' });
            }
          }}
        >
          Rename first clip
        </button>
      </div>
    );
  },
}));

vi.mock('./SimplePlayer', () => ({
  SimplePlayer: () => <div data-testid="simple-player" />,
}));

vi.mock('./SimplePropertiesPanel', () => ({
  SimplePropertiesPanel: () => <div data-testid="simple-properties" />,
}));

vi.mock('./SimpleAssetPanel', () => ({
  SimpleAssetPanel: () => <div data-testid="simple-asset-panel" />,
}));

vi.mock('./SimpleExportDialog', () => ({
  SimpleExportDialog: () => null,
}));

vi.mock('./useAssets', () => ({
  useAssets: () => ({
    assets: [],
    loading: false,
    addUploadedAsset: vi.fn(),
  }),
}));

vi.mock('../../services/uploadService', () => ({
  uploadFiles: vi.fn(),
}));

vi.mock('../../store/projectStore', () => ({
  loadEpisodeTimeline: vi.fn(async () => persistedTimeline),
  saveEpisodeTimeline: vi.fn(async (_projectId: string, _episodeId: string, data: EpisodeTimelinePayload) => {
    persistedTimeline = {
      ...data,
      updatedAt: 200,
      tracks: data.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip })),
        transitions: track.transitions?.map((t) => ({ ...t })),
      })),
    };
  }),
}));

vi.mock('../../features/transition/editor', () => ({
  useTransitionHandlers: () => ({
    handleSelectTransition: vi.fn(),
    handleAddTransition: vi.fn(),
    handleUpdateTransitionDuration: vi.fn(),
    handleDeleteTransition: vi.fn(),
    handleAddAllTransitions: vi.fn(),
    handleDeleteAllTransitions: vi.fn(),
  }),
}));

vi.mock('../../features/transition/hooks/useDefaultTransition', () => ({
  useDefaultTransition: () => ({ defaultDuration: 0.5 }),
}));

vi.mock('../../store/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../utils/mediaSelectors', () => ({
  getShotCurrentImageSource: vi.fn((shot: any) => {
    const images = shot?.media?.images || [];
    return images[shot?.media?.currentImageIndex ?? 0]?.localPath ?? null;
  }),
  getShotCurrentVideoSource: vi.fn((shot: any) => {
    const videos = shot?.media?.videos || [];
    return videos[shot?.media?.currentVideoIndex ?? 0]?.localPath ?? null;
  }),
  getShotCurrentAudioAsset: vi.fn((shot: any) => {
    const audios = shot?.media?.audios || [];
    return audios[shot?.media?.currentAudioIndex ?? 0];
  }),
  getShotCurrentAudioSource: vi.fn((shot: any) => {
    const audios = shot?.media?.audios || [];
    return audios[shot?.media?.currentAudioIndex ?? 0]?.localPath ?? null;
  }),
}));

function createPersistedTimeline(overrides?: Partial<EpisodeTimelinePayload>): EpisodeTimelinePayload {
  return {
    version: 1,
    createdAt: 100,
    updatedAt: 100,
    tracks: [
      {
        id: 'video-main',
        type: 'video',
        order: 0,
        isMainTrack: true,
        clips: [
          {
            id: 'clip-1',
            assetId: 'asset-1',
            trackId: 'video-main',
            start: 0,
            duration: 3,
            offset: 0,
            sourceDuration: 3,
            name: 'Loaded clip name',
            type: MediaType.VIDEO,
            src: 'loaded.mp4',
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            opacity: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createTimelineWithTransitions(): EpisodeTimelinePayload {
  return createPersistedTimeline({
    tracks: [
      {
        id: 'video-main',
        type: 'video',
        order: 0,
        isMainTrack: true,
        clips: [
          {
            id: 'clip-1',
            assetId: 'asset-1',
            trackId: 'video-main',
            start: 0,
            duration: 3,
            offset: 0,
            name: 'Clip A',
            type: MediaType.VIDEO,
            src: 'a.mp4',
            x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
          },
          {
            id: 'clip-2',
            assetId: 'asset-2',
            trackId: 'video-main',
            start: 3,
            duration: 3,
            offset: 0,
            name: 'Clip B',
            type: MediaType.VIDEO,
            src: 'b.mp4',
            x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
          },
        ],
        transitions: [
          {
            id: 't-1',
            fromClipId: 'clip-1',
            toClipId: 'clip-2',
            type: 'fade',
            duration: 0.5,
          },
        ],
      },
    ],
  });
}

describe('SimpleEditor supported workflow evidence', () => {
  beforeEach(() => {
    persistedTimeline = createPersistedTimeline();
    messageErrorMock.mockReset();
    messageWarningMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves the supported load save reload workflow for episode timelines', async () => {
    const firstRender = render(
      <SimpleEditor projectId="project-1" episodeId="episode-1" shots={[]} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('timeline-clip-name').textContent).toBe('Loaded clip name');
    });

    fireEvent.click(screen.getByTestId('rename-first-clip'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-clip-name').textContent).toBe('Edited clip name');
    });

    await waitFor(
      () => {
        expect(persistedTimeline?.tracks[0]?.clips[0]?.name).toBe('Edited clip name');
      },
      { timeout: 2000 }
    );

    firstRender.unmount();

    render(<SimpleEditor projectId="project-1" episodeId="episode-1" shots={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-clip-name').textContent).toBe('Edited clip name');
    });

    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('preserves transition data through load → save → reload cycle', async () => {
    persistedTimeline = createTimelineWithTransitions();

    const firstRender = render(
      <SimpleEditor projectId="project-1" episodeId="episode-1" shots={[]} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('timeline-transition-count').textContent).toBe('1');
    });

    // Trigger a save by editing a clip
    fireEvent.click(screen.getByTestId('rename-first-clip'));

    await waitFor(
      () => {
        expect(persistedTimeline?.tracks[0]?.transitions).toBeDefined();
        expect(persistedTimeline!.tracks[0].transitions!.length).toBe(1);
        expect(persistedTimeline!.tracks[0].transitions![0].type).toBe('fade');
        expect(persistedTimeline!.tracks[0].transitions![0].duration).toBe(0.5);
      },
      { timeout: 2000 }
    );

    firstRender.unmount();

    // Reload and verify transitions survive
    render(<SimpleEditor projectId="project-1" episodeId="episode-1" shots={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-transition-count').textContent).toBe('1');
    });

    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('handles timeline with no transitions gracefully', async () => {
    persistedTimeline = createPersistedTimeline();

    render(
      <SimpleEditor projectId="project-1" episodeId="episode-1" shots={[]} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('timeline-transition-count').textContent).toBe('0');
    });

    expect(messageErrorMock).not.toHaveBeenCalled();
  });

  it('updates an existing shot clip source to the selected storyboard video version', async () => {
    persistedTimeline = createPersistedTimeline({
      tracks: [
        {
          id: 'video-main',
          type: 'video',
          order: 0,
          isMainTrack: true,
          clips: [
            {
              id: 'clip-shot-1',
              assetId: 'asset-shot-1',
              trackId: 'video-main',
              start: 0,
              duration: 3,
              offset: 0,
              sourceDuration: 3,
              name: 'Loaded clip name',
              type: MediaType.VIDEO,
              src: '/versions/v1/video.mp4',
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              opacity: 1,
            },
          ],
        },
      ],
    });

    render(
      <SimpleEditor
        projectId="project-1"
        episodeId="episode-1"
        shots={[
          {
            id: 'shot-1',
            scriptLines: [],
            duration: 3,
            characters: [],
            media: {
              videos: [
                { kind: 'video', localPath: '/versions/v1/video.mp4', createdAt: 1 },
                { kind: 'video', localPath: '/versions/v2/video.mp4', createdAt: 2 },
              ],
              currentVideoIndex: 1,
            },
          } as any,
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('timeline-clip-src').textContent).toBe('/versions/v2/video.mp4');
    });
  });
});
