/**
 * 客户端上报记录（clients/<clientId>.json）读写。
 *
 * 中心服务端的角色是「记录者」：只接收并保存客户端上报的同步状态，
 * 不主动探测客户端（网络边界：服务端不出外网、不反向连客户端）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** clientId 合法性：字母数字与连字符，长度 8-64（防路径穿越）。 */
const CLIENT_ID_RE = /^[a-zA-Z0-9-]{8,64}$/

/** 归一化旧版客户端记录：补新字段默认值，保证 /api/status 输出结构稳定。 */
function normalizeClientRecord(c) {
  if (!c || typeof c !== 'object') return null
  return {
    clientId: c.clientId || '',
    hostname: c.hostname || '',
    dshVersion: c.dshVersion || '',
    launcherVersion: c.launcherVersion || '',
    installed: Array.isArray(c.installed) ? c.installed : [],
    pending: Array.isArray(c.pending) ? c.pending : [],
    plugins: Array.isArray(c.plugins) ? c.plugins : [],
    menu: Array.isArray(c.menu) ? c.menu : [],
    menuApplied: !!c.menuApplied,
    profiles: Array.isArray(c.profiles) ? c.profiles : [],
    configState:
      c.configState && typeof c.configState === 'object'
        ? { profile: c.configState.profile || '', port: Number(c.configState.port) || 0 }
        : { profile: '', port: 0 },
    bridgeStatus:
      c.bridgeStatus && typeof c.bridgeStatus === 'object'
        ? { enabled: !!c.bridgeStatus.enabled, port: Number(c.bridgeStatus.port) || 0 }
        : { enabled: false, port: 0 },
    offline: !!c.offline,
    lastSyncAt: c.lastSyncAt || '',
  }
}

/**
 * 把客户端上报的原始 body 规整成待落盘记录（字段截断，防超长/注入）。
 * 纯函数：不落盘，便于单测。
 */
function buildClientRecord(body) {
  return {
    clientId: String(body.clientId || '').trim(),
    hostname: String(body.hostname || '').slice(0, 128),
    dshVersion: String(body.dshVersion || '').slice(0, 64),
    launcherVersion: String(body.launcherVersion || '').slice(0, 64),
    installed: Array.isArray(body.installed) ? body.installed.filter((x) => typeof x === 'string') : [],
    pending: Array.isArray(body.pending) ? body.pending.filter((x) => typeof x === 'string') : [],
    // 插件详情（跨所有 profile）：[{name, version, description, profile, client}]
    plugins: Array.isArray(body.plugins)
      ? body.plugins
          .filter((p) => p && typeof p.name === 'string')
          .map((p) => ({
            name: String(p.name).slice(0, 128),
            version: String(p.version || '').slice(0, 64),
            description: String(p.description || '').slice(0, 256),
            profile: String(p.profile || '').slice(0, 64),
            client: !!p.client,
          }))
      : [],
    // 实际托盘菜单
    menu: Array.isArray(body.menu)
      ? body.menu
          .filter((m) => m && typeof m.label === 'string')
          .map((m) => ({
            label: String(m.label).slice(0, 64),
            url: String(m.url || '').slice(0, 2048),
          }))
      : [],
    // 菜单策略是否已应用
    menuApplied: !!body.menuApplied,
    // 客户端 profile 列表
    profiles: Array.isArray(body.profiles)
      ? body.profiles.filter((x) => typeof x === 'string').map((x) => String(x).slice(0, 64))
      : [],
    // 配置状态
    configState: {
      profile: String((body.configState && body.configState.profile) || '').slice(0, 64),
      port: Number((body.configState && body.configState.port) || 0) || 0,
    },
    // 管理能力（外网代理网关）状态
    bridgeStatus: {
      enabled: !!(body.bridgeStatus && body.bridgeStatus.enabled),
      port: Number((body.bridgeStatus && body.bridgeStatus.port) || 0) || 0,
    },
    offline: !!body.offline,
    lastSyncAt: new Date().toISOString(),
  }
}

/**
 * @param {{clientsDir:string}} deps
 */
function createClientsStore({ clientsDir }) {
  /** 列出全部客户端记录（损坏文件跳过）。 */
  function listClients() {
    try {
      return fs
        .readdirSync(clientsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(clientsDir, f), 'utf8'))
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  /** 保存一条客户端记录。 */
  function saveClientRecord(record) {
    fs.writeFileSync(path.join(clientsDir, record.clientId + '.json'), JSON.stringify(record, null, 2), 'utf8')
  }

  return { listClients, saveClientRecord, normalizeClientRecord, buildClientRecord, CLIENT_ID_RE }
}

module.exports = { createClientsStore, normalizeClientRecord, buildClientRecord, CLIENT_ID_RE }
