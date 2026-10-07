import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

// Bundle metadata readers and their dependencies into the entry point. This
// avoids incomplete dependency collection when packaging a pnpm checkout.
// Electron and FFmpeg stay external: FFmpeg must retain its native binary path.
export default defineConfig({
  build: {
    target: 'node18',
    outDir: resolve(__dirname, 'dist/main'),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron', 'ffmpeg-static', ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
    },
  },
});
