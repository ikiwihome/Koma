import { beforeEach, describe, expect, it, vi } from 'vitest';

const exportToManjuDSLMock = vi.fn();
const importFromManjuDSLMock = vi.fn();
const validateManjuProjectMock = vi.fn();
const loadTimelineMock = vi.fn();
const loadProjectMock = vi.fn();
const getProjectPathMock = vi.fn();
const addRecentProjectMock = vi.fn();

const fsWriteFileMock = vi.fn();
const fsReadFileMock = vi.fn();
const fsExistsMock = vi.fn();
const projectCreateMock = vi.fn();
const rebuildIndexMock = vi.fn();
const batchSaveAllCharactersMock = vi.fn();
const batchSaveAllScenesMock = vi.fn();
const batchSaveAllShotsMock = vi.fn();

vi.mock('../../manju-dsl/protocol', () => ({
  exportToManjuDSL: (...args: unknown[]) => exportToManjuDSLMock(...args),
  importFromManjuDSL: (...args: unknown[]) => importFromManjuDSLMock(...args),
  validateManjuProject: (...args: unknown[]) => validateManjuProjectMock(...args),
}));

vi.mock('./timeline', () => ({
  loadTimeline: (...args: unknown[]) => loadTimelineMock(...args),
}));

vi.mock('./core', () => ({
  loadProject: (...args: unknown[]) => loadProjectMock(...args),
  getProjectPath: (...args: unknown[]) => getProjectPathMock(...args),
}));

vi.mock('../globalStore', () => ({
  addRecentProject: (...args: unknown[]) => addRecentProjectMock(...args),
}));

vi.mock('../../services/electronService', () => ({
  electronService: {
    isElectron: vi.fn(() => true),
    fs: {
      writeFile: (...args: unknown[]) => fsWriteFileMock(...args),
      readFile: (...args: unknown[]) => fsReadFileMock(...args),
      exists: (...args: unknown[]) => fsExistsMock(...args),
    },
    project: {
      create: (...args: unknown[]) => projectCreateMock(...args),
      rebuildIndex: (...args: unknown[]) => rebuildIndexMock(...args),
    },
  },
  batchApi: {
    saveAllCharacters: (...args: unknown[]) => batchSaveAllCharactersMock(...args),
    saveAllScenes: (...args: unknown[]) => batchSaveAllScenesMock(...args),
    saveAllShots: (...args: unknown[]) => batchSaveAllShotsMock(...args),
  },
}));

describe('project manju transition boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    exportToManjuDSLMock.mockReset();
    importFromManjuDSLMock.mockReset();
    validateManjuProjectMock.mockReset();
    loadTimelineMock.mockReset();
    loadProjectMock.mockReset();
    getProjectPathMock.mockReset();
    addRecentProjectMock.mockReset();
    fsWriteFileMock.mockReset();
    fsReadFileMock.mockReset();
    fsExistsMock.mockReset();
    projectCreateMock.mockReset();
    rebuildIndexMock.mockReset();
  });

  it('exports Manju without forwarding transition-bearing timeline payload', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    loadProjectMock.mockResolvedValue({
      id: 'project-1',
      title: 'Demo',
      genre: 'Drama',
      mode: 'drama',
      createdAt: 1,
      updatedAt: 1,
    });
    loadTimelineMock.mockResolvedValue({ version: 1, createdAt: 1, updatedAt: 1, tracks: [{ id: 'track-1', type: 'video', order: 0, clips: [], transitions: [] }] });
    getProjectPathMock.mockResolvedValue('/tmp/project-1');
    exportToManjuDSLMock.mockReturnValue({ version: 'manju-1' });

    const { exportProjectToManjuFile } = await import('./manju');
    const result = await exportProjectToManjuFile('project-1', [], [], []);

    expect(result).toBe('/tmp/project-1/exports/Demo.manju.json');
    expect(exportToManjuDSLMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project-1' }),
      [],
      [],
      []
    );
    expect(exportToManjuDSLMock.mock.calls[0]).toHaveLength(4);
    expect(warnSpy).toHaveBeenCalledWith(
      '[manju] Timeline round-trip is not supported for TimelineData-based transition projects yet. Timeline payload will be omitted.'
    );
  });

  it('imports Manju timeline payload without writing timeline.json', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    validateManjuProjectMock.mockReturnValue(true);
    fsReadFileMock.mockResolvedValue('{"version":"manju-1"}');
    importFromManjuDSLMock.mockReturnValue({
      project: {
        id: 'project-1',
        title: 'Imported',
        genre: 'Drama',
        mode: 'drama',
        createdAt: 1,
        updatedAt: 1,
      },
      characters: [],
      scenes: [],
      shots: [],
      timeline: { version: 1, tracks: [] },
    });
    getProjectPathMock.mockResolvedValue('/tmp/project-1');
    fsExistsMock.mockResolvedValue(false);
    projectCreateMock.mockResolvedValue(undefined);
    rebuildIndexMock.mockResolvedValue(undefined);
    addRecentProjectMock.mockResolvedValue(undefined);

    const { importProjectFromManjuFile } = await import('./manju');
    await importProjectFromManjuFile('/tmp/import.manju.json');

    expect(fsWriteFileMock.mock.calls.map((call) => call[0])).not.toContain('/tmp/project-1/timeline.json');
    expect(warnSpy).toHaveBeenCalledWith(
      '[manju] Timeline round-trip is not supported for TimelineData-based transition projects yet. Timeline payload will be omitted.'
    );
  });
});
