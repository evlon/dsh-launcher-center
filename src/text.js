/**
 * 文本处理：HTML 转义、HTTP 头 UTF-8 还原。
 */
'use strict'

/** HTML 转义（下载页与管理页内联内容用）。 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * 修正 HTTP 头里的 UTF-8 中文。
 *
 * 背景（实测踩坑）：Node 按 RFC 7230 把请求头值解码为 **latin1**，而客户端
 * 实际发送的是 UTF-8 字节。直接使用会得到乱码（如「默认」→「é»è®¤」）。
 * 做法：把 latin1 字符串按字节还原，再以 UTF-8 重新解码。
 * 若原文是纯 ASCII（还原后仍为 ASCII）则保持原样，不影响英文 notes。
 */
function decodeHeaderUtf8(value) {
  if (typeof value !== 'string' || value === '') return ''
  try {
    const bytes = Buffer.from(value, 'latin1')
    const decoded = bytes.toString('utf8')
    // 还原后若含替换字符（U+FFFD），说明原本就不是 UTF-8 → 保留原值
    return decoded.includes('\uFFFD') ? value : decoded
  } catch {
    return value
  }
}

module.exports = { escapeHtml, decodeHeaderUtf8 }
