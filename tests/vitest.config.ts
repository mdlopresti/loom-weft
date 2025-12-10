import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 30000,
    globals: false,
    environment: 'node',
  },
});
