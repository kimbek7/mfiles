import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      // Dependencies are bundled: file-type is ESM-only and the main process runs as CJS.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/main/worker.ts'),
        },
      },
    },
  },
  preload: {
    build: { externalizeDeps: false },
  },
  renderer: {
    plugins: [react()],
  },
})
