/**
 * 路由分发：把「method + pathname」映射到处理函数。
 *
 * 取代原先 route() 里 412 行的 if-else 链。行为契约保持不变：
 *   - 所有响应先设 CORS 头（含 OPTIONS 预检直接 204）
 *   - 未命中 → 404 {"error":"not found"}
 *   - 处理函数抛错 → 由调用方（app.createServer）兜底转 500
 *
 * 匹配是**精确路径**（非前缀），与旧实现一致。
 */
'use strict'

/**
 * @param {Array<Array>} routeModules 各路由模块导出的 [method, path, handler] 数组集合
 * @returns {{handle:(ctx:object, req:object, res:object)=>Promise<boolean>}}
 */
function createRouter(routeModules) {
  const table = new Map()
  for (const mod of routeModules) {
    for (const [method, path, handler] of mod) {
      const key = method + ' ' + path
      if (table.has(key)) throw new Error('重复路由: ' + key)
      table.set(key, handler)
    }
  }

  /**
   * 分发请求。命中并处理返回 true；未命中返回 false（调用方回 404）。
   */
  async function handle(ctx, req, res) {
    // CORS（管理页与客户端可能跨源）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, X-Notes')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return true
    }

    const url = new URL(req.url, 'http://localhost')
    const handler = table.get(req.method + ' ' + url.pathname)
    if (!handler) return false
    await handler(ctx, req, res, url)
    return true
  }

  return { handle, table }
}

module.exports = { createRouter }
