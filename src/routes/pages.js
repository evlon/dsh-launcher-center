/**
 * 静态页面端点（/、/admin、/admin.js、/download）。
 *
 * 这些端点的响应头是对外契约（基线探针逐项校验），注意差异：
 *   /admin    → 200 text/html，**无** Cache-Control（历史行为，保持）
 *   /admin.js → 200 application/javascript + no-store（热改即生效）
 *   /download → 200 text/html + no-store
 *   /         → 302 → /admin
 *
 * /admin.js 每次请求从磁盘读取（管理页改动无需重启服务端），
 * 因此读失败要返回明确错误而不是崩溃。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { send } = require('../http')
const { adminPageHtml } = require('../views/adminPage')
const { downloadPageHtml } = require('../views/downloadPage')

/** GET /：引导到管理页（配置插件 + launcher.exe 发布等管理员功能入口）。 */
function rootRedirect(ctx, req, res) {
  res.writeHead(302, { Location: '/admin', 'Cache-Control': 'no-store' })
  res.end()
}

/** GET /admin：单文件管理页（页面本身可访问；鉴权在页面内的 token 输入 + 各 API 调用）。 */
function adminPage(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(adminPageHtml())
}

/** GET /admin.js：管理页脚本（独立文件，避免模板字符串转义问题；每次读盘，改即生效）。 */
function adminScript(ctx, req, res) {
  const jsPath = path.join(ctx.paths.rootDir, 'admin.js')
  try {
    const js = fs.readFileSync(jsPath, 'utf8')
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(js)
  } catch (e) {
    return send(res, 500, { error: 'admin.js 读取失败: ' + e.message })
  }
}

/** GET /download：公开下载页（免鉴权，给同事的 launcher 下载入口，便于直接转发链接）。 */
function downloadPage(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(downloadPageHtml(ctx.launcherReleases.readLauncherReleaseMeta))
}

module.exports = [
  ['GET', '/', rootRedirect],
  ['GET', '/admin', adminPage],
  ['GET', '/admin.js', adminScript],
  ['GET', '/download', downloadPage],
]
