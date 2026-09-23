/**
 * 中心配置（config.json）读写与归一化。
 *
 * 工厂模式：路径由调用方注入，模块本身不依赖 __dirname，
 * 便于用临时目录做隔离测试（见 tests/golden-probe.cjs）。
 */
'use strict'

const fs = require('node:fs')

/**
 * 默认配置。字段含义：
 *   plugins        全局应装插件清单（所有 profile 共用）
 *   profilePlugins 按 profile 精确下发：{ "<profileName>": ["pkg", ...] }
 *                  客户端切换/运行某 profile 时优先用它，缺省回落 plugins。
 *                  管理员在这里维护各 profile 该装什么，替代旧版客户端硬编码的 PRESET_PLUGINS。
 *   managedMenu    托盘菜单策略（统一链接下发）
 *   clientDefaults 客户端默认配置（本地显式设置过的不被覆盖）
 *   mirrorSettings 镜像设置（registry / 发布 token / dsh 分发源）
 *   envDefaults    环境默认配置 { "<namespace>": { "<key>": "<value>" } }
 *                  落到客户端 $DSH_HOME/settings.yaml，供各插件读内网服务地址等统一值。
 *                  覆盖策略（客户端侧实现，见 launcher 的 env_defaults.rs）：
 *                    - 环境地址类键（认证域名/服务地址等）→ 服务端有值就【强制覆盖】纠正存量旧值；
 *                    - 其余键（个人凭据等）→ 遵循「只填空缺」，用户已设的不覆盖。
 *                  管理员改一处，全员生效（客户端下次同步时应用）。
 *   jobPresets     预装岗位清单（字符串数组）：新用户激活数字人后，himarket 插件
 *                  按这些岗位名自动下载并落盘到 .agent-presets/，即装即用。
 */
function defaultConfig() {
  return {
    version: 3,
    plugins: [],
    profilePlugins: {},
    managedMenu: { enabled: false, quickLinks: [] },
    clientDefaults: {},
    mirrorSettings: { registry: 'http://registry.ict.cmcc', tokenValue: '' },
    envDefaults: {},
    jobPresets: [],
    updatedAt: new Date().toISOString(),
    baseUrl: '',
  }
}

/**
 * 归一化旧版 config：补 managedMenu / clientDefaults / mirrorSettings / envDefaults /
 * profilePlugins 默认值，保证旧数据平滑升级（就地修改并返回同一对象）。
 */
function normalizeConfig(cfg) {
  if (cfg && typeof cfg === 'object') {
    if (typeof cfg.managedMenu !== 'object' || cfg.managedMenu === null) {
      cfg.managedMenu = { enabled: false, quickLinks: [] }
    }
    if (typeof cfg.clientDefaults !== 'object' || cfg.clientDefaults === null) {
      cfg.clientDefaults = {}
    }
    if (typeof cfg.mirrorSettings !== 'object' || cfg.mirrorSettings === null) {
      cfg.mirrorSettings = { registry: 'http://registry.ict.cmcc', tokenValue: '' }
    }
    if (typeof cfg.envDefaults !== 'object' || cfg.envDefaults === null) {
      cfg.envDefaults = {}
    }
    if (!Array.isArray(cfg.jobPresets)) cfg.jobPresets = []
    if (typeof cfg.plugins !== 'object' || !Array.isArray(cfg.plugins)) cfg.plugins = []
    if (typeof cfg.profilePlugins !== 'object' || cfg.profilePlugins === null || Array.isArray(cfg.profilePlugins)) {
      cfg.profilePlugins = {}
    }
  }
  return cfg
}

/**
 * @param {{configPath:string}} deps
 */
function createConfigStore({ configPath }) {
  /** 读取配置（文件缺失/损坏 → 默认配置，不抛错）。 */
  function readConfig() {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'))
    } catch {
      return defaultConfig()
    }
  }

  /** 写配置（自动盖 updatedAt；写入前归一化）。 */
  function writeConfig(cfg) {
    cfg.updatedAt = new Date().toISOString()
    fs.writeFileSync(configPath, JSON.stringify(normalizeConfig(cfg), null, 2), 'utf8')
  }

  return { defaultConfig, normalizeConfig, readConfig, writeConfig }
}

module.exports = { createConfigStore, defaultConfig, normalizeConfig }
