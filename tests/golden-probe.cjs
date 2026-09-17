/**
 * 端到端「黄金基线」探针：把 server.js 的全部端点行为固化成可 diff 的 JSON。
 *
 *   node tests/golden-probe.cjs <server.js 路径> <输出 JSON 路径>
 *
 * 为什么这样做：重构（拆模块/换路由表）必须保证**行为零差异**。靠人眼 review 1400 行
 * 不可靠，所以先把「真实 HTTP 响应」逐端点录下来，重构后重跑并逐字节 diff。
 *
 * 确定性保障：
 *   - 起一个本地 registry 桩（固定 dist-tags/versions），并把 REGISTRY_OVERRIDE 指向它，
 *     使 /api/plugins/meta 与 /api/registry/sync-status 不依赖真实网络（可离线重跑）。
 *   - 归一化易变字段：ISO 时间戳、临时数据目录绝对路径。
 *   - 大文本（/admin、/admin.js）只记 sha256 + 长度，避免 diff 噪音。
 */
'use strict'
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')

const SERVER = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.js'))
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'golden.json'))
const PORT = 18200
const STUB_PORT = 18201
const TOKEN = 'golden-token'
const DATA = path.join(os.tmpdir(), 'golden-probe-data-' + process.pid)

// ---------- registry 桩：固定元数据，保证可离线重跑 ----------
const STUB_PKGS = {
  'dsh-codebuddy-models': { latest: '0.1.7', versions: { '0.1.6': {}, '0.1.7': {} } },
  'dsh-matrix-agent': { latest: '0.2.3', versions: { '0.2.3': {} } },
  'dsh-himarket': { latest: '0.1.4', versions: { '0.1.4': {} } },
  'dsh-plugin-message-rewrite': { latest: '0.1.0', versions: { '0.1.0': {} } },
  'dsh-nested-followups': { latest: '0.2.2', versions: { '0.2.2': {} } },
  '@scope/pkg': { latest: '1.2.3', versions: { '1.2.3': {} } },
}
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`

function startStub() {
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0])
    const pkg = STUB_PKGS[name]
    if (!pkg) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' })
    res.end(
      JSON.stringify({
        name,
        'dist-tags': { latest: pkg.latest },
        versions: pkg.versions,
        description: 'stub description for ' + name,
        homepage: 'https://example.invalid/' + name,
        repository: { url: 'git+https://example.invalid/' + name + '.git' },
      })
    )
  })
  return new Promise((r) => srv.listen(STUB_PORT, '127.0.0.1', () => r(srv)))
}

// ---------- HTTP 助手 ----------
function req(method, p, { body, headers, raw } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : Buffer.from(body, 'utf8')
    const h = Object.assign({}, headers)
    if (payload && !raw) h['Content-Type'] = 'application/json'
    if (payload) h['Content-Length'] = payload.length
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: h }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: pickHeaders(res.headers),
          body: Buffer.concat(chunks),
        })
      )
    })
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.from(String(e.message)) }))
    if (payload) r.write(payload)
    r.end()
  })
}

function pickHeaders(h) {
  const out = {}
  for (const k of ['content-type', 'cache-control', 'location', 'access-control-allow-origin', 'access-control-allow-methods']) {
    if (h[k] !== undefined) out[k] = h[k]
  }
  return out
}

/** 归一化：抹掉时间戳与临时目录路径，使 diff 只反映真实行为差异。 */
function normalize(s) {
  return String(s)
    .replace(/"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, '"<TS>"')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
    .replaceAll(DATA.replace(/\\/g, '\\\\'), '<DATA>')
    .replaceAll(DATA, '<DATA>')
}

const results = []
function record(name, r, opts = {}) {
  let body
  if (r.body.length > 4000 || opts.hash) {
    body = { __sha256: crypto.createHash('sha256').update(r.body).digest('hex'), __len: r.body.length }
  } else {
    body = normalize(r.body.toString('utf8'))
  }
  results.push({ name, status: r.status, headers: r.headers, body })
}

// ---------- 主流程 ----------
;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })
  fs.mkdirSync(DATA, { recursive: true })
  const stub = await startStub()

  const child = spawn(process.execPath, [SERVER, '--port', String(PORT), '--data', DATA, '--token', TOKEN], {
    env: Object.assign({}, process.env, { REGISTRY_OVERRIDE: STUB_URL }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let childErr = ''
  child.stderr.on('data', (d) => (childErr += d))

  // 等就绪
  for (let i = 0; i < 60; i++) {
    const r = await req('GET', '/api/config')
    if (r.status === 200) break
    await new Promise((r2) => setTimeout(r2, 100))
  }

  const AUTH = { 'X-Admin-Token': TOKEN }

  // ── 基础端点 ──
  record('GET /api/config (公开，初始)', await req('GET', '/api/config'))
  record('GET /api/status 无 token → 403', await req('GET', '/api/status'))
  record('GET /api/status 有 token', await req('GET', '/api/status', { headers: AUTH }))
  record('GET /  → 302 /admin', await req('GET', '/'))
  record('GET /admin', await req('GET', '/admin'), { hash: true })
  record('GET /admin.js', await req('GET', '/admin.js'), { hash: true })
  record('GET /download', await req('GET', '/download'), { hash: true })
  record('GET /nope → 404', await req('GET', '/nope'))
  record('OPTIONS 预检 → 204', await req('OPTIONS', '/api/config'))
  record('GET /api/launcher/latest（无发布）', await req('GET', '/api/launcher/latest'))

  // ── POST /api/config：鉴权 ──
  record('POST /api/config 无 token → 403', await req('POST', '/api/config', { body: '{}' }))

  // ── POST /api/config：完整合法载荷（覆盖 plugins/managedMenu/clientDefaults/envDefaults/mirrorSettings/profilePlugins/baseUrl/version） ──
  const fullCfg = {
    plugins: ['dsh-codebuddy-models', 'dsh-matrix-agent', 'dsh-codebuddy-models'],
    profilePlugins: { web: ['dsh-codebuddy-models'], matrix: ['dsh-matrix-agent', 'dsh-himarket'], 'matrix-dev': [] },
    managedMenu: { enabled: true, quickLinks: [{ label: '门户', url: 'https://portal.example.com' }] },
    clientDefaults: {
      npmRegistry: ['https://registry.npmmirror.com/', 'https://registry.npmjs.org/'],
      ghMirrorPrefix: 'https://ghfast.top/',
      port: 3180,
      syncIntervalSecs: 300,
      profile: 'matrix',
      useSystemNode: true,
      dshRegistry: 'http://registry.ict.cmcc',
    },
    envDefaults: { matrix: { homeserverUrl: 'https://mx.example.com' }, llm: { retries: 3, debug: true } },
    mirrorSettings: { registry: 'http://registry.ict.cmcc', tokenValue: 'tok-123', dshMirrorUrl: 'http://registry.ict.cmcc/dsh/' },
    baseUrl: 'https://conf.example.com',
    version: 3,
  }
  record('POST /api/config 完整合法', await req('POST', '/api/config', { body: JSON.stringify(fullCfg), headers: AUTH }))
  record('GET /api/config 回读', await req('GET', '/api/config'))

  // ── POST /api/config：各校验分支（每个都应有确定的状态码与 error 文案） ──
  const badCases = {
    'plugins 含非法包名': { plugins: ['ok-pkg', 'Bad Pkg!'] },
    'managedMenu 非对象': { managedMenu: [] },
    'managedMenu.enabled 非布尔': { managedMenu: { enabled: 'yes', quickLinks: [] } },
    'managedMenu.quickLinks 非数组': { managedMenu: { enabled: true, quickLinks: {} } },
    'quickLink url 非法': { managedMenu: { enabled: true, quickLinks: [{ label: 'x', url: 'javascript:alert(1)' }] } },
    'clientDefaults 非对象': { clientDefaults: [] },
    'clientDefaults.npmRegistry 类型错': { clientDefaults: { npmRegistry: 42 } },
    'clientDefaults.port 越界': { clientDefaults: { port: 70000 } },
    'clientDefaults.syncIntervalSecs 过小': { clientDefaults: { syncIntervalSecs: 5 } },
    'clientDefaults.profile 非法': { clientDefaults: { profile: 'bad name!' } },
    'clientDefaults.useSystemNode 非布尔': { clientDefaults: { useSystemNode: 'yes' } },
    'clientDefaults.dshRegistry 非 URL': { clientDefaults: { dshRegistry: 'not-a-url' } },
    'envDefaults 非对象': { envDefaults: [1, 2] },
    'envDefaults namespace 非法': { envDefaults: { 'bad ns!': { k: 'v' } } },
    'envDefaults 值非对象': { envDefaults: { ns: 'str' } },
    'envDefaults 键非法': { envDefaults: { ns: { 'bad key!': 'v' } } },
    'envDefaults 数组值被拒': { envDefaults: { ns: { models: [1, 2] } } },
    'mirrorSettings 非对象': { mirrorSettings: [] },
    'mirrorSettings.registry 非 URL': { mirrorSettings: { registry: 'ftp://x' } },
    'mirrorSettings.tokenValue 非字符串': { mirrorSettings: { tokenValue: 5 } },
    'mirrorSettings.dshMirrorUrl 非 URL': { mirrorSettings: { dshMirrorUrl: 'nope' } },
    'profilePlugins 非对象': { profilePlugins: [] },
    'profilePlugins profile 名非法': { profilePlugins: { 'bad name!': ['a'] } },
    'profilePlugins 值非数组': { profilePlugins: { web: 'x' } },
    'profilePlugins 含非法包名': { profilePlugins: { web: ['Bad Pkg!'] } },
  }
  for (const [label, body] of Object.entries(badCases)) {
    record('POST /api/config ' + label, await req('POST', '/api/config', { body: JSON.stringify(body), headers: AUTH }))
  }
  // 畸形 JSON
  record('POST /api/config 畸形 JSON', await req('POST', '/api/config', { body: '{bad json', headers: AUTH }))

  // ── /api/sync ──
  record('POST /api/sync 合法', await req('POST', '/api/sync', {
    body: JSON.stringify({
      clientId: 'golden-client-0001',
      hostname: 'HOST-A',
      dshVersion: '0.1.2-rc.1',
      launcherVersion: '0.3.7',
      installed: ['dsh-codebuddy-models'],
      pending: ['dsh-matrix-agent'],
      plugins: [{ name: 'dsh-codebuddy-models', version: '0.1.6', description: 'desc', profile: 'web', client: true }],
      menu: [{ label: '门户', url: 'https://portal.example.com' }],
      menuApplied: true,
      profiles: ['web', 'matrix'],
      configState: { profile: 'web', port: 3180 },
      bridgeStatus: { enabled: true, port: 3410 },
      offline: false,
    }),
    headers: AUTH,
  }))
  record('POST /api/sync clientId 非法', await req('POST', '/api/sync', { body: JSON.stringify({ clientId: 'x' }), headers: AUTH }))
  record('POST /api/sync 畸形 JSON', await req('POST', '/api/sync', { body: 'not json', headers: AUTH }))
  record('GET /api/status（含 1 台客户端）', await req('GET', '/api/status', { headers: AUTH }))

  // ── registry 相关（走桩，确定性） ──
  record('GET /api/plugins/meta', await req('GET', '/api/plugins/meta?names=dsh-codebuddy-models,dsh-matrix-agent'))
  record('GET /api/plugins/meta force=1', await req('GET', '/api/plugins/meta?names=dsh-codebuddy-models&force=1'))
  record('GET /api/plugins/meta 空 names', await req('GET', '/api/plugins/meta?names='))
  record('GET /api/plugins/meta 非法名过滤', await req('GET', '/api/plugins/meta?names=Bad%20Pkg!'))
  record('GET /api/registry/sync-status 单包', await req('GET', '/api/registry/sync-status?names=dsh-codebuddy-models&registry=' + encodeURIComponent(STUB_URL)))
  record('GET /api/registry/sync-status 带 spec', await req('GET', '/api/registry/sync-status?names=' + encodeURIComponent('dsh-codebuddy-models@0.1.6') + '&registry=' + encodeURIComponent(STUB_URL)))
  record('GET /api/registry/sync-status spec 未同步', await req('GET', '/api/registry/sync-status?names=' + encodeURIComponent('dsh-codebuddy-models@9.9.9') + '&registry=' + encodeURIComponent(STUB_URL)))
  record('GET /api/registry/sync-status scoped 包', await req('GET', '/api/registry/sync-status?names=' + encodeURIComponent('@scope/pkg') + '&registry=' + encodeURIComponent(STUB_URL)))
  record('GET /api/registry/sync-status 不存在→unsynced', await req('GET', '/api/registry/sync-status?names=no-such-pkg-xyz&registry=' + encodeURIComponent(STUB_URL)))
  record('GET /api/registry/sync-status 非法 registry 回落', await req('GET', '/api/registry/sync-status?names=dsh-matrix-agent&registry=notaurl'))

  // ── /api/mirror/packages ──
  record('GET /api/mirror/packages 无 token → 403', await req('GET', '/api/mirror/packages'))
  record('GET /api/mirror/packages 初始', await req('GET', '/api/mirror/packages', { headers: AUTH }))
  record('POST /api/mirror/packages 合法（含 pkg@spec 字符串与 scoped）', await req('POST', '/api/mirror/packages', {
    body: JSON.stringify({ packages: ['@deepseek-ai/dsh@0.1.2-rc.1', 'zod', { name: 'pkg-a', spec: '^3.0.0' }, 'zod'] }),
    headers: AUTH,
  }))
  record('GET /api/mirror/packages 回读', await req('GET', '/api/mirror/packages', { headers: AUTH }))
  record('POST /api/mirror/packages 非法包名', await req('POST', '/api/mirror/packages', { body: JSON.stringify({ packages: ['Bad Pkg!'] }), headers: AUTH }))
  record('POST /api/mirror/packages 非法 spec', await req('POST', '/api/mirror/packages', { body: JSON.stringify({ packages: [{ name: 'ok-pkg', spec: 'bad@spec' }] }), headers: AUTH }))
  record('POST /api/mirror/packages 空载荷', await req('POST', '/api/mirror/packages', { body: JSON.stringify({}), headers: AUTH }))

  // ── launcher 发布物 ──
  const exe = Buffer.alloc(1024 * 1024 + 128, 9)
  record('POST /api/launcher/releases 无 token → 403', await req('POST', '/api/launcher/releases?v=9.9.9', { body: exe, raw: true }))
  record('POST /api/launcher/releases 版本号非法', await req('POST', '/api/launcher/releases?v=bad', { body: exe, raw: true, headers: AUTH }))
  record('POST /api/launcher/releases 过小', await req('POST', '/api/launcher/releases?v=9.9.9', { body: Buffer.alloc(100), raw: true, headers: AUTH }))
  record('POST /api/launcher/releases 合法（含中文 notes）', await req('POST', '/api/launcher/releases?v=9.9.9', {
    body: exe,
    raw: true,
    headers: Object.assign({}, AUTH, { 'X-Notes': Buffer.from('v9.9.9: 中文说明 修复', 'utf8').toString('latin1') }),
  }))
  record('GET /api/launcher/latest（有发布）', await req('GET', '/api/launcher/latest'))
  record('GET /api/launcher/download 合法', await req('GET', '/api/launcher/download?file=launcher-9.9.9.exe'), { hash: true })
  record('GET /api/launcher/download 穿越尝试', await req('GET', '/api/launcher/download?file=../config.json'))
  record('GET /api/launcher/download 不存在', await req('GET', '/api/launcher/download?file=launcher-0.0.0.exe'))
  record('GET /download（有发布）', await req('GET', '/download'), { hash: true })

  child.kill()
  stub.close()
  await new Promise((r) => setTimeout(r, 200))
  fs.rmSync(DATA, { recursive: true, force: true })

  const doc = {
    server: path.basename(SERVER),
    node: process.version,
    count: results.length,
    results,
    childStderrTail: normalize(childErr).slice(-500),
  }
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2), 'utf8')
  const fails = results.filter((r) => r.status === 0)
  console.log(`探针完成：${results.length} 个用例 → ${OUT}`)
  if (fails.length) console.log('连接失败用例：' + fails.map((f) => f.name).join(', '))
  process.exit(0)
})()
