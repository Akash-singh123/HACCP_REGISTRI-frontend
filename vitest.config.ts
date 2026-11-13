import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Configurazione dei test unitari/integration (Vitest).
// Gli E2E (Playwright) vivono in ./e2e e sono eseguiti a parte.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/lib/**'],
    },
  },
});
