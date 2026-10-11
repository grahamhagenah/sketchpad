/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from the root of https://bounce.grahamhagenah.com (GitHub Pages, custom domain).
  base: '/',
  test: {
    setupFiles: ['src/test/setup.ts'],
    // The stylesheet as written, for colors.test.ts to check the track colours' contrast.
    css: { include: [/index\.css/] },
  },
})
