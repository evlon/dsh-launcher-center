/**
 * HTTP 基础设施：JSON 响应、请求体读取（JSON / 原始字节）。
 * 与业务无关，供各路由复用。
 */
'use strict'

/** 发送 JSON 响应（统一 Content-Type / no-store / Content-Length）。 */
function send(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * 读取并解析 JSON 请求体（默认上限 1MB）。
 * 解析失败以 Error 抛出，由调用方转 400（保持各端点一致的错误文案）。
 */
function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (e) {
        reject(new Error('invalid json: ' + e.message))
      }
    })
    req.on('error', reject)
  })
}

/** 读取原始字节体（上传 launcher 安装包等二进制用，limit 单位字节）。 */
function readRawBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

module.exports = { send, readBody, readRawBody }
