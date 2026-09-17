/**
 * npm registry 查询（元信息 + 同步状态），带缓存。
 *
 * ## 网络边界（重要设计约束）
 * 中心服务端**默认不出外网**——只查 REGISTRY_OVERRIDE 注入的内网 registry。
 * npmjs / npmmirror 外网源仅在显式 ALLOW_UPSTREAM=1（能出网的部署）时才追加兜底。
 *
 * 上游元信息（npmjs 最新版本）的常规查询应由管理页经**管理员本机 launcher
 * bridge** 中转——服务端内网隔离时不应、也无法直连外网。见 README「网络边界与角色」。
 *
 * ## 语义警告（踩坑记录）
 * 服务端查到的 latest 是**内网已有版本**，不是 npmjs 上游版本。管理页绝不能把它
 * 当作「npmjs 最新版」显示（曾因此把内网 0.1.6 显示成 npmjs 0.1.6，导致
 * 「npmjs 已发新版但页面永远显示旧版」）。调用方须按 registry 字段判断来源。
 */
'use strict'

const META_CACHE_TTL_MS = 10 * 60 * 1000 // 10 分钟缓存

/**
 * 构造 registry 源列表（模块级一次性求值，与旧行为一致）。
 * @param {NodeJS.ProcessEnv} env
 */
function buildRegistries(env) {
  const registries = []
  // 允许通过环境变量注入内网 registry（server 启动时 REGISTRY_OVERRIDE=http://registry.ict.cmcc）
  if (env.REGISTRY_OVERRIDE) {
    registries.push({ url: env.REGISTRY_OVERRIDE.replace(/\/+$/, ''), label: '内网' })
  }
  if (env.ALLOW_UPSTREAM === '1') {
    registries.push(
      { url: 'https://registry.npmjs.org', label: 'npmjs' },
      { url: 'https://registry.npmmirror.com', label: 'npmmirror' }
    )
  }
  return registries
}

/**
 * @param {{registries?:Array<{url:string,label:string}>, fetchImpl?:Function}} [deps]
 */
function createRegistryClient(deps = {}) {
  const registries = deps.registries || buildRegistries(process.env)
  const doFetch = deps.fetchImpl || fetch
  const metaCache = new Map() // name -> { meta, fetchedAt }

  /** 从 registry 拉取单个插件元信息（仅内网源；ALLOW_UPSTREAM=1 时追加 npmjs→npmmirror 兜底）。 */
  async function fetchPluginMeta(name) {
    for (const reg of registries) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 6000)
        const res = await doFetch(`${reg.url}/${encodeURIComponent(name).replace(/%2F/gi, '/')}`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'dsh-harness-launcher-admin/0.1' },
        })
        clearTimeout(timer)
        if (!res.ok) continue
        const data = await res.json()
        const latest = (data['dist-tags'] && data['dist-tags'].latest) || ''
        const ver = latest ? data.versions && data.versions[latest] : null
        return {
          name,
          latest,
          description: (ver && ver.description) || data.description || '',
          homepage: (ver && ver.homepage) || data.homepage || '',
          repository: (ver && ver.repository && ver.repository.url) || '',
          registry: reg.label,
        }
      } catch (e) {
        // 尝试下一个源
      }
    }
    return { name, latest: '', description: '', homepage: '', repository: '', registry: '' }
  }

  /** 批量查询插件元信息（带缓存），失败返回 null 字段不阻断。 */
  async function fetchPluginsMeta(names) {
    const out = []
    for (const name of names) {
      const cached = metaCache.get(name)
      if (cached && Date.now() - cached.fetchedAt < META_CACHE_TTL_MS) {
        out.push(cached.meta)
        continue
      }
      const meta = await fetchPluginMeta(name)
      metaCache.set(name, { meta, fetchedAt: Date.now() })
      out.push(meta)
    }
    return out
  }

  /** 强制刷新：绕过 META_CACHE，重新查上游（管理页「刷新同步状态」按钮调用）。 */
  async function fetchPluginsMetaNoCache(names) {
    const out = []
    for (const name of names) {
      const meta = await fetchPluginMeta(name)
      if (meta && meta.latest) metaCache.set(name, { meta, fetchedAt: Date.now() })
      out.push(meta)
    }
    return out
  }

  /**
   * 查询某个 registry 上单个包的「同步状态」（是否已存在 + dist-tags.latest 版本）。
   *
   * 由服务端转发查询的原因（历史踩坑）：管理页所在本机到 registry 之间可能存在
   * 透明代理（uproxy）改写响应，浏览器直查会得到损坏 JSON 而误判「未同步」。
   *
   * 返回 { state: "synced"|"unsynced"|"error", version?, targetVersion?, targetSynced?, registry, spec }
   */
  async function fetchSyncStatus(name, registryUrl, spec) {
    const reg = (registryUrl || '').trim().replace(/\/+$/, '') || 'http://registry.ict.cmcc'
    const out = { registry: reg, spec: spec || 'latest' }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await doFetch(`${reg}/${encodeURIComponent(name).replace(/%2F/gi, '/')}`, {
        signal: ctrl.signal,
        // identity：明确不接收压缩，避免中间代理 gzip 改写引入的编码损坏
        headers: { 'User-Agent': 'dsh-harness-launcher-admin/0.1', 'Accept-Encoding': 'identity' },
      })
      clearTimeout(timer)
      if (res.ok) {
        const j = await res.json()
        const latest = (j['dist-tags'] && j['dist-tags'].latest) || ''
        out.version = latest
        // 内网已有该包：spec 指定版本/tag 时，需确认该版本确实存在（dist-tags.latest
        // 不反映 rc/next 等 tag 版本是否已同步）。versions 键命中 = 已同步。
        if (spec && spec !== 'latest' && j.versions) {
          // spec 可能是 dist-tag：先解 tag → 版本号，再查 versions
          let target = j['dist-tags'] && j['dist-tags'][spec]
          if (!target) target = spec // 直接版本号
          out.targetVersion = target
          out.targetSynced = !!j.versions[target]
          out.state = out.targetSynced ? 'synced' : 'unsynced'
          return out
        }
        out.state = latest ? 'synced' : 'unsynced'
        return out
      }
      if (res.status === 404) {
        out.state = 'unsynced'
        return out
      }
      out.state = 'error'
      out.error = `HTTP ${res.status}`
      return out
    } catch (e) {
      out.state = 'error'
      out.error = e && e.name === 'AbortError' ? 'timeout' : e && e.message ? e.message : 'network'
      return out
    }
  }

  return {
    registries,
    fetchPluginMeta,
    fetchPluginsMeta,
    fetchPluginsMetaNoCache,
    fetchSyncStatus,
    metaCache,
    META_CACHE_TTL_MS,
  }
}

module.exports = { createRegistryClient, buildRegistries, META_CACHE_TTL_MS }
