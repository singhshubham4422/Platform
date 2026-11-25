import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // A production build must never contain the test-only mock data source.
  if (command === 'build' && mode === 'production' && env.VITE_DATA_SOURCE === 'mock') {
    throw new Error('VITE_DATA_SOURCE=mock is only allowed in the test build mode');
  }
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
      css: false,
    },
  };
});
