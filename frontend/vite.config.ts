import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://localhost:24011';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 24010,
    host: '0.0.0.0',
    proxy: {
      // Proxy API requests to the Fastify backend
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      // Proxy /docs to backend swagger-ui
      '/docs': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 24010,
    host: '0.0.0.0',
    proxy: {
      // Proxy API requests to the Fastify backend in preview mode
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      // Proxy /docs to backend swagger-ui in preview mode
      '/docs': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
