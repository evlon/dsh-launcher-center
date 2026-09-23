/**
 * 配置端点自查：envDefaults 校验 + X-Notes 中文还原。
 *   node tests/envdefaults.selftest.cjs
 *
 * 为什么同进程 require server.js：server.js 无导出、启动即 listen，
 * 且本机沙箱禁止 spawn 子进程，故直接以期望 argv 载入同一进程，
 * 再用 http 打本机端口验证真实行为（非模拟）。
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PORT = 18099
const TOKEN = 'smoke-token'
const DATA = path.join(__dirname, '.tmp-envdefaults-data')
fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })

// 让 server.js 以期望参数启动
process.argv = ['node', 'server.js', '--port', String(PORT), '--data', DATA, '--token', TOKEN]
require('../server.js')

function req(method, p, body, headers) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8')
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign({}, headers, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, body: d }))
      },
    )
    r.on('error', (e) => resolve({ status: 0, body: String(e.message) }))
    if (payload) r.write(payload)
    r.end()
  })
}

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

;(async () => {
  await new Promise((r) => setTimeout(r, 700))
  console.log('\n=== envDefaults 端点冒烟 ===\n')

  // 1. 合法写入（含字符串/数字/布尔）
  const good = JSON.stringify({
    envDefaults: {
      matrix: { homeserverUrl: 'https://matrix.example.com' },
      llm: { baseUrl: 'http://ai.example.com', retries: 3, debug: true },
    },
  })
  let r = await req('POST', '/api/config', good, { 'X-Admin-Token': TOKEN })
  check('1. 合法 envDefaults 写入返回 200', r.status === 200, `status=${r.status} body=${r.body.slice(0, 200)}`)

  // 2. 读回并校验内容 + 数字/布尔被转成字符串
  r = await req('GET', '/api/config')
  let cfg = {}
  try {
    cfg = JSON.parse(r.body)
  } catch {}
  const ed = cfg.envDefaults || {}
  check('2a. 读回 matrix.homeserverUrl', ed.matrix && ed.matrix.homeserverUrl === 'https://matrix.example.com', JSON.stringify(ed.matrix))
  check('2b. 数字 3 → "3"', ed.llm && ed.llm.retries === '3', JSON.stringify(ed.llm))
  check('2c. 布尔 true → "true"', ed.llm && ed.llm.debug === 'true', JSON.stringify(ed.llm))

  // 3. 数组值应被拒（防覆盖插件复杂配置）
  r = await req('POST', '/api/config', JSON.stringify({ envDefaults: { llm: { models: [1, 2] } } }), { 'X-Admin-Token': TOKEN })
  check('3. 数组值被拒 400', r.status === 400, `status=${r.status}`)

  // 4. 非法 namespace 应被拒
  r = await req('POST', '/api/config', JSON.stringify({ envDefaults: { 'bad namespace!': { k: 'v' } } }), { 'X-Admin-Token': TOKEN })
  check('4. 非法 namespace 被拒 400', r.status === 400, `status=${r.status}`)

  // 5. envDefaults 传数组应被拒
  r = await req('POST', '/api/config', JSON.stringify({ envDefaults: [1, 2] }), { 'X-Admin-Token': TOKEN })
  check('5. envDefaults 非对象被拒 400', r.status === 400, `status=${r.status}`)

  // 6. 无 token 写入应 403
  r = await req('POST', '/api/config', JSON.stringify({ envDefaults: { x: { y: 'z' } } }))
  check('6. 无 token 写入被拒 403', r.status === 403, `status=${r.status}`)

  // 6b. jobPresets 合法写入（字符串数组，去重保序）
  r = await req('POST', '/api/config', JSON.stringify({ jobPresets: ['pm', 'dev', 'pm', 'qa'] }), { 'X-Admin-Token': TOKEN })
  check('6b1. 合法 jobPresets 写入返回 200', r.status === 200, `status=${r.status} body=${r.body.slice(0, 200)}`)
  r = await req('GET', '/api/config')
  try {
    cfg = JSON.parse(r.body)
  } catch {}
  check('6b2. 读回 jobPresets 去重保序', Array.isArray(cfg.jobPresets) && JSON.stringify(cfg.jobPresets) === JSON.stringify(['pm', 'dev', 'qa']), JSON.stringify(cfg.jobPresets))

  // 6c. jobPresets 非法元素应被拒（非字符串 / 非法字符）
  r = await req('POST', '/api/config', JSON.stringify({ jobPresets: [123] }), { 'X-Admin-Token': TOKEN })
  check('6c1. jobPresets 非字符串元素被拒 400', r.status === 400, `status=${r.status}`)
  r = await req('POST', '/api/config', JSON.stringify({ jobPresets: ['bad name!'] }), { 'X-Admin-Token': TOKEN })
  check('6c2. jobPresets 非法字符被拒 400', r.status === 400, `status=${r.status}`)

  // 6d. jobPresets 传非数组应被拒
  r = await req('POST', '/api/config', JSON.stringify({ jobPresets: 'pm' }), { 'X-Admin-Token': TOKEN })
  check('6d. jobPresets 非数组被拒 400', r.status === 400, `status=${r.status}`)

  // 6e. jobPresets 空数组合法（清空清单）
  r = await req('POST', '/api/config', JSON.stringify({ jobPresets: [] }), { 'X-Admin-Token': TOKEN })
  check('6e. jobPresets 空数组合法 200', r.status === 200, `status=${r.status}`)

  // 7.0 PATCH /api/launcher/notes：尚无发布物 → 404（先于 7a 上传之前测）
  r = await req('PATCH', '/api/launcher/notes', JSON.stringify({ notes: 'x' }), { 'X-Admin-Token': TOKEN })
  check('7z. 无发布物改 notes → 404', r.status === 404, `status=${r.status}`)

  // 7. X-Notes 中文经 latin1 到达后应能正确还原（decodeHeaderUtf8）
  //    模拟客户端：按 UTF-8 发字节
  const notesRaw = 'v0.3.7: 修复浏览器 401 抓取令牌'
  const exe = Buffer.alloc(1024 * 1024 + 16, 7) // ≥1MB
  const rr = await new Promise((resolve) => {
    const r2 = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/api/launcher/releases?v=9.9.9',
        method: 'POST',
        headers: {
          'X-Admin-Token': TOKEN,
          'X-Notes': Buffer.from(notesRaw, 'utf8').toString('latin1'),
          'Content-Type': 'application/octet-stream',
          'Content-Length': exe.length,
        },
      },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve({ status: res.statusCode, body: d }))
      },
    )
    r2.on('error', (e) => resolve({ status: 0, body: String(e.message) }))
    r2.write(exe)
    r2.end()
  })
  check('7a. 上传 release 成功', rr.status === 200, `status=${rr.status} body=${rr.body.slice(0, 200)}`)
  const latest = await req('GET', '/api/launcher/latest')
  let lat = {}
  try {
    lat = JSON.parse(latest.body)
  } catch {}
  check('7b. notes 中文还原正确（无乱码）', lat.notes === notesRaw, `notes=${JSON.stringify(lat.notes)} 期望=${JSON.stringify(notesRaw)}`)

  // 7c. PATCH /api/launcher/notes：只改 notes，版本/sha256/size 保持不变
  const newNotes = 'v9.9.9 补充说明：新增只改 notes 端点'
  r = await req('PATCH', '/api/launcher/notes', JSON.stringify({ notes: newNotes }), { 'X-Admin-Token': TOKEN })
  check('7c1. 改 notes 成功 200', r.status === 200, `status=${r.status} body=${r.body.slice(0, 200)}`)
  const lat2 = JSON.parse((await req('GET', '/api/launcher/latest')).body)
  check('7c2. notes 已更新', lat2.notes === newNotes, `notes=${JSON.stringify(lat2.notes)}`)
  check('7c3. version 保持不变', lat2.version === '9.9.9', `version=${lat2.version}`)
  check('7c4. sha256 保持不变', lat2.sha256 === lat.sha256, `sha256=${lat2.sha256}`)
  check('7c5. size 保持不变', lat2.size === lat.size, `size=${lat2.size}`)

  // 7d. PATCH /api/launcher/notes 无 token → 403
  r = await req('PATCH', '/api/launcher/notes', JSON.stringify({ notes: 'hack' }))
  check('7d. 改 notes 无 token → 403', r.status === 403, `status=${r.status}`)

  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`)
  fs.rmSync(DATA, { recursive: true, force: true })
  process.exit(fail > 0 ? 1 : 0)
})()
