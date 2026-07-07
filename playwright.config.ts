import { defineConfig } from '@playwright/test'

/**
 * Electron E2E テスト設定（P0-4 骨格）。
 * 実行前に `npm run build` で out/ を生成しておくこと。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
