import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is relative so the static build works from any sub-path
// (GitHub Pages project sites, portfolio sub-folders, iframes).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5233,
  },
  preview: {
    port: Number(process.env.PORT) || 4233,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
