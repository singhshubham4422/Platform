import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tauriConf from './src-tauri/tauri.conf.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Local dev reads the single workspace-level .env (at the repository root). CI uses real env vars.
  envDir: '../..',
  // `pnpm preview` enforces the same Content-Security-Policy as the desktop app.
  preview: {
    port: 1420,
    headers: { 'Content-Security-Policy': tauriConf.app.security.csp },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/monaco-editor/')) return 'monaco-editor';
          if (id.includes('/node_modules/@monaco-editor/react/')) return 'monaco-react';
        },
      },
    },
  },
  test: {
    // Tests must not depend on the developer's root .env (envDir above): pin the offline-first
    // settings to "unset"; tests that need them stub them explicitly with vi.stubEnv.
    env: {
      VITE_OFFLINE_FIRST: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_FUNCTIONS_URL: '',
      VITE_LANG_PACKS_BASE_URL: '',
    },
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'tests/**/*.spec.{ts,tsx}'],
    exclude: ['tests/foundation.test.mjs', '**/node_modules/**', '**/dist/**'],
  },
});
