import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpService } from './mcpService';

describe('mcpService.getConnections', () => {
  const listMock = vi.fn();

  beforeEach(() => {
    listMock.mockReset();
    (globalThis as any).window = {
      electronAPI: {
        chat: {
          mcp: {
            list: listMock,
          },
        },
      },
    };
  });

  it('returns connections from wrapped IPC payloads', async () => {
    listMock.mockResolvedValue({
      connections: [
        {
          name: 'server-a',
          transport: 'stdio',
          status: 'connected',
          tools: [],
          resources: [],
        },
      ],
    });

    await expect(mcpService.getConnections()).resolves.toEqual([
      expect.objectContaining({ name: 'server-a' }),
    ]);
  });

  it('keeps supporting direct array payloads', async () => {
    listMock.mockResolvedValue([
      {
        name: 'server-b',
        transport: 'sse',
        status: 'connected',
        tools: [],
        resources: [],
      },
    ]);

    await expect(mcpService.getConnections(false)).resolves.toEqual([
      expect.objectContaining({ name: 'server-b' }),
    ]);
    expect(listMock).toHaveBeenCalledWith(false);
  });
});
