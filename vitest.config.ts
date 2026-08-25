import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    singleThread: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
