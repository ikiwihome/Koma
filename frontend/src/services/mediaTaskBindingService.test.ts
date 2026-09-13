import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bindOwnerRefMedia: vi.fn(),
  appendRendererLog: vi.fn(),
  isElectron: vi.fn(() => true),
}));

vi.mock('../services/electronService', () => ({
  electronService: {
    isElectron: mocks.isElectron,
    project: {
      bindOwnerRefMedia: mocks.bindOwnerRefMedia,
    },
    diagnostics: {
      appendRendererLog: mocks.appendRendererLog,
    },
  },
}));

import { bindCompletedMediaTask, bindOwnerRefMedia } from './mediaTaskBindingService';

describe('mediaTaskBindingService', () => {
  beforeEach(() => {
    mocks.bindOwnerRefMedia.mockReset();
    mocks.appendRendererLog.mockReset();
    mocks.isElectron.mockReset();
    mocks.isElectron.mockReturnValue(true);
    mocks.bindOwnerRefMedia.mockResolvedValue({ success: true });
    mocks.appendRendererLog.mockResolvedValue({ success: true });
  });

  it('delegates owner media binding to electron project service', async () => {
    const ownerRef = {
      projectId: 'project-1',
      ownerType: 'shot-version',
      ownerId: 'shot-1',
      slot: 'video',
      versionId: 'v1',
      episodeId: 'episode-1',
    } as const;
    const asset = {
      kind: 'video',
      localPath: '/tmp/generated.mp4',
      remoteUrl: 'https://cdn.example.com/generated.mp4',
      createdAt: 1,
    } as const;

    await bindOwnerRefMedia('project-1', ownerRef, asset);

    expect(mocks.bindOwnerRefMedia).toHaveBeenCalledWith('project-1', ownerRef, asset);
  });

  it('bindCompletedMediaTask forwards valid owner refs and ignores mismatched projects', async () => {
    const asset = {
      kind: 'image',
      localPath: '/tmp/generated.png',
      createdAt: 2,
    } as const;

    await bindCompletedMediaTask('project-1', {
      id: 'task-1',
      type: 'tti',
      targetType: 'shot',
      targetId: 'shot-1',
      status: 'completed',
      progress: 100,
      createdAt: 1,
      updatedAt: 2,
      ownerRef: {
        projectId: 'project-1',
        ownerType: 'shot',
        ownerId: 'shot-1',
        slot: 'image',
        episodeId: 'episode-1',
      },
    } as any, asset);

    await bindCompletedMediaTask('project-1', {
      id: 'task-2',
      type: 'tti',
      targetType: 'shot',
      targetId: 'shot-2',
      status: 'completed',
      progress: 100,
      createdAt: 1,
      updatedAt: 2,
      ownerRef: {
        projectId: 'project-other',
        ownerType: 'shot',
        ownerId: 'shot-2',
        slot: 'image',
      },
    } as any, asset);

    expect(mocks.bindOwnerRefMedia).toHaveBeenCalledTimes(1);
    expect(mocks.bindOwnerRefMedia).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        projectId: 'project-1',
        ownerId: 'shot-1',
      }),
      asset,
    );
  });
});
