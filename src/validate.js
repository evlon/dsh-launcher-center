/**
 * 输入校验：包名 / spec / profile 名 / 菜单 / 按 profile 插件清单。
 * 全部为纯函数（无 IO），便于单测与复用。
 *
 * 安全取向：所有进入数据文件或下发给客户端的字段都必须过这里，
 * 拒绝注入面（空格、引号、斜杠穿越、非 http(s) 协议等）。
 */
'use strict'

/** npm 包名合法性：作用域包或普通包，字母数字 . - _ ~；禁止空格/斜杠/引号（防注入）。 */
function validPackageName(name) {
  return (
    typeof name === 'string' &&
    /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) &&
    !name.includes('..')
  )
}

/** spec 合法性：空 = latest；否则仅允许版本号 / dist-tag / semver 范围字符（禁 @ / 空格注入）。 */
function validMirrorSpec(spec) {
  if (spec === '' || spec === 'latest') return true
  return (
    typeof spec === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9.*+^~<>=|\s-]*$/.test(spec.trim()) &&
    !spec.includes('@') &&
    spec.trim().length <= 64
  )
}

/** profile 名合法性：字母数字 - _（与客户端 resolve_profile 的白名单一致）。 */
function validProfileName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name)
}

/** 菜单项合法性：label 非空、url 仅 http/https（拒绝 file:/javascript: 等注入面）。 */
function validQuickLink(item) {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.label === 'string' &&
    item.label.trim().length > 0 &&
    item.label.length <= 64 &&
    typeof item.url === 'string' &&
    /^https?:\/\/\S+$/i.test(item.url.trim()) &&
    item.url.length <= 2048
  )
}

/** 校验 managedMenu 策略：返回 { ok, error }。 */
function validateManagedMenu(m) {
  if (m === undefined || m === null) return { ok: true }
  if (typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'managedMenu 必须是对象' }
  if (typeof m.enabled !== 'boolean') return { ok: false, error: 'managedMenu.enabled 必须是布尔值' }
  if (!Array.isArray(m.quickLinks)) return { ok: false, error: 'managedMenu.quickLinks 必须是数组' }
  const bad = m.quickLinks.filter((q) => !validQuickLink(q))
  if (bad.length) return { ok: false, error: 'managedMenu.quickLinks 含非法项（label 非空、url 需 http/https）' }
  return { ok: true }
}

/**
 * 校验并清洗 profilePlugins：{ "<profile>": ["pkg", ...] }。
 * 返回 { ok, cleaned, error }。profile 名与包名均复用现有校验。
 */
function validateProfilePlugins(pp) {
  if (pp === undefined || pp === null) return { ok: true, cleaned: undefined }
  if (typeof pp !== 'object' || Array.isArray(pp)) {
    return { ok: false, error: 'profilePlugins 必须是对象（{ profile: [pkg, ...] }）' }
  }
  const cleaned = {}
  for (const [profile, list] of Object.entries(pp)) {
    if (!validProfileName(profile)) {
      return { ok: false, error: `profilePlugins 的 profile 名「${profile}」非法（限字母数字-_）` }
    }
    if (!Array.isArray(list)) {
      return { ok: false, error: `profilePlugins.${profile} 必须是数组` }
    }
    const bad = list.filter((x) => !validPackageName(x))
    if (bad.length) {
      return { ok: false, error: `profilePlugins.${profile} 含非法包名：${bad.join(', ')}` }
    }
    cleaned[profile] = [...new Set(list)] // 去重保序
  }
  return { ok: true, cleaned }
}

/** envDefaults 的键名/namespace 合法性（限字母数字-_）。 */
const ENV_KEY_RE = /^[A-Za-z0-9_-]+$/

/**
 * 校验并清洗 envDefaults：{ "<namespace>": { "<key>": "<value>" } }。
 * 值只接受字符串/数字/布尔（数组与对象会覆盖插件复杂配置，明确拒绝）。
 * 返回 { ok, cleaned, error }。
 */
function validateEnvDefaults(ed) {
  if (typeof ed !== 'object' || ed === null || Array.isArray(ed)) {
    return { ok: false, error: 'envDefaults 必须是对象' }
  }
  const cleaned = {}
  for (const [ns, kv] of Object.entries(ed)) {
    if (!ENV_KEY_RE.test(ns)) {
      return { ok: false, error: `envDefaults 的 namespace「${ns}」非法（限字母数字-_）` }
    }
    if (typeof kv !== 'object' || kv === null || Array.isArray(kv)) {
      return { ok: false, error: `envDefaults.${ns} 必须是对象（{key: value}）` }
    }
    const cleanKv = {}
    for (const [k, v] of Object.entries(kv)) {
      if (!ENV_KEY_RE.test(k)) {
        return { ok: false, error: `envDefaults.${ns} 的键「${k}」非法（限字母数字-_）` }
      }
      if (typeof v === 'string') {
        cleanKv[k] = v.trim()
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        cleanKv[k] = String(v)
      } else {
        return {
          ok: false,
          error: `envDefaults.${ns}.${k} 只支持字符串/数字/布尔（数组与对象会覆盖插件的复杂配置，请改在插件设置页配）`,
        }
      }
    }
    cleaned[ns] = cleanKv
  }
  return { ok: true, cleaned }
}

/** 字符串或字符串数组 → 数组（空则 null）；类型非法返回 undefined。 */
function normalizeStringList(v) {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : null
  if (Array.isArray(v)) {
    const out = v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    return out.length ? out : null
  }
  return undefined // 非法类型
}

module.exports = {
  validPackageName,
  validMirrorSpec,
  validProfileName,
  validQuickLink,
  validateManagedMenu,
  validateProfilePlugins,
  validateEnvDefaults,
  normalizeStringList,
  ENV_KEY_RE,
}
