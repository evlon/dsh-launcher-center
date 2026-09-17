/**
 * 一次性提取脚本：把 server.js 里的两个 HTML 视图函数原样搬到 src/views/。
 * 用脚本而非手抄——420 行中文 HTML/CSS 模板字符串手抄必错。
 * 用完即可删除（保留在仓库里也无害，但重构后它依赖的行号会失效）。
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'server.js')
const lines = fs.readFileSync(SRC, 'utf8').split('\n') // 0-based

/** 按 1-based 行号区间取文本（含首尾）。 */
function slice(from, to) {
  return lines.slice(from - 1, to).join('\n')
}

const outDir = path.join(__dirname, '..', 'src', 'views')
fs.mkdirSync(outDir, { recursive: true })

// 校验边界（防止 server.js 变动后静默取错）
function assertLine(n, expect) {
  const got = lines[n - 1]
  if (!got.includes(expect)) {
    throw new Error(`行 ${n} 期望包含「${expect}」，实际：「${got}」`)
  }
}
assertLine(903, 'function downloadPageHtml()')
assertLine(959, '}')
assertLine(960, 'function escapeHtml(s)')
assertLine(964, '}')
assertLine(967, 'function adminPageHtml()')
assertLine(1386, '}')

const download = slice(903, 959)
const escape = slice(960, 964)
const admin = slice(967, 1386)

fs.writeFileSync(
  path.join(outDir, 'downloadPage.js'),
  `/**
 * 公开下载页（免鉴权，给同事直接转发链接）。
 * 展示当前 launcher 发布版本 + 下载按钮 + sha256 校验说明；无发布物时给出提示。
 * 依赖注入 readLauncherReleaseMeta（读发布元数据），便于单测替换。
 */
'use strict'

${escape.replace('function escapeHtml(s)', 'function escapeHtml(s)')}

${download}

module.exports = { downloadPageHtml, escapeHtml }
`,
  'utf8'
)

fs.writeFileSync(
  path.join(outDir, 'adminPage.js'),
  `/**
 * 管理控制台单页（HTML + 内联 CSS）。脚本逻辑在 admin.js（独立文件，便于阅读与热改）。
 * 纯静态字符串，无外部依赖；DOM id 是 admin.js 的契约，改动需同步。
 */
'use strict'

${admin}

module.exports = { adminPageHtml }
`,
  'utf8'
)

// downloadPageHtml 依赖 readLauncherReleaseMeta：提取时它是自由变量，改为参数注入
let dl = fs.readFileSync(path.join(outDir, 'downloadPage.js'), 'utf8')
dl = dl.replace('function downloadPageHtml() {', 'function downloadPageHtml(readLauncherReleaseMeta) {')
fs.writeFileSync(path.join(outDir, 'downloadPage.js'), dl, 'utf8')

console.log('已提取：src/views/downloadPage.js, src/views/adminPage.js')
console.log('downloadPage 行数=' + fs.readFileSync(path.join(outDir, 'downloadPage.js'), 'utf8').split('\n').length)
console.log('adminPage   行数=' + fs.readFileSync(path.join(outDir, 'adminPage.js'), 'utf8').split('\n').length)
