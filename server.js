#!/usr/bin/env node
/**
 * 企业中心服务端 —— DeepSeek Harness Launcher 的配置同步服务（入口薄壳）。
 *
 * 零依赖（仅 Node 内置模块），管理员在内网服务器上运行：
 *   node server.js [--port 8080] [--data ./data] [--token <admin-token>]
 *
 * ## 本文件的职责
 * 只做「参数解析 → 组装应用 → 监听端口 → 打印启动信息」。
 * 业务实现全部在 src/ 下，按职责分层（见 README「代码结构」）：
 *   src/app.js            组合根：注入依赖、组装路由、创建 HTTP 服务
 *   src/router.js         路由表分发（取代原先 412 行 if-else 链）
 *   src/registry.js       npm registry 查询（含网络边界与语义警告）
 *   src/validate.js       输入校验（包名/spec/profile/菜单/envDefaults）
 *   src/store/*.js        数据读写（config / clients / mirrorPackages / launcherReleases）
 *   src/routes/*.js       各端点处理函数
 *   src/views/*.js        页面 HTML（管理页 / 下载页）
 *
 * ## 端点
 *   GET  /api/config                客户端拉取推荐插件与配置（免鉴权）
 *   POST /api/config                更新配置（需 token）
 *   POST /api/sync                  客户端上报同步状态（免鉴权）
 *   GET  /api/status                管理员查看所有客户端同步情况（需 token）
 *   GET  /api/plugins/meta          插件元信息（registry 查询，带缓存，force=1 绕过）
 *   GET  /api/registry/sync-status  内网 registry 同步状态（管理页徽章）
 *   GET  /api/mirror/packages       「npm 包同步」清单（需 token）
 *   POST /api/mirror/packages       整表替换该清单（需 token）
 *   GET  /api/launcher/latest       launcher 最新发布元数据（免鉴权，同事端轮询）
 *   GET  /api/launcher/download     exe 下载（免鉴权，文件名白名单）
 *   POST /api/launcher/releases     上传 launcher 新版本（需 token）
 *   PATCH /api/launcher/notes       只改最新发布物的更新说明（需 token，不重传 exe）
 *   GET  /                          302 → /admin
 *   GET  /admin                     管理控制台
 *   GET  /admin.js                  管理页脚本（每次读盘，改即生效）
 *   GET  /download                  公开下载页（给同事）
 *
 * ## 数据（JSON 文件，--data 目录，默认 ./data）
 *   config.json               中心配置（插件清单/菜单策略/环境默认值等）
 *   clients/<clientId>.json   每台客户端的最近一次上报
 *   mirror-packages.json      「npm 包同步」清单（仅管理侧，不下发客户端）
 *   launcher-releases/        launcher 发布物（exe + latest.json）
 *
 * ## 环境变量
 *   REGISTRY_OVERRIDE   注入内网 registry（如 http://registry.ict.cmcc）
 *   ALLOW_UPSTREAM=1    额外允许服务端直连 npmjs/npmmirror（默认关闭，见网络边界设计）
 */
'use strict'

const path = require('node:path')
const { parseArgs } = require('./src/args')
const { createApp } = require('./src/app')

const ARGS = parseArgs(process.argv.slice(2), path.join(__dirname, 'data'))

const app = createApp(ARGS, { rootDir: __dirname })
app.ensureData()

const server = app.createServer()
server.listen(ARGS.port, '0.0.0.0', () => {
  console.log('Harness Launcher 中心服务已启动:')
  console.log('  管理页:      http://<本机IP>:' + ARGS.port + '/admin' + (ARGS.token ? '' : '（未设 token）'))
  console.log('  客户端配置:  http://<本机IP>:' + ARGS.port + '/api/config')
  console.log('  数据目录:    ' + ARGS.data)
  if (!ARGS.token) {
    console.log('  警告: 未设置 --token，管理写操作无鉴权，仅建议内网使用。')
  }
})

module.exports = { app, server }
