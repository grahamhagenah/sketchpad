import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://grahamhagenah.github.io/sketchpad/
  base: '/sketchpad/',
})
