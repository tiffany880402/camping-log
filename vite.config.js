import { defineConfig } from 'vite';

// base './' makes the build work under any repo name, e.g. https://<user>.github.io/camping-log/
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
});
