import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/mg-thesis/', // Replace with your repo name if different
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
})
