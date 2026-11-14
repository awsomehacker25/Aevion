import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre 6 locates its worker files relative to its own module URL,
  // which breaks if Vite pre-bundles it in dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
