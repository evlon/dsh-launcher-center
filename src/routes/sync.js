/**
 * 客户端同步上报与管理员查看（/api/sync、/api/status）。
 *
 * 中心服务端的核心角色之一是「记录者」：客户端周期上报自己的同步状态，
 * 服务端只落盘并在管理页展示，不反向探测客户端。
 */
'use strict'

const { send, readBody } = require('../http')

/** POST /api/sync：客户端上报同步状态（免鉴权，内网）。 */
async function reportSync(ctx, req, res) {
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }
  const clientId = String(body.clientId || '').trim()
  if (!clientId || !ctx.clients.CLIENT_ID_RE.test(clientId)) {
    return send(res, 400, { error: 'invalid clientId' })
  }
  const record = ctx.clients.buildClientRecord(Object.assign({}, body, { clientId }))
  ctx.clients.saveClientRecord(record)
  return send(res, 200, { ok: true, lastSyncAt: record.lastSyncAt })
}

/** GET /api/status：管理员查看所有客户端状态（需 token，按最近上报倒序）。 */
function listStatus(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  const clients = ctx.clients
    .listClients()
    .map(ctx.clients.normalizeClientRecord)
    .sort((a, b) => (b.lastSyncAt || '').localeCompare(a.lastSyncAt || ''))
  return send(res, 200, { clients })
}

module.exports = [
  ['POST', '/api/sync', reportSync],
  ['GET', '/api/status', listStatus],
]
