import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Electron production loads the UI via `file://.../dist/index.html`, so asset URLs must be relative.
  base: mode === 'production' ? './' : '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
