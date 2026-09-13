// Test-only stub for the `electron` module so vitest can resolve cross-process
// integration tests (e.g. delegate.test.ts) that exercise main-process code
// while mocking `electron.webContents` via `vi.mock('electron')`.

export const webContents = {
  fromId: (_: number) => null,
};

export const ipcMain = {
  handle: () => {},
};

export default { webContents, ipcMain };
