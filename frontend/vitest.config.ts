import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Cross-process integration tests import main-process code that has
      // `import { webContents } from 'electron'`. In vitest those tests stub
      // the module with `vi.mock('electron', ...)`, but vite needs to be able
      // to resolve the bare specifier at transform time first.
      electron: resolve(__dirname, './src/test/electron-stub.ts'),
    },
  },
});
