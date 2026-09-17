/**
 * 管理页脚本装配自查：拼接产物必须包含全部模块的关键内容，且语法可解析。
 *
 *   node tests/adminscript.selftest.cjs
 *
 * 为什么需要它：GET /admin.js 现在由 src/web/*.js 拼接而成，
 * 若某个模块漏加载/顺序错，页面会在浏览器里静默失灵（很难发现）。
 * 这里用 node:vm 在无 DOM 环境下做「语法 + 关键符号」检查。
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { readAdminScript, ORDER } = require('../src/adminScript')

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

const root = path.join(__dirname, '..')
const { code, modules } = readAdminScript(root)

console.log('\n=== 管理页脚本装配自查 ===\n')
check('模块数 = ' + ORDER.length, modules === ORDER.length)

// 1. 语法必须可解析（用 vm 编译，不执行——无 DOM 会抛错）
let syntaxOk = true
let syntaxErr = ''
try {
  new vm.Script(code)
} catch (e) {
  syntaxOk = false
  syntaxErr = e.message
}
check('拼接产物语法可解析', syntaxOk, syntaxErr)

// 2. 每个模块的独有标记都出现在产物里（防漏加载）
const MARKERS = {
  'core.js': ['let bridgePort', 'function esc(', 'function toast(', 'function cmpVer('],
  'auth.js': ['function verifyToken(', 'function saveToken(', 'function showLoginGate('],
  'config.js': ['function loadConfig(', 'function saveClientDefaults('],
  'bridge.js': ['function autoDetectBridge(', 'function setBridgePort(', 'function pollMirrorProgress('],
  'plugins.js': ['function renderPlugins(', 'function syncOnePlugin(', 'function checkAllSyncStatus('],
  'npm.js': ['function renderNpmSync(', 'function syncOneNpmPkg(', 'function splitNpmSpec('],
  'menu.js': ['function renderMenuPolicy(', 'function moveMenuItem('],
  'clients.js': ['function renderClients(', 'function renderKpis('],
  'launcher.js': ['function uploadLauncherRelease(', 'function copyLauncherLink('],
}
for (const [file, marks] of Object.entries(MARKERS)) {
  for (const m of marks) {
    check(`${file} 含 ${m}`, code.includes(m))
  }
}

// 3. 非声明块（Tab 切换 / 启动引导）必须保留
check('含 Tab 切换块', code.includes('querySelectorAll(".tab")'))
check('含启动引导 IIFE', code.includes('setInterval(loadStatus'))
check('boot 在最后（IIFE 位于产物末尾区域）', code.lastIndexOf('verifyToken()') > code.length * 0.9)

// 4. 模块顺序：core 必须最先（其余模块引用其状态）
const coreIdx = code.indexOf('function esc(')
const bootIdx = code.lastIndexOf('setInterval(loadStatus')
check('core 在 boot 之前', coreIdx >= 0 && coreIdx < bootIdx)

// 5. 顶层声明清单与拆分前契约一致（75 个）
const DECL_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(let|const|var)\s+([A-Za-z_$][\w$]*)/gm
const decls = new Set()
let mm
while ((mm = DECL_RE.exec(code))) decls.add(mm[1] || mm[3])
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-contract-before.json'), 'utf8'))
const missing = contract.declarations.filter((d) => !decls.has(d))
check(`顶层声明齐全（${contract.declarations.length} 个）`, missing.length === 0, '缺失：' + missing.join(', '))

// 6. 无重复声明（浏览器里后者会覆盖前者，是隐患）
const counts = {}
for (const d of decls) counts[d] = (counts[d] || 0) + 1
const dups = Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => k)
check('无重复顶层声明', dups.length === 0, dups.join(', '))

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`)
process.exit(fail > 0 ? 1 : 0)
