import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function saveMaskPlugin() {
  return {
    name: 'save-mask',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/save-mask', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk })
        req.on('end', () => {
          try {
            const { data } = JSON.parse(body)
            const base64 = (data as string).replace(/^data:image\/png;base64,/, '')
            const buf = Buffer.from(base64, 'base64')
            const maskPath = path.resolve(__dirname, 'resources/house-mask.png')
            fs.writeFileSync(maskPath, buf)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(e) }))
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), saveMaskPlugin()],
  base: command === 'build' ? '/house-color-picker/' : '/',
  build: {
    outDir: 'docs',
  },
}))
