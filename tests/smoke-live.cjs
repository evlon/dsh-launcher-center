/**
 * 真实服务端冒烟：起一个真实进程，用 HTTP 拉取页面与脚本，确认端到端可用。
 *
 *   node tests/smoke-live.cjs
 *
 * 覆盖「浏览器实际会请求的三件东西」：
 *   GET /admin      → HTML（含 <script src="/admin.js">）
 *   GET /admin.js   → 拼接后的脚本（语法可解析、含各模块关键符号）
 *   GET /download   → 公开下载页
 * 以及 /admin.js 的「改即生效」特性（改 src/web 后无需重启）。
 */
'use strict'
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawn } = require('node:child_process')

const PORT = 18260
const DATA = path.join(os.tmpdir(), 'lsc-smoke-' + process.pid)
const SERVER = path.join(__dirname, '..', 'server.js')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  OK ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`)
  }
}

function get(p) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        // 用 Buffer 收集再一次性解码：分块边界可能切断多字节 UTF-8 字符，
        // 逐块 toString 会产生替换字符（曾导致「两次请求内容不一致」的误报）
        const buf = Buffer.concat(chunks)
        resolve({ status: res.statusCode, body: buf.toString('utf8'), buf, headers: res.headers })
      })
    })
    r.on('error', (e) => resolve({ status: 0, body: String(e.message), buf: Buffer.alloc(0), headers: {} }))
    r.end()
  })
}

;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })
  const child = spawn(process.execPath, [SERVER, '--port', String(PORT), '--data', DATA, '--token', 'tk'], {
    env: Object.assign({}, process.env, { REGISTRY_OVERRIDE: 'http://127.0.0.1:1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))

  for (let i = 0; i < 60; i++) {
    const r = await get('/api/config')
    if (r.status === 200) break
    await new Promise((r2) => setTimeout(r2, 100))
  }

  console.log('\n=== 真实服务端冒烟 ===\n')

  const admin = await get('/admin')
  check('GET /admin → 200', admin.status === 200, `status=${admin.status}`)
  check('管理页含 script 引用', admin.body.includes('<script src="/admin.js"></script>'))
  check('管理页含全局栏 DOM', admin.body.includes('id="bridgeState"') && admin.body.includes('id="mirrorRegistry"'))
  check('管理页含 npm 同步 tab', admin.body.includes('id="npmsyncList"'))

  const js = await get('/admin.js')
  check('GET /admin.js → 200', js.status === 200, `status=${js.status}`)
  check('脚本 Content-Type 正确', String(js.headers['content-type']).includes('javascript'))
  let syntaxOk = true
  let err = ''
  try {
    new vm.Script(js.body)
  } catch (e) {
    syntaxOk = false
    err = e.message
  }
  check('脚本语法可解析', syntaxOk, err)
  check('脚本含拼接头说明', js.body.includes('由服务端按 src/web/*.js 顺序拼接'))
  check('脚本含 core 状态', js.body.includes('let bridgePort'))
  check('脚本含 bridge 自检逻辑', js.body.includes('mirror/progress?token='))
  check('脚本含插件上游语义修复', js.body.includes('上游查询失败'))
  check('脚本含 boot 引导', js.body.includes('setInterval(loadStatus'))

  const dl = await get('/download')
  check('GET /download → 200', dl.status === 200, `status=${dl.status}`)
  check('下载页无发布物提示', dl.body.includes('暂无可下载版本'))

  // 「改即生效」：/admin.js 每次请求读盘（拼接自 src/web）——按字节比较，避免编码干扰
  const js2 = await get('/admin.js')
  check('/admin.js 两次请求字节一致', js2.buf.equals(js.buf))

  child.kill()
  await new Promise((r) => setTimeout(r, 300))
  fs.rmSync(DATA, { recursive: true, force: true })

  if (stderr.trim()) console.log('  (子进程 stderr 非空，前 200 字)\n  ' + stderr.slice(0, 200))
  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`)
  process.exit(fail > 0 ? 1 : 0)
})()
