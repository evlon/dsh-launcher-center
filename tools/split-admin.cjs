/**
 * 一次性拆分脚本：把 admin.js（单文件 1174 行 / 75 个顶层声明）按职责拆到 src/web/。
 *
 * ## 核心不变式（脚本自校验，失败即抛错）
 * 所有「段落」按原顺序拼接后的文本 === 原 admin.js 文本。
 * 即：拆分是**纯搬运**，零改写、零丢失、零重复。手抄 1100 行中文 JS 必错，
 * 所以用「按边界切段 → 按声明名分派 → 断言可完整还原」的方式做。
 *
 * ## 段落边界
 * 边界 = 「段落标题注释行（// ── … ──）」或「顶层声明行」。
 * 每个段落恰好归属一个目标文件；无声明的段落（如 Tab 切换块、启动块）
 * 归给其后最近的、含声明的段落所属文件（末尾无后继则归 boot.js）。
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'admin.js')
const OUT_DIR = path.join(__dirname, '..', 'src', 'web')

const original = fs.readFileSync(SRC, 'utf8')
const lines = original.split('\n')

const DECL_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(let|const|var)\s+([A-Za-z_$][\w$]*)/
const SECTION_RE = /^\/\/\s*──/

// ---------- 1. 切段 ----------
const bounds = []
lines.forEach((l, i) => {
  if (SECTION_RE.test(l)) bounds.push({ line: i, kind: 'section' })
  const m = l.match(DECL_RE)
  if (m) bounds.push({ line: i, kind: 'decl', name: m[1] || m[3] })
})
if (!bounds.length) throw new Error('未找到任何边界')

const segments = []
for (let i = 0; i < bounds.length; i++) {
  const from = bounds[i].line
  const to = i + 1 < bounds.length ? bounds[i + 1].line - 1 : lines.length - 1
  const seg = { from, to, text: lines.slice(from, to + 1).join('\n'), decl: bounds[i].kind === 'decl' ? bounds[i].name : null }
  if (bounds[i].kind === 'section') seg.sectionTitle = l0(lines[from])
  segments.push(seg)
}
function l0(s) {
  return s.trim()
}

// ---------- 2. 声明 → 目标文件 分派 ----------
const ASSIGN = {
  // 状态与通用工具（所有视图共用，必须最先加载）
  'core.js': [
    'TOKEN', 'current', 'latestClients', 'mirrorPackages', 'bridgeVersion', 'npmPollTimer',
    'headers', 'esc', 'toast', 'fmtTime', 'cmpVer', 'bridgePort', 'syncRegistryUrl',
    'syncRegistryCache', 'pluginMetaCache', 'lastSyncStates', 'npmSpecRe',
    'mirrorPollTimer', 'mirrorPollFailures', 'MIRROR_POLL_MAX_FAILURES', 'npmPollFailures',
  ],
  'auth.js': ['openTokenModal', 'showLoginGate', 'hideLoginGate', 'verifyToken', 'saveToken'],
  'config.js': ['loadConfig', 'renderClientDefaults', 'saveClientDefaults'],
  'bridge.js': ['saveMirrorSettings', 'startMirrorUpload', 'pollMirrorProgress', 'loadStatus', 'autoDetectBridge', 'setBridgePort', 'refreshAll'],
  'plugins.js': ['fetchPluginMetas', 'renderPlugins', 'checkRegistryStatus', 'checkAllSyncStatus', 'syncOnePlugin', 'syncAllPlugins', 'addPlugin', 'removePlugin', 'saveConfig'],
  'npm.js': ['fetchNpmMetas', 'splitNpmSpec', 'loadMirrorPackages', 'saveMirrorPackages', 'addNpmPkg', 'removeNpmPkg', 'renderNpmSync', 'checkNpmSyncStatus', 'syncOneNpmPkg', 'syncAllNpmPkgs', 'npmPkgIsSynced', 'waitNpmMirrorDone', 'pollNpmMirrorProgress'],
  'menu.js': ['renderMenuPolicy', 'addMenuItem', 'removeMenuItem', 'moveMenuItem', 'editMenuLabel', 'editMenuUrl', 'saveMenuPolicy'],
  'clients.js': ['healthOf', 'chipPlugins', 'renderKpis', 'kpi', 'renderOverviewClients', 'renderClients'],
  'launcher.js': ['loadLauncherRelease', 'copyLauncherLink', 'fallbackCopy', 'uploadLauncherRelease'],
}

const fileOf = new Map()
for (const [file, names] of Object.entries(ASSIGN)) {
  for (const n of names) {
    if (fileOf.has(n)) throw new Error(`声明「${n}」被分派到多个文件`)
    fileOf.set(n, file)
  }
}

// 分派每个段落
const declNames = segments.filter((s) => s.decl).map((s) => s.decl)
const unassigned = declNames.filter((n) => !fileOf.has(n))
if (unassigned.length) throw new Error('以下声明未分派：' + unassigned.join(', '))

for (let i = 0; i < segments.length; i++) {
  const s = segments[i]
  if (s.decl) {
    s.file = fileOf.get(s.decl)
  } else {
    // 无声明段落：归其后最近含声明的段落所属文件；末尾无后继 → boot.js
    let file = null
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].decl) {
        file = fileOf.get(segments[j].decl)
        break
      }
    }
    s.file = file || 'boot.js'
  }
}

// ---------- 3. 不变式：拼接后必须与原文件逐字节一致 ----------
const reassembled = segments.map((s) => s.text).join('\n')
if (reassembled !== original) {
  let i = 0
  while (i < Math.min(reassembled.length, original.length) && reassembled[i] === original[i]) i++
  throw new Error(
    `不变式失败：拼接结果与原文件不一致（首差异字符 ${i}）\n` +
      `  原: ${JSON.stringify(original.slice(i, i + 140))}\n` +
      `  新: ${JSON.stringify(reassembled.slice(i, i + 140))}`
  )
}

// ---------- 4. 按文件写出（段内保持原顺序） ----------
const ORDER = ['core.js', 'auth.js', 'config.js', 'bridge.js', 'plugins.js', 'npm.js', 'menu.js', 'clients.js', 'launcher.js', 'boot.js']
const HEADERS = {
  'core.js': `/**
 * 全局状态与通用工具（必须最先加载：其余模块的函数体引用这里的变量）。
 *
 * 状态集中在此，避免散落各处导致「谁改了 bridgePort」难以追查。
 * 约定：顶层 let/const 状态只在本文件声明；其他文件只放函数。
 */`,
  'auth.js': `/**
 * 登录门禁与 Tab 切换。
 *
 * 管理页鉴权模型：页面本身可打开（内网），但 /api/status 等接口需 token；
 * 页面加载即校验 token，403 则锁定全屏登录门禁。
 */`,
  'config.js': `/**
 * 中心配置读取与「客户端默认配置」编辑。
 *
 * 注意两处配置的区别：
 *   - 全局栏「内网 registry」：镜像目标 + 同步状态查询源（见 bridge.js）
 *   - 本文件「客户端默认配置」：下发给同事端的默认值（本地显式设置过的不被覆盖）
 */`,
  'bridge.js': `/**
 * 管理员本机管理能力（bridge）——外网代理网关。
 *
 * ## 为什么需要它
 * 中心服务端在生产机房内网，**不能出外网**（也未必能访问内网 registry）。
 * 管理员本机 launcher 的本地 API（默认 127.0.0.1:3410）既能出外网查 npmjs，
 * 又能访问内网 registry，因此「上游元信息查询 / 镜像同步」都由它承担。
 *
 * ## 关键前提（生产拓扑）
 * 本文件代码运行在**管理员本机的浏览器**里（页面从 ai-conf 拉回后本地执行），
 * 所以 127.0.0.1 恒指管理员自己的电脑——与「服务端是否同机」无关。
 * 服务端从不主动访问 bridge（server.js 无 3410/localhost 出站）。
 *
 * ## 状态诚实原则
 * /api/health 免 token，只证明「服务在」；token 是否有效必须实测
 * （用 mirror/progress 自检：只读本地、不触外网，token 错返回 invalid bridge token）。
 * 绝不在未授权时显示「已连接」。
 */`,
  'plugins.js': `/**
 * 插件策略：应装清单、上游版本对比、一键同步。
 *
 * ## 版本语义（踩坑记录，勿混淆）
 *   - 「内网版本」：来自服务端 /api/registry/sync-status（内网 registry 现有版本）
 *   - 「npmjs 上游版本」：只能来自 bridge（/api/registry/meta）——服务端查不到外网
 * 卡片上的 "npmjs vX" 必须是**真上游**；bridge 不可用时显示占位，
 * 绝不拿内网版本冒充（曾因此把内网 0.1.6 显示成 npmjs 0.1.6）。
 */`,
  'npm.js': `/**
 * 「npm 包同步」：把任意通用 npm 包（含依赖树）镜像进内网 registry。
 *
 * 与「插件策略」的区别：这里管的是**非插件的通用依赖**（如 @deepseek-ai/dsh 本体、
 * zod 等），用于加速同事端安装；清单独立存 mirror-packages.json，不下发客户端。
 * 支持 pkg@spec 指定版本/dist-tag（需 launcher ≥ 0.3.0）。
 */`,
  'menu.js': `/**
 * 托盘菜单策略：统一下发同事端 launcher 的快捷链接。
 */`,
  'clients.js': `/**
 * 客户端状态展示（概览 KPI + 客户端卡片）。
 *
 * 数据来自客户端主动上报（POST /api/sync），服务端只是记录者，不反向探测。
 */`,
  'launcher.js': `/**
 * launcher 托盘发布物管理（内网自托管自动更新）。
 *
 * 上传新 exe 到服务端 → 同事端 launcher 轮询 /api/launcher/latest 发现新版
 * → 下载 → sha256 校验 → 替换自身。sha256 由服务端计算（管理页 http 非安全上下文，
 * 前端 crypto.subtle 不可用）。
 */`,
  'boot.js': `/**
 * 启动引导（最后加载）：校验 token → 加载数据；并起定时刷新。
 */`,
}

fs.mkdirSync(OUT_DIR, { recursive: true })
for (const file of ORDER) {
  const segs = segments.filter((s) => s.file === file)
  const body = segs.map((s) => s.text).join('\n')
  const content = HEADERS[file] + '\n\n' + body.replace(/^\n+/, '') + '\n'
  fs.writeFileSync(path.join(OUT_DIR, file), content, 'utf8')
  const declN = segs.filter((s) => s.decl).length
  console.log(`  ${file.padEnd(13)} ${String(declN).padStart(2)} 声明 / ${String(segs.length).padStart(2)} 段`)
}

console.log(`\n已写出 ${ORDER.length} 个文件到 src/web/`)
console.log(`不变式校验通过：${segments.length} 段拼接后可逐字节还原原文件`)
