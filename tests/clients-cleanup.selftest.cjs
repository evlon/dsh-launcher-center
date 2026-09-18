/**
 * 客户端清理自测：离线判定（服务端权威计算）+ 手动删除。
 *
 *   node tests/clients-cleanup.selftest.cjs
 *
 * 覆盖：
 *   ① 离线判定不信任客户端上报的 offline 字段，改由 lastSyncAt 与阈值计算
 *   ② 阈值 = max(3 × clientDefaults.syncIntervalSecs, 15 分钟)，跟随配置变化
 *   ③ DELETE /api/clients：鉴权、单个删除、批量删离线、非法 id 拒绝、幂等
 *   ④ CORS 预检必须放行 DELETE（漏了会让管理页删除请求被浏览器拦掉）
 *   ⑤ 在线客户端被删后重新上报 → 记录重建（证明删除无副作用）
 *
 * 与 golden-probe.cjs 的区别：黄金基线固化「既有端点行为零差异」，
 * 本脚本只测新增能力，不参与历史基线对比。
 */
'use strict'
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const SERVER = path.resolve(__dirname, '..', 'server.js')
const PORT = 18300
const TOKEN = 'cleanup-token'
const DATA = path.join(os.tmpdir(), 'clients-cleanup-' + process.pid)

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) pass++
  else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`)
  }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

function req(method, p, { body, headers } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8')
    const h = Object.assign({}, headers)
    if (payload) {
      h['Content-Type'] = 'application/json'
      h['Content-Length'] = payload.length
    }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          /* 非 JSON 响应 */
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    r.on('error', (e) => resolve({ status: 0, headers: {}, text: String(e.message), json: null }))
    if (payload) r.write(payload)
    r.end()
  })
}

const AUTH = { 'X-Admin-Token': TOKEN }

/** 直接写记录文件（绕过 /api/sync，因其会把 lastSyncAt 覆盖为当前时间）。 */
function writeRawRecord(clientId, lastSyncAt, hostname) {
  const rec = {
    clientId,
    hostname: hostname || 'RAW',
    dshVersion: '0.1.0',
    launcherVersion: '0.3.10',
    installed: [],
    pending: [],
    plugins: [],
    menu: [],
    menuApplied: false,
    profiles: [],
    configState: { profile: '', port: 0 },
    bridgeStatus: { enabled: false, port: 0 },
    offline: false, // 故意写 false：模拟「客户端上报时恒为 false」的真实行为
    lastSyncAt,
  }
  fs.writeFileSync(path.join(DATA, 'clients', clientId + '.json'), JSON.stringify(rec, null, 2), 'utf8')
}

;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })
  fs.mkdirSync(path.join(DATA, 'clients'), { recursive: true })

  const child = spawn(process.execPath, [SERVER, '--port', String(PORT), '--data', DATA, '--token', TOKEN], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let childErr = ''
  child.stderr.on('data', (d) => (childErr += d))

  const cleanup = () => {
    try {
      child.kill()
    } catch {
      /* 已退出 */
    }
    fs.rmSync(DATA, { recursive: true, force: true })
  }

  // 等就绪
  let ready = false
  for (let i = 0; i < 60; i++) {
    const r = await req('GET', '/api/config')
    if (r.status === 200) {
      ready = true
      break
    }
    await new Promise((r2) => setTimeout(r2, 100))
  }
  if (!ready) {
    console.log('服务端未就绪：' + childErr.slice(-500))
    cleanup()
    process.exit(1)
  }

  try {
    // ── ① 离线判定：造一台「在线」（刚上报）+ 一台「离线」（2 小时前）──
    const r1 = await req('POST', '/api/sync', {
      body: JSON.stringify({ clientId: 'fresh-client-00001', hostname: 'FRESH' }),
    })
    eq('上报 /api/sync → 200', r1.status, 200)

    writeRawRecord('stale-client-00002', new Date(Date.now() - 2 * 3600 * 1000).toISOString(), 'STALE')

    const st = await req('GET', '/api/status', { headers: AUTH })
    eq('/api/status → 200', st.status, 200)
    eq('阈值 默认 900s（300×3 与下限取大）', st.json.offlineThresholdSecs, 900)
    const byId = {}
    for (const c of st.json.clients) byId[c.clientId] = c
    check('刚上报 → offline=false（不被误判）', byId['fresh-client-00001'].offline === false)
    check('2 小时前 → offline=true（尽管记录里 offline:false）', byId['stale-client-00002'].offline === true)
    eq('记录里 offline 字段确为 false（证明服务端未采信）', byId['stale-client-00002'].offline, true)

    // ── ② 阈值跟随 clientDefaults.syncIntervalSecs ──
    const cfg = await req('POST', '/api/config', {
      body: JSON.stringify({ clientDefaults: { syncIntervalSecs: 600 } }),
      headers: AUTH,
    })
    eq('设置 syncIntervalSecs=600 → 200', cfg.status, 200)
    const st2 = await req('GET', '/api/status', { headers: AUTH })
    eq('阈值跟随配置 → 1800s（600×3）', st2.json.offlineThresholdSecs, 1800)

    // ── ③ 鉴权 ──
    const noTok = await req('DELETE', '/api/clients', { body: JSON.stringify({ clientId: 'fresh-client-00001' }) })
    eq('DELETE 无 token → 403', noTok.status, 403)
    const stillThere = await req('GET', '/api/status', { headers: AUTH })
    eq('403 后记录未动', stillThere.json.clients.length, 2)

    // ── ④ CORS 预检必须放行 DELETE ──
    const opt = await req('OPTIONS', '/api/clients')
    eq('OPTIONS 预检 → 204', opt.status, 204)
    check(
      '预检 Allow-Methods 含 DELETE',
      String(opt.headers['access-control-allow-methods'] || '').includes('DELETE'),
      opt.headers['access-control-allow-methods']
    )

    // ── ⑤ 非法 id 拒绝（防路径穿越）──
    const bad = await req('DELETE', '/api/clients', { body: JSON.stringify({ clientId: '../../etc/passwd' }), headers: AUTH })
    eq('DELETE 非法 id → 400', bad.status, 400)
    const empty = await req('DELETE', '/api/clients', { body: '{}', headers: AUTH })
    eq('DELETE 无参数 → 400', empty.status, 400)

    // ── ⑥ 删单个 ──
    const del1 = await req('DELETE', '/api/clients', { body: JSON.stringify({ clientId: 'fresh-client-00001' }), headers: AUTH })
    eq('DELETE 单个 → 200', del1.status, 200)
    eq('DELETE 单个 deleted=1', del1.json.deleted, 1)
    const afterDel = await req('GET', '/api/status', { headers: AUTH })
    eq('删除后剩 1 台', afterDel.json.clients.length, 1)
    eq('剩下的是离线那台', afterDel.json.clients[0].clientId, 'stale-client-00002')

    // ── ⑦ 幂等：重复删同一 id ──
    const del2 = await req('DELETE', '/api/clients', { body: JSON.stringify({ clientId: 'fresh-client-00001' }), headers: AUTH })
    eq('重复删 → 200（幂等不报错）', del2.status, 200)
    eq('重复删 deleted=0', del2.json.deleted, 0)

    // ── ⑧ 批量删离线 ──
    writeRawRecord('stale-client-00003', new Date(Date.now() - 5 * 3600 * 1000).toISOString(), 'STALE2')
    const delOff = await req('DELETE', '/api/clients', { body: JSON.stringify({ offline: true }), headers: AUTH })
    eq('删离线 → 200', delOff.status, 200)
    eq('删离线 deleted=2', delOff.json.deleted, 2)
    const final = await req('GET', '/api/status', { headers: AUTH })
    eq('清理后客户端数=0', final.json.clients.length, 0)

    // ── ⑨ 在线客户端被删后重新上报 → 记录重建（删除无副作用）──
    await req('POST', '/api/sync', { body: JSON.stringify({ clientId: 'fresh-client-00001', hostname: 'FRESH' }) })
    await req('DELETE', '/api/clients', { body: JSON.stringify({ clientId: 'fresh-client-00001' }), headers: AUTH })
    const gone = await req('GET', '/api/status', { headers: AUTH })
    eq('删除后确实消失', gone.json.clients.length, 0)
    await req('POST', '/api/sync', { body: JSON.stringify({ clientId: 'fresh-client-00001', hostname: 'FRESH' }) })
    const back = await req('GET', '/api/status', { headers: AUTH })
    eq('再次上报 → 记录重建', back.json.clients.length, 1)
    check('重建后为在线', back.json.clients[0].offline === false)

    // ── ⑩ 恢复配置（避免污染后续断言）──
    await req('POST', '/api/config', { body: JSON.stringify({ clientDefaults: { syncIntervalSecs: 300 } }), headers: AUTH })
  } finally {
    cleanup()
  }

  console.log(`\n客户端清理自测：${pass} 通过, ${fail} 失败\n`)
  process.exit(fail > 0 ? 1 : 0)
})()
