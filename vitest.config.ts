import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // e2e/ はPlaywright専用のテストランナー対象（vitestのdefaultForConfig glob対象から除外）
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // テストが1本も無い状態でCIが緑になることを許さない（CLAUDE.md 不変条件5）
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
