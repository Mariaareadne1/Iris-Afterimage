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
    // three.js alone is ~580 kB minified (147 kB gzipped)
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // vendors change rarely: cache them apart from the app code
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
});
