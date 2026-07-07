import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// 4領域構成（sdd_directory §8）:
//   electron/main    … Electron Main (Gateway / Shell)
//   electron/preload … contextBridge 公開
//   backend/         … Local Backend（別プロセス。main ビルドの第2エントリとして
//                      out/main/backend.js へ出力し、utilityProcess.fork で起動する）
//   src/             … Renderer (React / TypeScript)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          backend: resolve(__dirname, 'backend/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html')
      }
    }
  }
})
