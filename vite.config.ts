/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * @mediapipe/tasks-vision ends with a sourceMappingURL pointing at a file it
 * does not ship (vision_bundle_mjs.js.map), so the dev server logs a noisy
 * "Failed to load source map" error. Serve the bundle without that comment.
 */
function mediapipeSourcemapFix(): Plugin {
  return {
    name: 'mediapipe-sourcemap-fix',
    apply: 'serve',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!/@mediapipe[\\/]tasks-vision[\\/].+\.m?js$/.test(file)) return null;
      const code = readFileSync(file, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
      return { code, map: null };
    },
  };
}

// `npm run dev:https` serves over HTTPS with a self-signed certificate so
// phones on the same network are allowed to use their camera.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [mediapipeSourcemapFix(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
