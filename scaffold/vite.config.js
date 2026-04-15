import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, extname } from 'path';

function copyAssetsPlugin() {
  return {
    name: 'copy-assets',
    closeBundle() {
      const out = 'dist-electron';
      const dirs = ['textures', 'levels', 'models', 'sounds'];
      for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        const dest = join(out, dir);
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        for (const f of readdirSync(dir)) {
          copyFileSync(join(dir, f), join(dest, f));
        }
      }
      for (const f of readdirSync('.')) {
        if (['.fbx', '.glb', '.gltf'].includes(extname(f).toLowerCase())) {
          copyFileSync(f, join(out, f));
        }
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [copyAssetsPlugin()],
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
  },
});
