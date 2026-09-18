/**
 * 单元测试：校验层（src/validate.js）、存储层（src/store/*）、路由表（src/router.js）。
 *
 *   node tests/unit.test.cjs
 *
 * 这些是纯函数/纯文件 IO，不依赖网络与端口，可快速回归。
 * 端到端行为由 tests/golden-probe.cjs 负责（逐端点固化对比）。
 */
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const v = require('../src/validate')
const { createConfigStore, defaultConfig, normalizeConfig } = require('../src/store/config')
const {
  createClientsStore,
  normalizeClientRecord,
  buildClientRecord,
  offlineThresholdSecs,
  isOffline,
} = require('../src/store/clients')
const { createMirrorPackagesStore } = require('../src/store/mirrorPackages')
const { createLauncherReleasesStore } = require('../src/store/launcherReleases')
const { createRouter } = require('../src/router')
const { escapeHtml, decodeHeaderUtf8 } = require('../src/text')
const { parseArgs } = require('../src/args')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`)
  }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}

// ---------- validate: 包名 ----------
check('包名 普通合法', v.validPackageName('dsh-matrix-agent'))
check('包名 scoped 合法', v.validPackageName('@deepseek-ai/dsh'))
check('包名 拒绝空格', !v.validPackageName('bad pkg'))
check('包名 拒绝穿越', !v.validPackageName('../etc/passwd'))
check('包名 拒绝空', !v.validPackageName(''))
check('包名 拒绝非字符串', !v.validPackageName(42))

// ---------- validate: spec ----------
check('spec latest 合法', v.validMirrorSpec('latest'))
check('spec 空合法', v.validMirrorSpec(''))
check('spec 版本合法', v.validMirrorSpec('0.1.2-rc.1'))
check('spec 范围合法（空格 AND）', v.validMirrorSpec('1.43.0 <2'))
check('spec 范围合法（||）', v.validMirrorSpec('2.0.0||3.0.0'))
check('spec 通配合法', v.validMirrorSpec('3.x'))
// 既有行为（必须保留）：首字符须为字母数字，故 ^ 开头被拒
check('spec ^ 开头被拒（既有行为）', !v.validMirrorSpec('^3.25 || ^4.0'))
check('spec 拒绝 @', !v.validMirrorSpec('a@b'))
check('spec 超长拒绝', !v.validMirrorSpec('1'.repeat(65)))

// ---------- validate: profile / 菜单 ----------
check('profile 合法', v.validProfileName('matrix-dev'))
check('profile 拒绝空格', !v.validProfileName('bad name'))
eq('菜单 合法', v.validateManagedMenu({ enabled: true, quickLinks: [{ label: 'x', url: 'https://a.b' }] }), { ok: true })
check('菜单 enabled 非布尔被拒', !v.validateManagedMenu({ enabled: 'y', quickLinks: [] }).ok)
check('菜单 url javascript 被拒', !v.validateManagedMenu({ enabled: true, quickLinks: [{ label: 'x', url: 'javascript:1' }] }).ok)
check('菜单 undefined 通过', v.validateManagedMenu(undefined).ok)

// ---------- validate: profilePlugins ----------
eq('profilePlugins 合法+去重', v.validateProfilePlugins({ web: ['a', 'a', 'b'] }), { ok: true, cleaned: { web: ['a', 'b'] } })
check('profilePlugins 非对象被拒', !v.validateProfilePlugins([]).ok)
check('profilePlugins profile 名非法被拒', !v.validateProfilePlugins({ 'bad name': ['a'] }).ok)
check('profilePlugins 值非数组被拒', !v.validateProfilePlugins({ web: 'x' }).ok)
check('profilePlugins 包名非法被拒', !v.validateProfilePlugins({ web: ['Bad Pkg'] }).ok)
eq('profilePlugins undefined 通过', v.validateProfilePlugins(undefined), { ok: true, cleaned: undefined })

// ---------- validate: envDefaults ----------
eq('envDefaults 数字/布尔转字符串', v.validateEnvDefaults({ llm: { retries: 3, debug: true } }), {
  ok: true,
  cleaned: { llm: { retries: '3', debug: 'true' } },
})
eq('envDefaults 字符串 trim', v.validateEnvDefaults({ a: { b: '  x  ' } }), { ok: true, cleaned: { a: { b: 'x' } } })
check('envDefaults 数组值被拒', !v.validateEnvDefaults({ a: { b: [1] } }).ok)
check('envDefaults namespace 非法被拒', !v.validateEnvDefaults({ 'bad ns': { a: 'b' } }).ok)
check('envDefaults 非对象被拒', !v.validateEnvDefaults([1]).ok)
check('envDefaults 值非对象被拒', !v.validateEnvDefaults({ a: 'str' }).ok)

// ---------- validate: normalizeStringList ----------
eq('list 字符串→数组', v.normalizeStringList(' a '), ['a'])
eq('list 数组过滤空', v.normalizeStringList(['a', '', ' b ']), ['a', 'b'])
eq('list 空串→null', v.normalizeStringList(''), null)
eq('list 非法类型→undefined', v.normalizeStringList(42), undefined)

// ---------- text ----------
eq('escapeHtml 转义', escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;')
eq('escapeHtml null', escapeHtml(null), '')
eq('decodeHeaderUtf8 中文还原', decodeHeaderUtf8(Buffer.from('中文', 'utf8').toString('latin1')), '中文')
eq('decodeHeaderUtf8 ASCII 原样', decodeHeaderUtf8('plain ascii'), 'plain ascii')
eq('decodeHeaderUtf8 空', decodeHeaderUtf8(''), '')

// ---------- args ----------
eq('args 默认值', parseArgs([], '/default/data'), { port: 8080, data: '/default/data', token: '' })
eq('args 显式值', parseArgs(['--port', '9000', '--token', 'tk'], '/d'), { port: 9000, data: '/d', token: 'tk' })
eq('args port 非法回落', parseArgs(['--port', 'abc'], '/d').port, 8080)

// ---------- store: config ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-store-'))
const cfgPath = path.join(tmp, 'config.json')
const cfgStore = createConfigStore({ configPath: cfgPath })
eq('config 文件缺失→默认', cfgStore.readConfig().version, defaultConfig().version)
cfgStore.writeConfig({ plugins: ['a'], managedMenu: { enabled: false, quickLinks: [] } })
const back = cfgStore.readConfig()
eq('config 写读一致', back.plugins, ['a'])
check('config 写入盖 updatedAt', typeof back.updatedAt === 'string' && back.updatedAt.length > 0)
check('config 归一化补 profilePlugins', JSON.stringify(back.profilePlugins) === '{}')
eq('normalizeConfig 补 envDefaults', normalizeConfig({}).envDefaults, {})

// ---------- store: clients ----------
// 注意：clients 目录必须与 config.json 所在目录隔离——listClients 会读目录下所有 *.json，
// 与 config 混放会把配置当成客户端记录（本测试早期版本即踩此坑）。
const clientsDir = path.join(tmp, 'clients')
fs.mkdirSync(clientsDir, { recursive: true })
const clStore = createClientsStore({ clientsDir })
eq('clients 空目录→空数组', clStore.listClients(), [])
check('CLIENT_ID_RE 合法', clStore.CLIENT_ID_RE.test('golden-client-0001'))
check('CLIENT_ID_RE 拒绝短', !clStore.CLIENT_ID_RE.test('x'))
check('CLIENT_ID_RE 拒绝穿越', !clStore.CLIENT_ID_RE.test('../../etc/passwd'))
clStore.saveClientRecord({ clientId: 'client-abcdefgh', hostname: 'H' })
eq('clients 保存后可读', clStore.listClients().length, 1)
const rec = buildClientRecord({ clientId: 'c1', plugins: [{ name: 'p' }], profiles: ['web'] })
eq('buildClientRecord 截断 plugins', rec.plugins.length, 1)
eq('buildClientRecord 默认 bridgeStatus', rec.bridgeStatus, { enabled: false, port: 0 })
check('normalizeClientRecord null', normalizeClientRecord(null) === null)
eq('normalizeClientRecord 补字段', normalizeClientRecord({}).menuApplied, false)

// ---------- 离线判定（服务端权威计算） ----------
// 阈值 = max(3 × 同步间隔, 15 分钟)
eq('阈值 默认300s→900s(下限生效)', offlineThresholdSecs(300), 900)
eq('阈值 未传→默认', offlineThresholdSecs(undefined), 900)
eq('阈值 600s→1800s(3倍生效)', offlineThresholdSecs(600), 1800)
eq('阈值 非法值→默认', offlineThresholdSecs(0), 900)
const NOW = Date.parse('2026-09-18T10:00:00.000Z')
const at = (secAgo) => ({ lastSyncAt: new Date(NOW - secAgo * 1000).toISOString() })
check('离线 刚上报→在线', !isOffline(at(10), NOW, 900))
check('离线 899s→在线', !isOffline(at(899), NOW, 900))
check('离线 901s→离线', isOffline(at(901), NOW, 900))
check('离线 lastSyncAt缺失→离线', isOffline({}, NOW, 900))
check('离线 lastSyncAt损坏→离线', isOffline({ lastSyncAt: 'garbage' }, NOW, 900))
check('离线 null记录→离线', isOffline(null, NOW, 900))

// ---------- 客户端删除（幂等 + 防穿越） ----------
check('删除 不存在→false', !clStore.deleteClient('no-such-client-0001'))
check('删除 非法id→false', !clStore.deleteClient('../../etc/passwd'))
check('删除 穿越不越界', fs.existsSync(path.join(clientsDir, 'client-abcdefgh.json')))
check('删除 存在→true', clStore.deleteClient('client-abcdefgh'))
eq('删除 后目录为空', clStore.listClients().length, 0)
check('删除 重复删→false(幂等)', !clStore.deleteClient('client-abcdefgh'))
clStore.saveClientRecord({ clientId: 'bulk-a-00000001', hostname: 'A' })
clStore.saveClientRecord({ clientId: 'bulk-b-00000002', hostname: 'B' })
eq('批量删除 2 条', clStore.deleteClients(['bulk-a-00000001', 'bulk-b-00000002']), 2)
eq('批量删除 后为空', clStore.listClients().length, 0)
eq('批量删除 跳过非法id', clStore.deleteClients(['../../etc/passwd', 'nope-00000000001']), 0)

// ---------- store: mirrorPackages ----------
const mpPath = path.join(tmp, 'mirror-packages.json')
const mpStore = createMirrorPackagesStore({ path: mpPath })
eq('mirrorPackages 缺失→空', mpStore.readMirrorPackages(), [])
mpStore.writeMirrorPackages([{ name: 'zod', spec: 'latest' }])
eq('mirrorPackages 写读一致', mpStore.readMirrorPackages(), [{ name: 'zod', spec: 'latest' }])
fs.writeFileSync(mpPath, '{bad json', 'utf8')
eq('mirrorPackages 损坏→空', mpStore.readMirrorPackages(), [])
fs.writeFileSync(mpPath, JSON.stringify([{ name: 'Bad Pkg', spec: 'x' }, { name: 'ok', spec: '' }]), 'utf8')
eq('mirrorPackages 过滤非法项', mpStore.readMirrorPackages(), [{ name: 'ok', spec: 'latest' }])

// ---------- store: launcherReleases ----------
const relDir = path.join(tmp, 'rel')
fs.mkdirSync(relDir, { recursive: true })
const relStore = createLauncherReleasesStore({ dir: relDir, metaPath: path.join(relDir, 'latest.json') })
check('releases 无元数据→null', relStore.readLauncherReleaseMeta() === null)
relStore.writeLauncherReleaseMeta({ version: '1.0.0', file: 'launcher-1.0.0.exe' })
eq('releases 写读一致', relStore.readLauncherReleaseMeta().version, '1.0.0')
fs.writeFileSync(path.join(relDir, 'launcher-0.9.0.exe'), 'old')
fs.writeFileSync(path.join(relDir, 'launcher-1.0.0.exe'), 'new')
relStore.cleanupLauncherReleases('launcher-1.0.0.exe')
check('releases 清理旧产物', !fs.existsSync(path.join(relDir, 'launcher-0.9.0.exe')))
check('releases 保留当前产物', fs.existsSync(path.join(relDir, 'launcher-1.0.0.exe')))
check('releases 保留 latest.json', fs.existsSync(path.join(relDir, 'latest.json')))

// ---------- router ----------
const r = createRouter([[['GET', '/a', () => {}]], [['POST', '/b', () => {}]]])
eq('router 表大小', r.table.size, 2)
let dupThrew = false
try {
  createRouter([[['GET', '/a', () => {}]], [['GET', '/a', () => {}]]])
} catch {
  dupThrew = true
}
check('router 重复路由抛错', dupThrew)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n单元测试：${pass} 通过, ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
