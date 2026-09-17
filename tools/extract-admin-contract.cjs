/**
 * admin.js 契约提取：把「浏览器脚本对外契约」固化成 JSON，供拆分前后逐项对比。
 *
 *   node tools/extract-admin-contract.cjs <admin.js 路径...> <输出 JSON>
 *
 * 契约三要素（拆分/重构必须逐项一致）：
 *   1. 顶层声明名（全局函数/变量）——onclick 内联调用与跨脚本引用依赖它们
 *   2. DOM id 引用——必须都能在管理页 HTML 里找到（否则运行时空引用）
 *   3. 全局函数调用关系——粗粒度检查（避免拆错文件导致引用悬空）
 *
 * 用法示例：
 *   node tools/extract-admin-contract.cjs admin.js tests/admin-contract-before.json
 *   node tools/extract-admin-contract.cjs admin-*.js tests/admin-contract-after.json
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const out = args.pop()
const inputs = args

const decls = []
const domIds = new Set()
const calls = new Set()
let totalLines = 0

const DECL_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(let|const|var)\s+([A-Za-z_$][\w$]*)/
const ID_RE = /getElementById\(\s*["']([^"']+)["']\s*\)/g
const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g

for (const file of inputs) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  totalLines += lines.length
  lines.forEach((l, i) => {
    const m = l.match(DECL_RE)
    if (m) {
      decls.push({ name: m[1] || m[3], kind: m[1] ? 'function' : 'var', file: path.basename(file), line: i + 1 })
    }
    let mm
    ID_RE.lastIndex = 0
    while ((mm = ID_RE.exec(l))) domIds.add(mm[1])
    CALL_RE.lastIndex = 0
    while ((mm = CALL_RE.exec(l))) calls.add(mm[1])
  })
}

// 声明名重复 = 拆分后可能重复定义（浏览器里后者覆盖前者，是隐患）
const nameCount = {}
for (const d of decls) nameCount[d.name] = (nameCount[d.name] || 0) + 1
const duplicates = Object.entries(nameCount).filter(([, n]) => n > 1).map(([k]) => k)

const doc = {
  files: inputs.map((f) => path.basename(f)),
  totalLines,
  declCount: decls.length,
  declarations: decls.map((d) => d.name).sort(),
  duplicates,
  domIds: [...domIds].sort(),
  calledNames: [...calls].sort(),
}
fs.writeFileSync(out, JSON.stringify(doc, null, 2), 'utf8')
console.log(
  `${inputs.length} 个文件 / ${totalLines} 行 / 顶层声明 ${decls.length} 个 / DOM id ${domIds.size} 个 → ${out}`
)
if (duplicates.length) console.log('⚠ 重复声明：' + duplicates.join(', '))
