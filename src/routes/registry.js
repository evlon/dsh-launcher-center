/**
 * registry 查询端点（/api/plugins/meta、/api/registry/sync-status）。
 *
 * ## 架构说明（重要）
 * 这两个端点让**服务端**去访问 registry。生产环境下中心服务端在机房集群内，
 * 未必能解析/访问内网 registry（实测生产集群 CoreDNS 拒绝解析 registry.ict.cmcc，
 * 导致管理页徽章全部「⚠ 查询失败」）。
 *
 * 按网络边界设计，registry 查询**本应由管理员本机 launcher（bridge）承担**——
 * 它既能出外网（查 npmjs 上游）又能访问内网 registry，是天然的桥接者。
 * 这里保留服务端实现是为了：
 *   ① 兼容尚未升级的旧版 launcher（无 bridge registry 端点时降级）；
 *   ② 服务端可直连内网 registry 的部署（如开发机同机场景）。
 * 管理页会优先走 bridge，失败才回落这两个端点。
 */
'use strict'

const { send } = require('../http')
const { validPackageName } = require('../validate')

/** GET /api/plugins/meta：插件元信息（名称来自 /api/config 的 plugins，免鉴权）。 */
async function pluginsMeta(ctx, req, res, url) {
  const namesParam = url.searchParams.get('names') || ''
  const force = url.searchParams.get('force') === '1'
  const names = namesParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && validPackageName(s))
  if (!names.length) return send(res, 200, { plugins: [] })
  const plugins = force
    ? await ctx.registry.fetchPluginsMetaNoCache(names)
    : await ctx.registry.fetchPluginsMeta(names)
  return send(res, 200, { plugins })
}

/**
 * GET /api/registry/sync-status：查内网 registry 上各包的同步状态（管理页徽章）。
 *
 * registry 取自镜像设置 mirrorSettings.registry，query 参数 registry 可覆盖
 * （管理页当前表单值优先）。names 支持 "pkg@spec"（spec=精确版本/dist-tag/semver，
 * 用于 npm 包同步 tab），无 @ 视为 latest（兼容插件策略页调用）。
 */
async function syncStatus(ctx, req, res, url) {
  const namesParam = url.searchParams.get('names') || ''
  const rawNames = namesParam.split(',').map((s) => s.trim()).filter(Boolean)
  const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
  const cfgReg = (cfg.mirrorSettings && cfg.mirrorSettings.registry) || 'http://registry.ict.cmcc'
  const regOverride = (url.searchParams.get('registry') || '').trim()
  const registry = /^https?:\/\/\S+$/.test(regOverride) ? regOverride : cfgReg
  const out = {}
  for (const raw of rawNames) {
    // 拆 "pkg@spec"；scoped 包（@scope/name）自身含 @，取最后一个 @
    const at = raw.lastIndexOf('@')
    const hasSpec = at > 0
    const name = hasSpec ? raw.slice(0, at) : raw
    if (!validPackageName(name)) continue
    const spec = hasSpec ? raw.slice(at + 1) : 'latest'
    out[name] = await ctx.registry.fetchSyncStatus(name, registry, spec)
  }
  return send(res, 200, { registry, plugins: out })
}

module.exports = [
  ['GET', '/api/plugins/meta', pluginsMeta],
  ['GET', '/api/registry/sync-status', syncStatus],
]
