import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['kkrpc'],
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      'node:stream': 'stream-browserify',
      'node:buffer': 'buffer',
      'node:util': 'util',
    },
  },
  build: {
    rollupOptions: {
      external: ['node:stream', 'node:buffer', 'node:util'],
    },
  },
})
