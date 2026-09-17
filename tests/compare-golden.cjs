/**
 * 黄金基线对比：逐用例比对重构前后两个探针输出。
 *
 *   node tests/compare-golden.cjs tests/golden-before.json tests/golden-after.json
 *
 * 退出码 0 = 完全一致（行为零差异）；1 = 存在差异（并打印明细）。
 */
'use strict'
const fs = require('node:fs')

const before = JSON.parse(fs.readFileSync(process.argv[2] || 'tests/golden-before.json', 'utf8'))
const after = JSON.parse(fs.readFileSync(process.argv[3] || 'tests/golden-after.json', 'utf8'))

const bMap = new Map(before.results.map((r) => [r.name, r]))
const aMap = new Map(after.results.map((r) => [r.name, r]))

let diff = 0
const names = [...new Set([...bMap.keys(), ...aMap.keys()])]
for (const name of names) {
  const b = bMap.get(name)
  const a = aMap.get(name)
  if (!b) {
    console.log(`仅新版本存在: ${name}`)
    diff++
    continue
  }
  if (!a) {
    console.log(`仅旧版本存在: ${name}`)
    diff++
    continue
  }
  const problems = []
  if (b.status !== a.status) problems.push(`status ${b.status} → ${a.status}`)
  if (JSON.stringify(b.headers) !== JSON.stringify(a.headers)) {
    problems.push(`headers ${JSON.stringify(b.headers)} → ${JSON.stringify(a.headers)}`)
  }
  if (JSON.stringify(b.body) !== JSON.stringify(a.body)) {
    const bs = JSON.stringify(b.body)
    const as = JSON.stringify(a.body)
    problems.push(`body\n      旧: ${bs.slice(0, 300)}\n      新: ${as.slice(0, 300)}`)
  }
  if (problems.length) {
    console.log(`✗ ${name}`)
    for (const p of problems) console.log('    ' + p)
    diff++
  }
}

console.log(`\n对比完成：旧 ${before.count} 例 / 新 ${after.count} 例，差异 ${diff} 处`)
if (before.childStderrTail !== after.childStderrTail) {
  console.log('注意：子进程 stderr 尾部不同（可能仅启动日志差异）')
}
process.exit(diff > 0 ? 1 : 0)
