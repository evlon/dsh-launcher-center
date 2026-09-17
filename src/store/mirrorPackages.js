/**
 * 「npm 包同步」清单（mirror-packages.json）读写。
 *
 * 这是**管理侧**数据（管理员决定把哪些通用 npm 包镜像进内网），
 * 独立于 config.json，且**不下发给客户端**（客户端只消费内网 registry）。
 */
'use strict'

const fs = require('node:fs')
const { validPackageName } = require('../validate')

/**
 * @param {{path:string}} deps
 */
function createMirrorPackagesStore({ path: filePath }) {
  /** 读清单（默认空数组；文件损坏/缺失回退空；非法项过滤）。 */
  function readMirrorPackages() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (Array.isArray(raw)) {
        return raw
          .filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && validPackageName(x.name))
          .map((x) => ({
            name: x.name,
            spec: typeof x.spec === 'string' && x.spec.trim() ? x.spec.trim() : 'latest',
          }))
      }
    } catch {
      /* 文件缺失/损坏 → 空清单 */
    }
    return []
  }

  /** 写清单（整表替换）。 */
  function writeMirrorPackages(list) {
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
  }

  return { readMirrorPackages, writeMirrorPackages }
}

module.exports = { createMirrorPackagesStore }
