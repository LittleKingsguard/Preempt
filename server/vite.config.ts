import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDockerContainer = fs.existsSync('/index.html');
const rootDir = isDockerContainer ? '/' : path.resolve(__dirname, '..');
const outDir = isDockerContainer ? '/dist' : path.resolve(__dirname, '../dist');

export default defineConfig({
  root: rootDir,
  build: {
    outDir: outDir,
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
