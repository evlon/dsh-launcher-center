/**
 * launcher 托盘自身发布物（exe + latest.json）管理。
 *
 * 用途：内网自托管 launcher 自动更新。同事端 launcher 周期轮询
 * GET /api/launcher/latest 发现新版 → 下载 → sha256 校验 → 替换自身。
 *
 * 只保留最新一个版本的 exe（cleanupLauncherReleases 清旧产物），
 * 避免磁盘无限增长。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * @param {{dir:string, metaPath:string}} deps
 */
function createLauncherReleasesStore({ dir, metaPath }) {
  /** 读最新发布元数据（无发布/损坏返回 null）。 */
  function readLauncherReleaseMeta() {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    } catch {
      return null
    }
  }

  /** 写发布元数据（latest.json）。 */
  function writeLauncherReleaseMeta(meta) {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  }

  /** 删除旧版本产物文件（保留当前 latest 指向的文件；可传 keepFile 排除）。 */
  function cleanupLauncherReleases(keepFile) {
    try {
      const entries = fs.readdirSync(dir)
      for (const f of entries) {
        if (f === 'latest.json') continue
        if (keepFile && f === keepFile) continue
        try {
          fs.unlinkSync(path.join(dir, f))
        } catch {
          /* 忽略删除失败 */
        }
      }
    } catch {
      /* 目录不存在忽略 */
    }
  }

  return { readLauncherReleaseMeta, writeLauncherReleaseMeta, cleanupLauncherReleases }
}

module.exports = { createLauncherReleasesStore }
