import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'electron/main')
    }
  }
})
