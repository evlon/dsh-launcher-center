/**
 * 管理页脚本装配：把 src/web/*.js 按依赖顺序拼成一份脚本，供 GET /admin.js 返回。
 *
 * ## 为什么服务端拼接，而不是改 HTML 挂 10 个 <script>
 *   ① 管理页 HTML 里的 `<script src="/admin.js">` 保持不变（对外契约不变）；
 *   ② 部署链路（Dockerfile / k8s 重建脚本）无需新增静态路由；
 *   ③ **源码即部署物**——不需要「先构建再部署」，避免生成文件与源码漂移；
 *   ④ 保留原有「每次请求读盘」特性：改 src/web/ 下任一模块，刷新页面即生效。
 *
 * ## 顺序即依赖
 * core.js 声明全局状态（其余模块函数体引用它）→ 各功能模块 → boot.js 最后
 * （boot 内的 IIFE 立即执行，必须等所有函数声明就绪）。
 *
 * ## 全局作用域说明
 * 拼接后所有模块共享同一全局作用域（等价于原来的单文件），因此
 * 模块间可直接互相调用、内联 onclick 也能找到全局函数——这是刻意保持的行为。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

/** 加载顺序（依赖顺序，勿随意调整）。 */
const ORDER = [
  'core.js', // 全局状态 + 通用工具（必须最先）
  'auth.js', // 登录门禁 + Tab
  'config.js', // 中心配置 / 客户端默认值
  'bridge.js', // 本机管理能力（外网代理网关）
  'plugins.js', // 插件策略与同步
  'npm.js', // npm 包同步
  'menu.js', // 菜单策略
  'clients.js', // 客户端展示
  'launcher.js', // launcher 发布物
  'boot.js', // 启动引导（必须最后）
]

/**
 * 读取并拼接管理页脚本。
 * @param {string} rootDir server.js 所在目录（src/web 相对它定位）
 * @returns {{code:string, sha256:string, modules:number}}
 */
function readAdminScript(rootDir) {
  const dir = path.join(rootDir, 'src', 'web')
  const parts = []
  for (const f of ORDER) {
    const p = path.join(dir, f)
    if (!fs.existsSync(p)) throw new Error('缺少管理页模块：src/web/' + f)
    parts.push(fs.readFileSync(p, 'utf8').replace(/\s+$/, ''))
  }
  const body = parts.join('\n\n')
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  const header =
    '/* 管理页脚本 —— 由服务端按 src/web/*.js 顺序拼接（见 src/adminScript.js）。\n' +
    ' * 请勿在本文件搜索源码：修改请改 src/web/ 下对应模块，刷新页面即生效。\n' +
    ' * 模块顺序：' + ORDER.join(' → ') + '\n' +
    ' * 内容 sha256：' + sha256 + '\n' +
    ' */\n'
  return { code: header + body + '\n', sha256, modules: ORDER.length }
}

module.exports = { readAdminScript, ORDER }
