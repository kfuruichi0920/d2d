import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['backend/**/*.test.ts', 'electron/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node'
  }
})
