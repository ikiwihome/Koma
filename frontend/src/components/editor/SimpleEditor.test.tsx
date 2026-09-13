import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleEditor } from './SimpleEditor';

const messageErrorMock = vi.fn();
const loadEpisodeTimelineMock = vi.fn();
const saveEpisodeTimelineMock = vi.fn();

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: (...args: unknown[]) => messageErrorMock(...args),
      },
    }),
  },
}));

vi.mock('./SimpleTimeline', () => ({
  SimpleTimeline: () => <div data-testid="simple-timeline" />,
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
    importFiles: vi.fn(),
    refreshAssets: vi.fn(),
  }),
}));

vi.mock('../../services/uploadService', () => ({
  uploadFiles: vi.fn(),
}));

vi.mock('../../store/projectStore', () => ({
  loadEpisodeTimeline: (...args: unknown[]) => loadEpisodeTimelineMock(...args),
  saveEpisodeTimeline: (...args: unknown[]) => saveEpisodeTimelineMock(...args),
}));

vi.mock('../../features/transition/editor', () => ({
  useTransitionHandlers: () => ({
    handleSelectTransition: vi.fn(),
    handleAddTransition: vi.fn(),
    handleUpdateTransitionDuration: vi.fn(),
    handleDeleteSelectedTransition: vi.fn(),
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
  getShotCurrentImageSource: vi.fn(() => null),
  getShotCurrentVideoSource: vi.fn(() => null),
  getShotCurrentAudioAsset: vi.fn(() => undefined),
  getShotCurrentAudioSource: vi.fn(() => null),
}));

describe('SimpleEditor incompatible timeline handling', () => {
  beforeEach(() => {
    messageErrorMock.mockReset();
    loadEpisodeTimelineMock.mockReset();
    saveEpisodeTimelineMock.mockReset();
  });

  it('blocks fallback initialization and autosave when episode timeline version is unsupported', async () => {
    loadEpisodeTimelineMock.mockRejectedValue(new Error('Unsupported timeline version: 99'));

    render(
      <SimpleEditor
        projectId="project-1"
        episodeId="episode-1"
        shots={[
          {
            id: 'shot-1',
            scriptContent: 'scene 1',
            duration: 3,
            characters: [],
          } as any,
        ]}
      />
    );

    await waitFor(() => {
      expect(messageErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'timeline-version-incompatible',
        })
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });

    expect(saveEpisodeTimelineMock).not.toHaveBeenCalled();
  });
});
