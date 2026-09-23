/**
 * launcher 发布物端点（内网自托管自动更新）。
 *
 * GET  /api/launcher/latest          最新版本元数据（免鉴权，同事 launcher 轮询）
 * GET  /api/launcher/download?file=  exe 下载（免鉴权，文件名白名单防穿越）
 * POST /api/launcher/releases?v=     上传新版本（管理员鉴权，body=exe 裸字节）
 *
 * sha256 由**服务端自算**：管理页通过 http 访问（非 secure context），
 * 前端 crypto.subtle 不可用。notes 经 X-Notes 请求头传（避免 query 中文编码问题），
 * 需 decodeHeaderUtf8 还原（Node 按 latin1 解请求头）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { send, readBody, readRawBody } = require('../http')
const { decodeHeaderUtf8 } = require('../text')

/** 版本号格式：x.y.z 或 x.y.z-预发布（如 0.3.0、0.1.2-rc.1）。 */
const VERSION_RE = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/

/** GET /api/launcher/latest：最新版本元数据（免鉴权）。 */
function latestRelease(ctx, req, res) {
  const meta = ctx.launcherReleases.readLauncherReleaseMeta()
  if (!meta) return send(res, 200, { noRelease: true })
  // 下载走 /api/launcher/download?file=...（内网访问者用 Host 拼绝对地址）
  return send(res, 200, Object.assign({}, meta))
}

/** GET /api/launcher/download?file=：下载 exe（免鉴权，文件名白名单防穿越）。 */
function downloadRelease(ctx, req, res, url) {
  const file = url.searchParams.get('file') || ''
  if (!/^[A-Za-z0-9._-]+$/.test(file)) return send(res, 400, { error: 'invalid file' })
  const fp = path.join(ctx.paths.launcherReleasesDir, file)
  if (!fs.existsSync(fp)) return send(res, 404, { error: 'not found' })
  const data = fs.readFileSync(fp)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': data.length,
    'Content-Disposition': 'attachment; filename="' + file + '"',
  })
  res.end(data)
}

/** POST /api/launcher/releases?v=<ver>：上传新版本（管理员鉴权）。 */
async function uploadRelease(ctx, req, res, url) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  const ver = (url.searchParams.get('v') || '').trim()
  const notes = decodeHeaderUtf8(req.headers['x-notes']).slice(0, 500)
  if (!VERSION_RE.test(ver)) return send(res, 400, { error: '版本号格式非法（如 0.3.0）' })
  let buf
  try {
    buf = await readRawBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }
  if (buf.length < 1000 * 1024) return send(res, 400, { error: 'exe 过小，非法上传' })
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
  const file = 'launcher-' + ver + '.exe'
  fs.writeFileSync(path.join(ctx.paths.launcherReleasesDir, file), buf)
  const meta = { version: ver, file, sha256, size: buf.length, notes, publishedAt: new Date().toISOString() }
  ctx.launcherReleases.writeLauncherReleaseMeta(meta)
  ctx.launcherReleases.cleanupLauncherReleases(file)
  return send(res, 200, { ok: true, release: meta })
}

/** PATCH /api/launcher/notes：只改最新发布物的更新说明（管理员鉴权，不重传 exe）。 */
async function updateNotes(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  const meta = ctx.launcherReleases.readLauncherReleaseMeta()
  if (!meta || !meta.version) return send(res, 404, { error: '无发布物可改（先上传一次版本）' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : ''
  const next = Object.assign({}, meta, { notes })
  ctx.launcherReleases.writeLauncherReleaseMeta(next)
  return send(res, 200, { ok: true, release: next })
}

module.exports = [
  ['GET', '/api/launcher/latest', latestRelease],
  ['GET', '/api/launcher/download', downloadRelease],
  ['POST', '/api/launcher/releases', uploadRelease],
  ['PATCH', '/api/launcher/notes', updateNotes],
]
