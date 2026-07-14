import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' para que funcione tambien al desplegar en GitHub Pages (rutas relativas)
export default defineConfig({
  plugins: [react()],
  base: './',
})
