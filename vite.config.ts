import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Disable minification to retain code readability for debugging
    minify: false,
    // Optional: generate sourcemaps for easier debugging
    sourcemap: true,
  },
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
  },
});
