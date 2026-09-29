/**
 * 托盘菜单下发（/api/menu）与三通道版本组合（/api/releases）。
 *
 * GET  免鉴权：客户端拉取（内网分发）
 * POST 需鉴权：管理员更新
 *
 * 这是「三版本管理 + 托盘菜单配置化」的服务端侧：
 * - /api/menu     托盘菜单 JSON（结构对齐客户端 MenuSpec）
 * - /api/releases 三通道版本组合（stable/preview/dev 各一个 Manifest）
 *
 * 与 /api/config 的区别：这两个是**结构化下发**（客户端直接反序列化成类型），
 * 而非 clientDefaults 那种「字段级覆盖」，故独立端点 + 独立存储字段。
 */
'use strict'

const { send, readBody } = require('../http')

/** 校验版本号（semver 主干 + 可选预发布，如 0.1.7-rc.2）。 */
function validVersion(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(v.trim())
}

/** 校验插件版本清单 [{name, version}]。 */
function validatePlugins(arr) {
  if (!Array.isArray(arr)) return { ok: false, error: 'plugins 必须是数组' }
  const cleaned = []
  for (const p of arr) {
    if (typeof p !== 'object' || p === null) return { ok: false, error: 'plugins 项必须是对象' }
    if (typeof p.name !== 'string' || p.name.trim() === '') return { ok: false, error: 'plugins[].name 不能为空' }
    if (!validVersion(p.version)) return { ok: false, error: `plugins[].version 非法: ${p.version}` }
    cleaned.push({ name: p.name.trim(), version: p.version.trim() })
  }
  return { ok: true, cleaned }
}

/** 校验单个通道的 Manifest。 */
function validateManifest(m) {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    return { ok: false, error: 'Manifest 必须是对象' }
  }
  const cleaned = { releaseId: '', dsh: '', plugins: [], jobs: [] }
  if (m.releaseId !== undefined) {
    if (typeof m.releaseId !== 'string') return { ok: false, error: 'releaseId 必须是字符串' }
    cleaned.releaseId = m.releaseId.trim()
  }
  if (m.dsh !== undefined) {
    if (m.dsh === '' || m.dsh === null) {
      cleaned.dsh = ''
    } else if (!validVersion(m.dsh)) {
      return { ok: false, error: `dsh 版本非法: ${m.dsh}` }
    } else {
      cleaned.dsh = m.dsh.trim()
    }
  }
  if (m.plugins !== undefined) {
    const pl = validatePlugins(m.plugins)
    if (!pl.ok) return { ok: false, error: pl.error }
    cleaned.plugins = pl.cleaned
  }
  if (m.jobs !== undefined) {
    if (!Array.isArray(m.jobs)) return { ok: false, error: 'jobs 必须是数组' }
    cleaned.jobs = m.jobs.filter((j) => typeof j === 'string' && j.trim() !== '').map((j) => j.trim())
  }
  return { ok: true, cleaned }
}

/** 校验托盘菜单 JSON（结构对齐客户端 MenuSpec）。 */
function validateTrayMenu(tm) {
  if (typeof tm !== 'object' || tm === null || Array.isArray(tm)) {
    return { ok: false, error: 'trayMenu 必须是对象' }
  }
  const cleaned = { version: '', groups: [] }
  if (tm.version !== undefined) {
    if (typeof tm.version !== 'string') return { ok: false, error: 'trayMenu.version 必须是字符串' }
    if (tm.version.length > 100) return { ok: false, error: 'trayMenu.version 过长' }
    cleaned.version = tm.version.trim()
  }
  if (tm.groups !== undefined) {
    if (!Array.isArray(tm.groups)) return { ok: false, error: 'trayMenu.groups 必须是数组' }
    for (const g of tm.groups) {
      if (typeof g !== 'object' || g === null) return { ok: false, error: 'trayMenu.groups 项必须是对象' }
      if (typeof g.id !== 'string' || g.id.trim() === '') return { ok: false, error: 'trayMenu.groups[].id 不能为空' }
      if (typeof g.label !== 'string') return { ok: false, error: 'trayMenu.groups[].label 必须是字符串' }
      const items = []
      if (g.items !== undefined) {
        if (!Array.isArray(g.items)) return { ok: false, error: 'trayMenu.groups[].items 必须是数组' }
        for (const it of g.items) {
          if (typeof it !== 'object' || it === null) return { ok: false, error: 'trayMenu 菜单项必须是对象' }
          if (typeof it.id !== 'string' || it.id.trim() === '') return { ok: false, error: '菜单项 id 不能为空' }
          if (typeof it.label !== 'string') return { ok: false, error: '菜单项 label 必须是字符串' }
          const item = { id: it.id.trim(), label: it.label }
          if (it.capability !== undefined) {
            if (typeof it.capability !== 'string') return { ok: false, error: '菜单项 capability 必须是字符串' }
            item.capability = it.capability.trim()
          }
          if (it.chip !== undefined) {
            if (!['stable', 'preview', 'dev'].includes(it.chip)) return { ok: false, error: `菜单项 chip 非法: ${it.chip}` }
            item.chip = it.chip
          }
          if (it.enabledWhen !== undefined) {
            if (typeof it.enabledWhen !== 'string') return { ok: false, error: '菜单项 enabledWhen 必须是字符串' }
            item.enabledWhen = it.enabledWhen.trim()
          }
          items.push(item)
        }
      }
      cleaned.groups.push({ id: g.id.trim(), label: g.label, items })
    }
  }
  return { ok: true, cleaned }
}

/** POST /api/menu：管理员更新托盘菜单。 */
async function updateMenu(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }
  const check = validateTrayMenu(body.trayMenu || { version: '', groups: [] })
  if (!check.ok) return send(res, 400, { error: check.error })

  const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
  cfg.trayMenu = check.cleaned
  ctx.config.writeConfig(cfg)
  return send(res, 200, { ok: true, trayMenu: cfg.trayMenu })
}

/** POST /api/releases：管理员更新三通道版本组合。 */
async function updateReleases(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }

  const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
  for (const ch of ['stable', 'preview', 'dev']) {
    if (body.releases && body.releases[ch] !== undefined) {
      const m = validateManifest(body.releases[ch])
      if (!m.ok) return send(res, 400, { error: `${ch}: ${m.error}` })
      cfg.releases[ch] = m.cleaned
    }
  }
  ctx.config.writeConfig(cfg)
  return send(res, 200, { ok: true, releases: cfg.releases })
}

/** 路由表项：[method, path, handler]。 */
module.exports = [
  // 客户端拉取托盘菜单（免鉴权，内网）
  ['GET', '/api/menu', (ctx, req, res) => {
    const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
    return send(res, 200, cfg.trayMenu)
  }],
  // 客户端拉取三通道版本组合（免鉴权，内网）
  ['GET', '/api/releases', (ctx, req, res) => {
    const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
    return send(res, 200, cfg.releases)
  }],
  // 管理员更新托盘菜单
  ['POST', '/api/menu', updateMenu],
  // 管理员更新三通道版本组合
  ['POST', '/api/releases', updateReleases],
]
