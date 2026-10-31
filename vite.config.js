import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The case JSONs in src/puzzles are committed on this branch (they are generated elsewhere).
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
