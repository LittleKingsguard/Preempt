import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: false,
    // Disable minification by default for development environments
    minify: false,
    // Optional: generate sourcemaps for easier debugging
    sourcemap: true,
  },
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
  },
});
