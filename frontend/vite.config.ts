import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    root: '.',
    server: {
      port: 5173,
      host: env.VITE_DEV_HOST || '127.0.0.1',
    },
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            // 独立大库，和 React 生态无交叉依赖，可安全拆分
            if (id.includes('xgplayer')) return 'vendor-player';
            if (id.includes('codemirror') || id.includes('@codemirror') || id.includes('@lezer'))
              return 'vendor-editor';
            if (id.includes('@google/genai')) return 'vendor-ai';

            // 其余所有 node_modules 放同一个 chunk，避免循环依赖
            return 'vendor-lib';
          },
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@komastudio/plugin-sdk': path.resolve(__dirname, '../packages/plugin-sdk/src/index.ts'),
      },
    },
  };
});
