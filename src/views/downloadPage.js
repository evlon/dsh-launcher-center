/**
 * 公开下载页（免鉴权，给同事直接转发链接）。
 * 展示当前 launcher 发布版本 + 下载按钮 + sha256 校验说明；无发布物时给出提示。
 * 依赖注入 readLauncherReleaseMeta（读发布元数据），便于单测替换。
 */
'use strict'

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function downloadPageHtml(readLauncherReleaseMeta) {
  const meta = readLauncherReleaseMeta();
  const host = ""; // 相对路径即可（同源）
  const sizeMb = meta && meta.size ? (meta.size / 1024 / 1024).toFixed(1) : "";
  const dlHref = meta ? `/api/launcher/download?file=${encodeURIComponent(meta.file)}` : "";
  const body = meta
    ? `
    <div class="ver">最新版本 <b>v${escapeHtml(meta.version)}</b></div>
    <div class="meta">${escapeHtml(meta.file)} · ${sizeMb} MB · 发布于 ${escapeHtml(String(meta.publishedAt || "").slice(0, 10))}</div>
    ${meta.notes ? `<div class="notes">${escapeHtml(meta.notes)}</div>` : ""}
    <a class="dl" href="${dlHref}">⬇ 下载数字分身启动器（Windows）</a>
    <div class="hint">下载后双击运行即可。安装包已内网自托管，无需外网。</div>
    <details class="sha"><summary>校验文件完整性（可选）</summary>
      <p>在 PowerShell 里执行，输出应与下面一致：</p>
      <pre>Get-FileHash "$env:USERPROFILE\\Downloads\\${escapeHtml(meta.file)}" -Algorithm SHA256</pre>
      <p>官方 SHA256：</p>
      <pre>${escapeHtml(meta.sha256 || "")}</pre>
    </details>`
    : `<div class="ver">暂无可下载版本</div><div class="hint">管理员尚未发布 launcher 安装包，请稍后再试或联系管理员。</div>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>下载数字分身启动器</title>
<style>
  :root{ --fg:#1f2328; --muted:#6b7280; --line:#e5e7eb; --blue:#2563eb; }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
        font:15px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; color:var(--fg);
        background:linear-gradient(160deg,#f6f8fb,#eef2f7); padding:24px; }
  .card{ width:100%; max-width:560px; background:#fff; border:1px solid var(--line);
         border-radius:14px; padding:28px 26px; box-shadow:0 8px 28px rgba(15,23,42,.06); }
  h1{ font-size:19px; margin:0 0 4px; }
  .sub{ color:var(--muted); font-size:13px; margin-bottom:18px; }
  .ver{ font-size:17px; margin-bottom:4px; }
  .meta{ color:var(--muted); font-size:13px; margin-bottom:10px; }
  .notes{ font-size:13px; background:#f8fafc; border:1px solid var(--line); border-radius:8px;
          padding:8px 10px; margin-bottom:14px; color:#374151; }
  .dl{ display:block; text-align:center; background:var(--blue); color:#fff; text-decoration:none;
       padding:13px 18px; border-radius:10px; font-size:16px; font-weight:600; }
  .dl:hover{ background:#1d4ed8; }
  .hint{ color:var(--muted); font-size:12.5px; margin-top:10px; text-align:center; }
  .sha{ margin-top:18px; font-size:13px; }
  .sha summary{ cursor:pointer; color:var(--blue); }
  pre{ background:#0f172a; color:#e2e8f0; padding:10px; border-radius:8px; overflow:auto; font-size:12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>数字分身启动器</h1>
    <div class="sub">企业内网自托管 · 自动检查更新</div>
    ${body}
  </div>
</body>
</html>`;
}

module.exports = { downloadPageHtml, escapeHtml }
