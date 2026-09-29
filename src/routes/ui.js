/**
 * UI 包分发（/api/ui-bundle）。
 *
 * launcher 三个本地窗口（数字分身激活向导 / 首次欢迎 / 操作进度）的内嵌 HTML
 * 由服务端统一下发版本与内容：客户端同步时发现 uiBundle.version 落后 →
 * 主动 GET /api/ui-bundle（带 version 协商）→ 拿到最新版 HTML → 写入本地缓存目录
 * → 窗口加载时在线优先（读缓存文件）、离线回落（编译期内嵌）。
 *
 * 契约：
 *   GET /api/ui-bundle                 → { version, files: { "<name>.html": "<内容>" } }
 *   GET /api/ui-bundle?v=<version>     → 304 若已是最新；否则返回含该 version 的包
 *
 * 生成方式（管理员）：在管理页「UI 包」区编辑版本号 + 上传 HTML 文件，
 * 服务端只存版本元数据，内容随 GET 按版本返回。文件内容与本仓库
 * `src-tauri/embedded-ui/*.html` 同源（管理员同步其改动）。
 *
 * 安全：本端点免鉴权（客户端拉取用，同 /api/config）；内容为静态 HTML，
 * 客户端加载进本地窗口，与内置同级信任边界。不做服务端→客户端的主动推送。
 */
'use strict'

/** 路由表项：[method, path, handler]。 */
module.exports = [
  ['GET', '/api/ui-bundle', (ctx, req, res) => {
    const ub = ctx.config.normalizeConfig(ctx.config.readConfig()).uiBundle || { version: '', files: {} }
    if (!ub.version) {
      return sendPlain(res, 200, '{}') // 未启用 → 空包
    }
    // 客户端已是最新 → 304（省流量）
    const reqUrl = req.url || ''
    const m = reqUrl.match(/[?&]v=([^&]+)/)
    if (m && m[1] === ub.version) {
      res.writeHead(304, { 'Cache-Control': 'no-store' })
      return res.end()
    }
    return sendJson(res, 200, { version: ub.version, files: ub.files })
  }],
  // 历史版本列表（供管理页回滚下拉）
  ['GET', '/api/ui-bundle/history', (ctx, req, res) => {
    const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
    const history = Array.isArray(cfg.uiBundleHistory) ? cfg.uiBundleHistory : []
    return sendJson(res, 200, {
      current: (cfg.uiBundle && cfg.uiBundle.version) || '',
      history: history.map((h) => ({ version: h.version, savedAt: h.savedAt })),
    })
  }],
  // 回滚到历史版本
  ['POST', '/api/ui-bundle/rollback', (ctx, req, res) => {
    if (!ctx.authorized(req)) return sendJson(res, 403, { error: 'unauthorized' })
    const reqUrl = req.url || ''
    const m = reqUrl.match(/[?&]v=([^&]+)/)
    const target = m ? decodeURIComponent(m[1]) : ''
    if (!target) return sendJson(res, 400, { error: '缺少目标版本 ?v=' })
    const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
    const history = Array.isArray(cfg.uiBundleHistory) ? cfg.uiBundleHistory : []
    const hit = history.find((h) => h.version === target)
    if (!hit) return sendJson(res, 404, { error: '历史版本不存在: ' + target })
    // 当前版本归档（避免回滚后又丢失可回滚点）
    const cur = cfg.uiBundle || {}
    if (cur.version && !history.some((h) => h.version === cur.version)) {
      history.unshift({ version: cur.version, savedAt: new Date().toISOString(), files: cur.files || {} })
    }
    cfg.uiBundle = { version: hit.version, files: hit.files }
    ctx.config.writeConfig(cfg)
    return sendJson(res, 200, { ok: true, version: hit.version })
  }],
]

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendPlain(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}
