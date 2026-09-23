/**
 * 客户端配置分发与更新（/api/config）。
 *
 * GET  免鉴权：客户端拉取推荐插件与配置（内网分发）
 * POST 需鉴权：管理员更新配置（plugins / profilePlugins / managedMenu /
 *              clientDefaults / envDefaults / mirrorSettings / baseUrl / version）
 *
 * 校验顺序与错误文案是对外契约（管理页与自查脚本依赖），改动需同步测试。
 */
'use strict'

const {
  validPackageName,
  validateManagedMenu,
  validateProfilePlugins,
  validateEnvDefaults,
  validateJobPresets,
  normalizeStringList,
} = require('../validate')
const { send, readBody } = require('../http')

/** POST /api/config：把管理员提交的字段逐项校验后合并写入。 */
async function updateConfig(ctx, req, res) {
  if (!ctx.authorized(req)) return send(res, 403, { error: 'unauthorized' })
  let body
  try {
    body = await readBody(req)
  } catch (e) {
    return send(res, 400, { error: e.message })
  }

  const plugins = Array.isArray(body.plugins) ? body.plugins : []
  const bad = plugins.filter((x) => !validPackageName(x))
  if (bad.length) return send(res, 400, { error: 'invalid package names: ' + bad.join(', ') })

  const menuCheck = validateManagedMenu(body.managedMenu)
  if (!menuCheck.ok) return send(res, 400, { error: menuCheck.error })

  const cfg = ctx.config.normalizeConfig(ctx.config.readConfig())
  cfg.plugins = [...new Set(plugins)] // 去重保序

  // 按 profile 精确下发清单：可选，校验通过则整体替换（未传则保留原值）。
  if (body.profilePlugins !== undefined) {
    const pp = validateProfilePlugins(body.profilePlugins)
    if (!pp.ok) return send(res, 400, { error: pp.error })
    cfg.profilePlugins = pp.cleaned
  }

  if (body.managedMenu !== undefined) {
    cfg.managedMenu = {
      enabled: !!body.managedMenu.enabled,
      quickLinks: (body.managedMenu.quickLinks || []).map((q) => ({
        label: q.label.trim(),
        url: q.url.trim(),
      })),
    }
  }

  // 客户端默认配置覆盖（clientDefaults）：校验合法字段
  if (body.clientDefaults !== undefined) {
    const cd = body.clientDefaults
    if (typeof cd !== 'object' || cd === null || Array.isArray(cd)) {
      return send(res, 400, { error: 'clientDefaults 必须是对象' })
    }
    const cleaned = {}
    // npmRegistry / ghMirrorPrefix 支持字符串或字符串数组（多源）
    if (cd.npmRegistry !== undefined) {
      const n = normalizeStringList(cd.npmRegistry)
      if (n === undefined) return send(res, 400, { error: 'clientDefaults.npmRegistry 必须是字符串或字符串数组' })
      if (n !== null) cleaned.npmRegistry = n
    }
    if (cd.ghMirrorPrefix !== undefined) {
      const g = normalizeStringList(cd.ghMirrorPrefix)
      if (g === undefined) return send(res, 400, { error: 'clientDefaults.ghMirrorPrefix 必须是字符串或字符串数组' })
      if (g !== null) cleaned.ghMirrorPrefix = g
    }
    if (cd.port !== undefined) {
      const port = Number(cd.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return send(res, 400, { error: 'clientDefaults.port 必须在 1-65535' })
      }
      cleaned.port = port
    }
    if (cd.syncIntervalSecs !== undefined) {
      const s = Number(cd.syncIntervalSecs)
      if (!Number.isInteger(s) || s < 30) return send(res, 400, { error: 'clientDefaults.syncIntervalSecs 必须 >= 30' })
      cleaned.syncIntervalSecs = s
    }
    if (cd.profile !== undefined) {
      if (typeof cd.profile !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(cd.profile)) {
        return send(res, 400, { error: 'clientDefaults.profile 非法' })
      }
      cleaned.profile = cd.profile
    }
    if (cd.useSystemNode !== undefined) {
      if (typeof cd.useSystemNode !== 'boolean') {
        return send(res, 400, { error: 'clientDefaults.useSystemNode 必须是布尔值' })
      }
      cleaned.useSystemNode = cd.useSystemNode
    }
    // dshRegistry：内网 dsh 安装源（同事 launcher 装/更新 dsh 时走内网 npm registry，
    // 写入其 mirrorSettings.registry）。空串=清除（不覆盖，回退地域源）。
    if (cd.dshRegistry !== undefined) {
      if (cd.dshRegistry === '' || cd.dshRegistry === null) {
        cleaned.dshRegistry = ''
      } else if (typeof cd.dshRegistry !== 'string' || !/^https?:\/\/\S+$/.test(cd.dshRegistry.trim())) {
        return send(res, 400, { error: 'clientDefaults.dshRegistry 必须是 http(s) 地址或空串' })
      } else {
        cleaned.dshRegistry = cd.dshRegistry.trim()
      }
    }
    cfg.clientDefaults = cleaned
  }

  // 环境默认配置（envDefaults）：{ "<namespace>": { "<key>": "<value>" } }
  // 落到客户端 $DSH_HOME/settings.yaml（各插件读内网服务地址等统一值）。
  if (body.envDefaults !== undefined) {
    const ed = validateEnvDefaults(body.envDefaults)
    if (!ed.ok) return send(res, 400, { error: ed.error })
    cfg.envDefaults = ed.cleaned
  }

  // 预装岗位清单（jobPresets）：字符串数组，新用户激活数字人后 himarket 自动落盘。
  if (body.jobPresets !== undefined) {
    const jp = validateJobPresets(body.jobPresets)
    if (!jp.ok) return send(res, 400, { error: jp.error })
    cfg.jobPresets = jp.cleaned
  }

  // 镜像上传设置（mirrorSettings）：registry 合法 URL + tokenValue（发布凭证，存服务端）
  if (body.mirrorSettings !== undefined) {
    const ms = body.mirrorSettings
    if (typeof ms !== 'object' || ms === null || Array.isArray(ms)) {
      return send(res, 400, { error: 'mirrorSettings 必须是对象' })
    }
    const cleanedMs = {}
    if (ms.registry !== undefined) {
      if (typeof ms.registry !== 'string' || !/^https?:\/\/\S+$/.test(ms.registry.trim())) {
        return send(res, 400, { error: 'mirrorSettings.registry 必须是 http(s) 地址' })
      }
      cleanedMs.registry = ms.registry.trim()
    }
    if (ms.tokenValue !== undefined) {
      if (typeof ms.tokenValue !== 'string') return send(res, 400, { error: 'mirrorSettings.tokenValue 必须是字符串' })
      cleanedMs.tokenValue = ms.tokenValue.trim()
    }
    if (ms.dshMirrorUrl !== undefined) {
      if (ms.dshMirrorUrl === '') {
        cleanedMs.dshMirrorUrl = '' // 清空内网 dsh 分发源
      } else if (typeof ms.dshMirrorUrl !== 'string' || !/^https?:\/\/\S+$/.test(ms.dshMirrorUrl.trim())) {
        return send(res, 400, { error: 'mirrorSettings.dshMirrorUrl 必须是 http(s) 地址' })
      } else {
        cleanedMs.dshMirrorUrl = ms.dshMirrorUrl.trim()
      }
    }
    // 注意：未传的字段回落默认值（历史行为，管理页保存时传全量三字段）
    cfg.mirrorSettings = Object.assign(
      { registry: 'http://registry.ict.cmcc', tokenValue: '', dshMirrorUrl: '' },
      cleanedMs
    )
  }

  if (typeof body.baseUrl === 'string') cfg.baseUrl = body.baseUrl
  if (typeof body.version === 'number') cfg.version = body.version
  ctx.config.writeConfig(cfg)
  return send(res, 200, ctx.config.normalizeConfig(cfg))
}

/** 路由表项：[method, path, handler]。 */
module.exports = [
  // 客户端拉取配置（免鉴权，内网）
  ['GET', '/api/config', (ctx, req, res) => send(res, 200, ctx.config.normalizeConfig(ctx.config.readConfig()))],
  // 管理员更新配置
  ['POST', '/api/config', updateConfig],
]
