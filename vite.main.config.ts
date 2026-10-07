import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

// Bundle every desktop runtime module and its metadata dependencies. This
// avoids leaving secondary services unbundled in a packaged pnpm checkout.
// Electron and FFmpeg stay external: FFmpeg must retain its native binary path.
export default defineConfig({
  build: {
    target: 'node18',
    outDir: resolve(__dirname, 'dist/main'),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: Object.fromEntries(['index', 'preload', 'metadata', 'scanner', 'queueManager', 'rendererService', 'ffmpegService']
        .map(name => [name, resolve(__dirname, `src/main/${name}.ts`)])),
      formats: ['cjs'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: ['electron', 'ffmpeg-static', ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
    },
  },
});
