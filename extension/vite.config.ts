import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { copyFileSync, cpSync, mkdirSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      // Copia manifest.json e pasta public/ para dist/ após o build
      name: 'copy-extension-assets',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true })
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        )
        const publicDir = resolve(__dirname, 'public')
        if (existsSync(publicDir)) {
          cpSync(publicDir, resolve(__dirname, 'dist'), { recursive: true })
        }
      },
    },
  ],
  // Não serve arquivos de public/ automaticamente (faremos manual via plugin)
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup:       resolve(__dirname, 'popup.html'),
        offscreen:   resolve(__dirname, 'offscreen.html'),
        'request-mic': resolve(__dirname, 'request-mic.html'),
        background:  resolve(__dirname, 'src/background.ts'),
        content:     resolve(__dirname, 'src/content.ts'),
      },
      output: {
        // background.js, content.js devem estar em src/ conforme o manifest
        entryFileNames: (chunk) => {
          if (chunk.name === 'popup') return '[name].js'
          if (chunk.name === 'offscreen') return '[name].js'
          if (chunk.name === 'request-mic') return '[name].js'
          return 'src/[name].js'
        },
        chunkFileNames: 'src/chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
        format: 'es',
      },
    },
  },
})
