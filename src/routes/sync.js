/**
 * 客户端同步上报与管理员查看（/api/sync、/api/status、/api/clients）。
 *
 * 中心服务端的核心角色之一是「记录者」：客户端周期上报自己的同步状态，
 * 服务端只落盘并在管理页展示，不反向探测客户端。
 *
 * 离线判定由**服务端**计算（客户端上报时 offline 恒为 false，不可作为在线依据）：
 *   offline = now - lastSyncAt > max(3 × syncIntervalSecs, 15 分钟)
 */
'use strict'

const { send, readBody } = require('../http')
const { offlineThresholdSecs, isOffline } = require('../store/clients')

/** 从中心配置读同步间隔（clientDefaults.syncIntervalSecs），失败回落默认 300s。 */
function syncIntervalOf(ctx) {
  try {
    const cfg = ctx.config.readConfig()
    return (cfg.clientDefaults && cfg.clientDefaults.syncIntervalSecs) || undefined
  } catch {
    return undefined
  }
}

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
  const threshold = offlineThresholdSecs(syncIntervalOf(ctx))
  const now = Date.now()
  const clients = ctx.clients
    .listClients()
    .map(ctx.clients.normalizeClientRecord)
    .filter(Boolean)
    .map((c) => Object.assign({}, c, { offline: isOffline(c, now, threshold) }))
    .sort((a, b) => (b.lastSyncAt || '').localeCompare(a.lastSyncAt || ''))
  return send(res, 200, { clients, offlineThresholdSecs: threshold })
}

/**
 * DELETE /api/clients：删除客户端记录（需 token）。
 *
 * body: { clientId }  删单个
 *       { clientIds: [...] }  批量
 *       { offline: true }  删除当前所有**离线**记录（按同一阈值判定）
 *
 * 客户端 clientId 本地持久化（~/.dsh-launcher/client-id），在线客户端下次同步
 * （≤ syncIntervalSecs）会用同一 id 重新上报并重建记录，故删除在线客户端无副作用。
 */
async function deleteClients(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }

  let ids = []
  if (body.offline === true) {
    const threshold = offlineThresholdSecs(syncIntervalOf(ctx))
    const now = Date.now()
    ids = ctx.clients
      .listClients()
      .map(ctx.clients.normalizeClientRecord)
      .filter(Boolean)
      .filter((c) => isOffline(c, now, threshold))
      .map((c) => c.clientId)
  } else if (Array.isArray(body.clientIds)) {
    ids = body.clientIds
  } else if (body.clientId !== undefined) {
    ids = [body.clientId]
  } else {
    return send(res, 400, { error: '需要 clientId / clientIds / offline' })
  }

  const bad = ids.filter((x) => typeof x !== 'string' || !ctx.clients.CLIENT_ID_RE.test(x))
  if (bad.length) return send(res, 400, { error: 'invalid clientId: ' + bad.join(', ') })

  const deleted = ctx.clients.deleteClients(ids)
  return send(res, 200, { ok: true, deleted, requested: ids.length })
}

module.exports = [
  ['POST', '/api/sync', reportSync],
  ['GET', '/api/status', listStatus],
  ['DELETE', '/api/clients', deleteClients],
]
