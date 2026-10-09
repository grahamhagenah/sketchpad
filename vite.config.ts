/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from the root of https://music.grahamhagenah.com (GitHub Pages, custom domain).
  base: '/',
  test: {
    setupFiles: ['src/test/setup.ts'],
  },
})
