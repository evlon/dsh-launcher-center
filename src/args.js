/**
 * 命令行参数解析。
 *
 *   node server.js [--port 8080] [--data ./data] [--token <admin-token>]
 *
 * defaultDataDir 由调用方传入（server.js 的 __dirname 下 data/），
 * 使本模块不依赖自身位置，便于测试与复用。
 */
'use strict'

const path = require('node:path')

/**
 * @param {string[]} argv 已去掉 node 与脚本名的参数数组
 * @param {string} defaultDataDir 未传 --data 时的数据目录
 * @returns {{port:number, data:string, token:string}}
 */
function parseArgs(argv, defaultDataDir) {
  const args = { port: 8080, data: defaultDataDir, token: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') args.port = parseInt(argv[++i], 10) || 8080
    else if (a === '--data') args.data = path.resolve(argv[++i])
    else if (a === '--token') args.token = argv[++i] || ''
  }
  return args
}

module.exports = { parseArgs }
