import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './' keeps relative paths (data/, audio/, img/) working from any folder.
export default defineConfig({
  base: './',
  plugins: [vue()],
})
