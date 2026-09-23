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

/**
 * 校验预装岗位清单（jobPresets）：字符串数组，元素为岗位技能名（HiMarket market-skills
 * 里的 name，供 himarket 插件按名找 productId 下载落盘）。
 * 元素限「字母数字-_」，去重保序；空数组合法（清空下发清单）。
 */
function validateJobPresets(v) {
  if (v === undefined || v === null) return { ok: true, cleaned: [] }
  if (!Array.isArray(v)) return { ok: false, error: 'jobPresets 必须是字符串数组' }
  const out = []
  const seen = new Set()
  for (const item of v) {
    if (typeof item !== 'string') return { ok: false, error: 'jobPresets 元素必须是字符串' }
    const t = item.trim()
    if (t === '') continue
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t)) {
      return { ok: false, error: `jobPresets 元素「${t}」非法（限字母数字-_，≤64 字符）` }
    }
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return { ok: true, cleaned: out }
}

module.exports = {
  validPackageName,
  validMirrorSpec,
  validProfileName,
  validQuickLink,
  validateManagedMenu,
  validateProfilePlugins,
  validateEnvDefaults,
  validateJobPresets,
  normalizeStringList,
  ENV_KEY_RE,
}
