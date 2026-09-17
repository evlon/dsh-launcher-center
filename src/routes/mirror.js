/**
 * 「npm 包同步」清单端点（/api/mirror/packages）。
 *
 * GET  需鉴权：读清单
 * POST 需鉴权：整表替换（管理页增删后自动保存）
 *
 * 清单仅管理用途，**不下发给客户端**（避免客户端解析未知字段）。
 */
'use strict'

const { send, readBody } = require('../http')
const { validPackageName, validMirrorSpec } = require('../validate')

/** GET /api/mirror/packages：读清单（管理鉴权）。 */
function getPackages(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  return send(res, 200, { packages: ctx.mirrorPackages.readMirrorPackages() })
}

/** POST /api/mirror/packages：整表替换（管理鉴权）。 */
async function putPackages(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }
  const list = Array.isArray(body.packages) ? body.packages : []
  const cleaned = []
  for (const x of list) {
    let name = typeof x === 'string' ? x.trim() : x && typeof x.name === 'string' ? x.name.trim() : ''
    let spec = typeof x === 'string' ? '' : x && typeof x.spec === 'string' ? x.spec.trim() : ''
    // 支持 "pkg@spec" 字符串输入（管理页直接贴，含 scoped：取最后一个 @）
    if (name.includes('@') && name.lastIndexOf('@') > 0) {
      const at = name.lastIndexOf('@')
      const n = name.slice(0, at)
      const v = name.slice(at + 1)
      if (validPackageName(n)) {
        if (!spec && v) spec = v
        name = n
      }
    }
    if (!validPackageName(name)) return send(res, 400, { error: 'invalid package name: ' + name })
    if (!validMirrorSpec(spec)) return send(res, 400, { error: 'invalid spec: ' + spec })
    cleaned.push({ name, spec: spec || 'latest' })
  }
  // 去重（name 相同保留后者）
  const seen = new Set()
  const dedup = []
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (!seen.has(cleaned[i].name)) {
      seen.add(cleaned[i].name)
      dedup.unshift(cleaned[i])
    }
  }
  ctx.mirrorPackages.writeMirrorPackages(dedup)
  return send(res, 200, { packages: dedup })
}

module.exports = [
  ['GET', '/api/mirror/packages', getPackages],
  ['POST', '/api/mirror/packages', putPackages],
]
