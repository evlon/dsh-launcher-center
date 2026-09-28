// 冒烟验证：临时 center，固定端口 8099，下发带唯一标记的 uiBundle，常驻等待 launcher 同步
'use strict'
const { createApp } = require('E:/ai-works/dsh-launcher-center/src/app')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const PORT = 8099
const dataDir = path.join(os.tmpdir(), 'smoke-center-data')
fs.rmSync(dataDir, { recursive: true, force: true })

const app = createApp({ port: PORT, data: dataDir, token: '' }, { rootDir: 'E:/ai-works/dsh-launcher-center' })
app.ensureData()
const server = app.createServer()

// 下发 uiBundle：唯一标记 SMOKE_MARKER_9f3a2c
const MARKER = 'SMOKE_MARKER_9f3a2c'
const html = `<!doctype html><html><head><meta charset="utf-8"><title>冒烟向导 ${MARKER}</title></head><body><h1 id="smoke">服务端下发版 ${MARKER}</h1></body></html>`

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[center] listening http://127.0.0.1:${PORT}`)
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uiBundle: { version: 'smoke-v1', files: { 'matrix-setup.html': html, 'console.html': '<html>console-smoke</html>' } }
      })
    })
    const j = await r.json()
    console.log('[center] uiBundle 下发:', JSON.stringify(j.uiBundle && j.uiBundle.version))
  } catch (e) {
    console.error('[center] 下发失败', e.message)
  }
})
