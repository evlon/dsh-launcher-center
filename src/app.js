/**
 * 应用组装：把参数、存储、registry 客户端、路由组装成一个可启动的 HTTP 服务。
 *
 * 这是重构后的「组合根」（composition root）——所有依赖在此显式注入，
 * 各模块自身不依赖 __dirname / 全局状态，便于隔离测试与复用。
 *
 * 对外行为与重构前完全一致（由 tests/golden-probe.cjs 逐端点校验）。
 */
'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const { createRouter } = require('./router')
const { send } = require('./http')
const { createConfigStore } = require('./store/config')
const { createClientsStore } = require('./store/clients')
const { createMirrorPackagesStore } = require('./store/mirrorPackages')
const { createLauncherReleasesStore } = require('./store/launcherReleases')
const { createRegistryClient } = require('./registry')

const configRoutes = require('./routes/config')
const syncRoutes = require('./routes/sync')
const registryRoutes = require('./routes/registry')
const mirrorRoutes = require('./routes/mirror')
const launcherRoutes = require('./routes/launcher')
const pageRoutes = require('./routes/pages')

/**
 * @param {{port:number, data:string, token:string}} args 已解析的命令行参数
 * @param {{rootDir?:string, registry?:object}} [opts] rootDir=server.js 所在目录（读 admin.js 用）
 */
function createApp(args, opts = {}) {
  const rootDir = opts.rootDir || __dirname

  // ---------- 路径 ----------
  const paths = {
    rootDir,
    dataDir: args.data,
    configPath: path.join(args.data, 'config.json'),
    clientsDir: path.join(args.data, 'clients'),
    // 「npm 包同步」清单（通用 npm 包镜像，非插件）——独立文件，不进 config.json
    mirrorPackagesPath: path.join(args.data, 'mirror-packages.json'),
    // launcher 托盘自身发布物（exe + 元数据）——供同事 launcher 内网自动更新
    launcherReleasesDir: path.join(args.data, 'launcher-releases'),
    launcherMetaPath: path.join(args.data, 'launcher-releases', 'latest.json'),
  }

  // ---------- 存储 ----------
  const config = createConfigStore({ configPath: paths.configPath })
  const clients = createClientsStore({ clientsDir: paths.clientsDir })
  const mirrorPackages = createMirrorPackagesStore({ path: paths.mirrorPackagesPath })
  const launcherReleases = createLauncherReleasesStore({
    dir: paths.launcherReleasesDir,
    metaPath: paths.launcherMetaPath,
  })
  const registry = opts.registry || createRegistryClient()

  /** 首次启动准备数据目录与默认文件。 */
  function ensureData() {
    fs.mkdirSync(paths.dataDir, { recursive: true })
    fs.mkdirSync(paths.clientsDir, { recursive: true })
    if (!fs.existsSync(paths.configPath)) {
      config.writeConfig(config.defaultConfig())
    }
    if (!fs.existsSync(paths.mirrorPackagesPath)) {
      mirrorPackages.writeMirrorPackages([])
    }
    fs.mkdirSync(paths.launcherReleasesDir, { recursive: true })
  }

  /** 管理鉴权：未设 token 时放行（仅内网部署）；设了则校验 X-Admin-Token。 */
  function authorized(req) {
    if (!args.token) return true // 未设 token 时管理操作仅限内网（不鉴权）
    const h = req.headers['x-admin-token']
    return typeof h === 'string' && h === args.token
  }

  // 注入路由处理函数所需的上下文（显式依赖，无隐式全局）
  const ctx = {
    args,
    paths,
    config,
    clients,
    mirrorPackages,
    launcherReleases,
    registry,
    authorized,
  }

  const router = createRouter([
    configRoutes,
    syncRoutes,
    registryRoutes,
    mirrorRoutes,
    launcherRoutes,
    pageRoutes,
  ])

  /** 创建 HTTP 服务（未 listen）。 */
  function createServer() {
    return http.createServer((req, res) => {
      router
        .handle(ctx, req, res)
        .then((hit) => {
          if (!hit) send(res, 404, { error: 'not found' })
        })
        .catch((e) => {
          try {
            send(res, 500, { error: e.message })
          } catch {
            /* 连接已断 */
          }
        })
    })
  }

  return { paths, ctx, router, createServer, ensureData }
}

module.exports = { createApp }
