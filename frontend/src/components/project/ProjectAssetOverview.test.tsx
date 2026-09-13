import React from 'react';
import { App } from 'antd';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character, Prop, Scene } from '../../types';
import { ProjectAssetOverview, type ProjectAssetOverviewRef } from './ProjectAssetOverview';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);
vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})));

const {
  loadCharactersMock,
  loadScenesMock,
  loadPropsMock,
  getOrphanedAssetsMock,
  repairAssetEpisodeRefsMock,
} = vi.hoisted(() => ({
  loadCharactersMock: vi.fn(),
  loadScenesMock: vi.fn(),
  loadPropsMock: vi.fn(),
  getOrphanedAssetsMock: vi.fn(),
  repairAssetEpisodeRefsMock: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useTaskTransitions: vi.fn(),
}));

vi.mock('../../store/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../services/electronService', () => ({
  electronService: {
    fs: {
      remove: vi.fn(),
      toLocalUrl: (path: string) => path,
    },
  },
}));

vi.mock('../../store/projectStore', () => ({
  loadCharacters: (...args: unknown[]) => loadCharactersMock(...args),
  saveCharacters: vi.fn(),
  loadScenes: (...args: unknown[]) => loadScenesMock(...args),
  saveScenes: vi.fn(),
  loadProps: (...args: unknown[]) => loadPropsMock(...args),
  saveProps: vi.fn(),
  getOrphanedAssets: (...args: unknown[]) => getOrphanedAssetsMock(...args),
  repairAssetEpisodeRefs: (...args: unknown[]) => repairAssetEpisodeRefsMock(...args),
  listEpisodes: vi.fn(),
  removeAssetFromAnalysis: vi.fn(),
}));

const character: Character = {
  id: 'char-1',
  name: '阿宁',
  role: 'protagonist',
  prompt: 'young adventurer',
};

const scene: Scene = {
  id: 'scene-1',
  name: '地下宫殿',
  prompt: 'underground palace',
};

const prop: Prop = {
  id: 'prop-1',
  name: '青铜钥匙',
  prompt: 'bronze key',
};

function renderOverview(ref: React.RefObject<ProjectAssetOverviewRef | null>) {
  return render(
    <App>
      <ProjectAssetOverview ref={ref} projectId="project-1" />
    </App>,
  );
}

describe('ProjectAssetOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repairAssetEpisodeRefsMock.mockResolvedValue(undefined);
    loadCharactersMock.mockResolvedValue([character]);
    loadScenesMock.mockResolvedValue([scene]);
    loadPropsMock.mockResolvedValue([prop]);
    getOrphanedAssetsMock.mockResolvedValue({
      characters: [],
      scenes: [],
      props: [],
    });
  });

  it('刷新资产列表后保持当前角色/场景/道具 tab', async () => {
    const ref = React.createRef<ProjectAssetOverviewRef>();
    renderOverview(ref);

    const scenesTab = await screen.findByRole('tab', { name: /场景/ });
    fireEvent.click(scenesTab);
    expect(scenesTab).toHaveAttribute('aria-selected', 'true');

    await act(async () => {
      ref.current?.refresh();
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /场景/ })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByText('地下宫殿')).toBeInTheDocument();
  });
});
