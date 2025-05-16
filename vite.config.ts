import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',                 // project root
  publicDir: 'public',       // unchanged
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': 'http://localhost:5500',
      '/chars': 'http://localhost:5500'
    }
  }
})
