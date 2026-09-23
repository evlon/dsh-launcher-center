/**
 * 管理控制台单页（HTML + 内联 CSS）。脚本逻辑在 admin.js（独立文件，便于阅读与热改）。
 * 纯静态字符串，无外部依赖；DOM id 是 admin.js 的契约，改动需同步。
 */
'use strict'

function adminPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness 中心管理</title>
<style>
  :root{
    --bg:#f4f6fb; --card:#fff; --line:#e5e8f0; --line2:#eef0f6;
    --text:#1a2233; --muted:#7a8394; --faint:#a6aebe;
    --primary:#3b66f0; --primary-weak:#eaf0ff; --primary-ink:#3b66f0;
    --green:#16a34a; --green-bg:#e8f7ee; --amber:#d97706; --amber-bg:#fef3e2;
    --red:#dc2626; --red-bg:#fdeaea; --red-weak:#fff1f1;
    --shadow:0 1px 2px rgba(20,30,60,.04),0 8px 24px rgba(20,30,60,.06);
    --radius:12px;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:var(--bg);color:var(--text);font-size:14px;line-height:1.55;
    -webkit-font-smoothing:antialiased}
  a{color:var(--primary);text-decoration:none}

  /* ── 顶栏 ── */
  .topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;
    height:60px;padding:0 24px;background:#fff;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:15px;white-space:nowrap}
  .brand .logo{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#3b66f0,#7a5cf0);
    display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;font-weight:700}
  .topbar .spacer{flex:1}
  .sync-hint{font-size:12px;color:var(--muted)}
  .sync-hint b{color:var(--text)}

  /* ── 全局基础设施状态栏（本机管理能力 + 内网 registry） ── */
  .infra-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:9px 24px;
    background:#fff;border-bottom:1px solid var(--line);box-shadow:0 1px 0 rgba(20,30,60,.02)}
  .infra-seg{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto}
  .infra-ico{font-size:16px;flex-shrink:0}
  .infra-body{min-width:0;display:flex;flex-direction:column;gap:3px}
  .infra-label{font-size:10.5px;color:var(--faint);font-weight:600;letter-spacing:.03em;white-space:nowrap}
  .infra-ctrl{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
  #bridgeState{font-size:12.5px;font-weight:600;white-space:nowrap}

  /* ── Tab 导航 ── */
  .tabs{position:sticky;top:0;z-index:19;display:flex;gap:4px;padding:10px 24px 0;
    background:var(--bg);border-bottom:1px solid var(--line)}
  .tab{appearance:none;border:0;background:transparent;cursor:pointer;font-size:14px;
    padding:9px 16px;color:var(--muted);border-radius:9px 9px 0 0;font-weight:500;
    border-bottom:2px solid transparent;transition:.15s}
  .tab:hover{color:var(--text)}
  .tab.active{color:var(--primary);font-weight:650;border-bottom-color:var(--primary);background:#fff}

  /* ── 主区 ── */
  main{max-width:1180px;margin:0 auto;padding:24px}
  .view{display:none}
  .view.active{display:block;animation:fade .18s ease}
  @keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:20px;margin-bottom:18px}
  .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
  .card-title{font-size:15px;font-weight:650;margin:0}
  .card-desc{color:var(--muted);font-size:12.5px;margin-top:3px}
  .empty{color:var(--faint);font-size:13px;padding:14px 2px}

  /* ── 按钮 ── */
  .btn{appearance:none;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);
    background:#fff;color:var(--text);padding:8px 14px;border-radius:8px;cursor:pointer;
    font-size:13.5px;font-weight:550;transition:.15s}
  .btn:hover{border-color:#cdd4e4;background:#fafbfe}
  .btn.primary{background:var(--primary);border-color:var(--primary);color:#fff}
  .btn.primary:hover{background:#2f55d8;border-color:#2f55d8}
  /* 本机管理能力连接按钮状态：已连接（绿）／未授权（黄） */
  .btn.ok{background:var(--green);border-color:var(--green);color:#fff}
  .btn.ok:hover{background:#12833e;border-color:#12833e}
  .btn.warn{background:var(--amber);border-color:var(--amber);color:#fff}
  .btn.warn:hover{background:#b45f06;border-color:#b45f06}
  .btn.ghost{background:transparent;border-color:transparent;color:var(--muted)}
  .btn.ghost:hover{color:var(--text);background:#f2f4f9}
  .btn.sm{padding:5px 10px;font-size:12.5px;border-radius:7px}
  .btn.danger{color:var(--red);border-color:transparent;background:transparent}
  .btn.danger:hover{background:var(--red-bg)}

  /* ── 输入 ── */
  .input{width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:8px;
    font-size:13.5px;font-family:inherit;color:var(--text);background:#fff;transition:.15s}
  .input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-weak)}
  .field{margin-bottom:12px}
  .field label{display:block;font-size:12.5px;color:var(--muted);margin-bottom:5px;font-weight:550}
  .row{display:flex;gap:10px;align-items:center}
  .row .input{flex:1}

  /* ── KPI 卡片 ── */
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);
    padding:16px 18px;display:flex;align-items:center;gap:14px}
  .kpi .ico{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:19px}
  .kpi .num{font-size:24px;font-weight:700;line-height:1.1}
  .kpi .lbl{font-size:12px;color:var(--muted)}
  .kpi.g .ico{background:var(--green-bg)} .kpi.g .num{color:var(--green)}
  .kpi.b .ico{background:var(--primary-weak)} .kpi.b .num{color:var(--primary)}
  .kpi.r .ico{background:var(--red-bg)} .kpi.r .num{color:var(--red)}
  .kpi.a .ico{background:var(--amber-bg)} .kpi.a .num{color:var(--amber)}

  /* ── chips ── */
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{display:inline-flex;align-items:center;gap:5px;background:var(--primary-weak);color:var(--primary-ink);
    border-radius:20px;padding:3px 10px;font-size:12px;font-weight:550;max-width:100%}
  .chip .x{cursor:pointer;opacity:.55;font-weight:700;margin-left:2px}
  .chip .x:hover{opacity:1}
  .chip.dim{background:#f0f2f7;color:var(--muted)}
  .chip.pending{background:var(--red-weak);color:var(--red)}
  .chip .ver{opacity:.6;font-weight:400}
  .chip .pf{background:rgba(0,0,0,.06);border-radius:10px;padding:0 6px;font-size:10.5px;opacity:.75}
  .chip .web{opacity:.55;font-size:10.5px}

  /* ── 岗位勾选（jobPresets）── */
  .job-pick{border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:#fafbfe}
  .job-cand{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);
    border-radius:18px;padding:4px 12px;font-size:12.5px;font-weight:550;color:#4a5573;cursor:pointer;
    user-select:none;transition:.12s}
  .job-cand:hover{border-color:var(--primary);color:var(--primary)}
  .job-cand.on{background:var(--primary-weak);color:var(--primary-ink);border-color:var(--primary)}
  .job-cand .tick{opacity:.35;font-size:11px}
  .job-cand.on .tick{opacity:1}
  .job-sep{margin:12px 0 8px;font-size:11.5px;color:var(--muted);font-weight:650;letter-spacing:.3px}
  .job-empty{color:var(--muted);font-size:12.5px;padding:4px 2px}

  /* ── 应装插件详情卡片 ── */
  .plugin-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:4px}
  .pcard{background:#fff;border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);padding:14px 16px;
    display:flex;flex-direction:column;gap:8px;transition:.15s}
  .pcard:hover{border-color:#c9d3ee;box-shadow:0 4px 16px rgba(59,102,240,.1)}
  .pcard .phead{display:flex;align-items:center;gap:8px;justify-content:space-between}
  .pcard .pname{font-weight:650;font-size:14px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
  .pcard .pver{font-size:11.5px;color:var(--muted);background:#f2f4f9;border-radius:10px;padding:1px 8px;white-space:nowrap}
  .pcard .pdesc{font-size:12.5px;color:var(--muted);line-height:1.5;min-height:20px}
  .pcard .pmeta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--faint);flex-wrap:wrap}
  .pcard .pmeta a{color:var(--primary);word-break:break-all}
  .pcard .pfoot{display:flex;justify-content:flex-end}
  .pcard.loading{opacity:.6}
  .pcard .src{background:#eef6ee;color:#1a7f37;border-radius:10px;padding:0 6px;font-size:10.5px}
  .pcard .missing{color:var(--amber);font-size:12px}
  /* 同步状态徽章 */
  .sync-badge{display:inline-flex;align-items:center;gap:4px;border-radius:12px;padding:2px 10px;font-size:11.5px;font-weight:600;white-space:nowrap}
  .sync-badge.synced{background:var(--green-bg);color:var(--green)}
  .sync-badge.unsynced{background:var(--amber-bg);color:var(--amber)}
  .sync-badge.checking{background:#eef0f6;color:var(--muted)}
  /* npmjs 有新版本（内网落后）——醒目橙色 */
  .sync-badge.update{background:#d97706;color:#fff}
  .pcard .sync-btn{margin-left:auto}
  /* 有新版本可同步：整卡橙色高亮（左边条 + 边框 + 阴影） */
  .pcard.update{position:relative;border-color:#ecc58a;box-shadow:0 0 0 1px #f2d6a8,0 4px 16px rgba(217,119,6,.14)}
  .pcard.update::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:4px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#f59e0b,#d97706)}
  .pcard.update .pver{background:var(--amber-bg);color:var(--amber)}
  .pcard .update-arrow{color:var(--amber);font-weight:700;font-size:11px;white-space:nowrap}
  .sync-btn.up{background:var(--amber);border-color:var(--amber);color:#fff}
  .sync-btn.up:hover{background:#b45309;border-color:#b45309}
  .sync-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

  /* ── 状态点 ── */
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
  .dot.ok{background:var(--green)} .dot.bad{background:var(--red)} .dot.warn{background:var(--amber)} .dot.gray{background:#c4cbd8}
  .status{font-size:12.5px;font-weight:600;display:inline-flex;align-items:center}
  .status.ok{color:var(--green)} .status.bad{color:var(--red)} .status.warn{color:var(--amber)} .status.gray{color:var(--muted)}

  /* ── 菜单策略行 ── */
  .menu-item{display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--line2);
    border-radius:9px;margin-bottom:8px;background:#fbfcfe}
  .menu-item .drag{color:var(--faint);cursor:grab;user-select:none;padding:0 4px;font-size:15px}
  .menu-item .idx{width:22px;height:22px;border-radius:6px;background:var(--primary-weak);color:var(--primary);
    display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;flex-shrink:0}
  .switch{position:relative;width:40px;height:22px;flex-shrink:0}
  .switch input{opacity:0;width:0;height:0}
  .switch .sl{position:absolute;cursor:pointer;inset:0;background:#d3d9e5;border-radius:22px;transition:.2s}
  .switch .sl:before{content:"";position:absolute;height:16px;width:16px;left:3px;top:3px;
    background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
  .switch input:checked + .sl{background:var(--primary)}
  .switch input:checked + .sl:before{transform:translateX(18px)}

  /* ── envDefaults 编辑器 ── */
  .env-card{border:1px solid var(--line2);border-radius:10px;margin-bottom:10px;background:#fbfcfe;overflow:hidden}
  .env-card .env-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f4f6fb;
    border-bottom:1px solid var(--line2);font-weight:650;font-size:13.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
  .env-card .env-head .ns{margin-right:auto}
  .env-card .env-body{padding:10px 14px}
  .env-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
  .env-row .input.key{flex:0 0 240px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
  .env-row .input.val{flex:1}
  .env-empty{color:var(--faint);font-size:13px;padding:6px 2px}

  /* ── 客户端卡片 ── */
  .client-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
  .client{background:#fff;border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
  .client .chead{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line2)}
  .client .avatar{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#eef2ff,#e6ecfe);
    display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
  .client .who{flex:1;min-width:0}
  .client .host{font-weight:650;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .client .cid{font-size:11.5px;color:var(--faint);font-family:ui-monospace,monospace}
  .client .cbody{padding:14px 16px}
  .client .sec{font-size:11.5px;color:var(--faint);font-weight:600;letter-spacing:.03em;margin:12px 0 6px;text-transform:uppercase}
  .client .sec:first-child{margin-top:0}
  .client .foot{display:flex;align-items:center;gap:10px;padding:10px 16px;
    background:#fafbfd;border-top:1px solid var(--line2);font-size:12px;color:var(--muted)}
  .client .foot > span:last-of-type{margin-left:auto} /* 时间靠右，删除按钮贴最右 */
  /* 客户端页工具栏（总数/在线/离线 + 批量清理） */
  .toolbar{display:flex;align-items:center;gap:10px;margin-bottom:16px}
  .toolbar > span{margin-right:auto}

  /* ── 口令弹窗 ── */
  .mask{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:50;display:none;align-items:center;justify-content:center}
  .mask.show{display:flex}
  .modal{background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:min(420px,92vw);padding:24px}
  .modal h3{margin:0 0 6px;font-size:16px}
  .modal .desc{color:var(--muted);font-size:13px;margin-bottom:16px}

  /* ── Toast ── */
  .toast-wrap{position:fixed;right:20px;bottom:20px;z-index:60;display:flex;flex-direction:column;gap:10px}
  .toast{background:#1a2233;color:#fff;border-radius:10px;padding:12px 16px;font-size:13.5px;
    box-shadow:0 8px 30px rgba(0,0,0,.25);display:flex;align-items:center;gap:10px;
    animation:tin .22s ease;max-width:360px}
  .toast.ok{background:#0e7a3d} .toast.err{background:#b91c1c} .toast.warn{background:#a16207}
  @keyframes tin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
</style>
</head>
<body>

<header class="topbar">
  <div class="brand"><span class="logo">H</span> Harness 中心管理</div>
  <div class="spacer"></div>
  <span class="sync-hint" id="syncHint">—</span>
  <button class="btn ghost" onclick="refreshAll()" title="刷新">⟳ 刷新</button>
  <button class="btn" onclick="openTokenModal()">🔑 管理口令</button>
</header>

<!-- 全局基础设施状态栏：本机管理能力 + 内网 registry（所有 tab 共享，单一来源） -->
<div class="infra-bar" id="infraBar">
  <div class="infra-seg">
    <span class="infra-ico">🛰</span>
    <div class="infra-body">
      <div class="infra-label">本机管理能力</div>
      <div class="infra-ctrl">
        <span id="bridgeState" style="color:var(--muted)">检测中…</span>
        <input class="input" id="bridgePortInput" placeholder="端口" style="width:70px;padding:3px 8px" value="">
        <input class="input" id="bridgeTokenInput" type="password" placeholder="连接 token（托盘开启时通知里显示）" style="width:170px;padding:3px 8px" value="">
        <button class="btn sm primary" id="bridgeBtn" onclick="setBridgePort()">连接</button>
      </div>
    </div>
  </div>
  <div class="infra-seg" style="flex:1.4">
    <span class="infra-ico">📦</span>
    <div class="infra-body">
      <div class="infra-label">内网 registry（镜像目标 · 同步状态 · dsh 安装源）</div>
      <div class="infra-ctrl">
        <input class="input" id="mirrorRegistry" placeholder="内网 registry（如 http://registry.ict.cmcc）" style="flex:1;min-width:220px;padding:3px 8px">
        <input class="input" type="password" id="mirrorToken" placeholder="发布 token（存服务端）" style="width:170px;padding:3px 8px">
        <button class="btn sm" onclick="saveMirrorSettings()">保存镜像设置</button>
      </div>
    </div>
  </div>
  <div class="infra-seg" id="infraDshUrl" style="display:none">
    <span class="infra-ico">🚀</span>
    <div class="infra-body">
      <div class="infra-label">dsh 分发源（可选）</div>
      <div class="infra-ctrl">
        <input class="input" id="dshMirrorUrl" placeholder="如 http://registry.ict.cmcc/dsh/" style="width:230px;padding:3px 8px">
      </div>
    </div>
  </div>
  <div class="infra-seg" style="flex:0 0 auto;display:flex;align-items:center;gap:8px">
    <button class="btn sm primary" onclick="startMirrorUpload()" id="mirrorStartBtn">🚀 上传全部镜像</button>
    <span class="sync-hint" id="mirrorState"></span>
  </div>
</div>
<div id="mirrorProgress" style="margin:0 24px;font-size:13px"></div>
<div id="syncProgress" style="margin:0 24px 0;font-size:13px"></div>

<nav class="tabs">
  <button class="tab active" data-view="overview">概览</button>
  <button class="tab" data-view="plugins">插件策略</button>
  <button class="tab" data-view="npmsync">npm 包同步</button>
  <button class="tab" data-view="menu">菜单策略</button>
  <button class="tab" data-view="clients">客户端</button>
  <button class="tab" data-view="launcher">Launcher 发布</button>
</nav>

<main>
  <!-- 概览 -->
  <section id="view-overview" class="view active">
    <div class="kpis" id="kpis"></div>
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">客户端健康概览</h2>
        <div class="card-desc">最近同步的客户端状态，点击顶部「客户端」查看完整详情</div></div>
      </div>
      <div id="overviewClients"></div>
    </div>
  </section>

  <!-- 插件策略 -->
  <section id="view-plugins" class="view">
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">应装插件清单</h2>
        <div class="card-desc">客户端任一个 profile 装了即满足；未装的客户端会弹通知，点击托盘「安装」即可补齐。镜像目标 registry 见顶部全局栏</div></div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <input class="input" id="newPlugin" placeholder="输入 npm 包名，如 dsh-nested-followups 或 @scope/pkg" onkeydown="if(event.key==='Enter')addPlugin()">
        <button class="btn primary" onclick="addPlugin()">＋ 添加</button>
      </div>
      <div class="row" style="margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <button class="btn" onclick="checkAllSyncStatus()">⟳ 刷新同步状态</button>
        <button class="btn primary" id="syncAllBtn" onclick="syncAllPlugins()">🚀 同步全部未同步</button>
        <span class="sync-hint" id="syncState"></span>
        <span style="color:var(--faint);font-size:12px">同步目标：顶部全局栏「内网 registry」</span>
      </div>
      <div class="plugin-cards" id="pluginList"></div>
      <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
        <button class="btn primary" onclick="saveConfig()">保存插件策略</button>
        <span style="font-size:12.5px;color:var(--muted)">修改后需保存，客户端下次轮询（默认 5 分钟）生效</span>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">客户端默认配置</h2>
        <div class="card-desc">下发给客户端的配置默认值（客户端本地显式设置过的不被覆盖）。dsh 安装内网源让同事装/更新 dsh 走内网 registry 加速</div></div>
      </div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="cdNpmRegistry" placeholder="npm registry，多个用逗号分隔（如 https://registry.npmmirror.com/, https://registry.npmjs.org/，空=不覆盖）">
      </div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="cdGhMirror" placeholder="GitHub 中转前缀，多个用逗号分隔（如 https://ghfast.top/, https://ghproxy.net/，空=不覆盖）">
      </div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="cdPort" placeholder="端口（空=不覆盖）" style="max-width:200px">
        <input class="input" id="cdSyncSecs" placeholder="同步间隔秒（>=30，空=不覆盖）" style="max-width:220px">
      </div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="cdProfile" placeholder="profile（如 web / matrix，空=不覆盖）" style="max-width:220px">
      </div>
      <div style="margin-bottom:10px;font-size:13px">
        <label><input type="checkbox" id="cdUseSystemNode" style="width:auto"> 客户端优先使用系统 node（主版本≥22 则跳过下载自带 node）</label>
      </div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="cdDshRegistry" placeholder="dsh 安装内网源（如 http://registry.ict.cmcc；空=不下发）" style="flex:1">
      </div>
      <div style="margin-top:12px"><button class="btn primary" onclick="saveClientDefaults()">保存客户端默认配置</button></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">环境默认配置（envDefaults）</h2>
        <div class="card-desc">给各插件的「统一环境地址」设默认值，客户端同步时写入其 <code>settings.yaml</code>（环境地址类键强制覆盖旧值）。例如数字分身激活 identity 提供商：<code>matrix-activation → keycloakIssuer</code>。改动保存后，客户端下次轮询（默认 5 分钟）生效</div></div>
      </div>
      <div class="row" style="margin-bottom:12px;max-width:520px">
        <input class="input" id="newEnvNs" placeholder="命名空间，如 matrix-activation" onkeydown="if(event.key==='Enter')addEnvNamespace()">
        <button class="btn" onclick="addEnvNamespace()">＋ 添加命名空间</button>
      </div>
      <div id="envDefaultsList"></div>
      <div style="margin-top:14px"><button class="btn primary" onclick="saveEnvDefaults()">保存环境默认配置</button></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">预装岗位（jobPresets）</h2>
        <div class="card-desc">新用户激活数字人后自动安装的岗位清单（HiMarket 岗位技能名，如 <code>pm</code> / <code>dev</code> / <code>secretary</code>）。客户端同步后，himarket 插件按名下载落盘到 <code>.agent-presets/</code>，即装即用。逗号分隔，留空=不下发。</div></div>
      </div>
      <div style="margin-bottom:10px;max-width:640px">
        <input class="input" id="jobSearchInput" placeholder="搜索岗位（如 pm / dev / 秘书）… 回车=追加清单外岗位" style="width:100%" oninput="renderJobCandidates()" onkeydown="if(event.key==='Enter'){event.preventDefault();addJobPresetManual();}">
      </div>
      <div id="jobSelectedWrap" class="chips" style="margin-bottom:4px"></div>
      <div id="jobCandidatesWrap" class="job-pick"></div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
        <button class="btn primary" onclick="saveJobPresets()">保存预装岗位</button>
        <span id="jobPickCount" style="font-size:12px;color:var(--muted)"></span>
      </div>
    </div>
  </section>

  <!-- npm 包同步 -->
  <section id="view-npmsync" class="view">
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">npm 包同步清单</h2>
        <div class="card-desc">把任意 npm 包（含全量依赖树）镜像到顶部全局栏的内网 registry——用于非插件的通用依赖加速，如 dsh 核心 <code>@deepseek-ai/dsh</code>（同事装 dsh / 依赖时经内网 registry 提速）。支持 <code>包名</code>（=latest）或 <code>包名@版本/tag</code>，如 <code>@deepseek-ai/dsh@0.1.2-rc.1</code></div></div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <input class="input" id="newNpmPkg" placeholder="输入 npm 包名，如 @deepseek-ai/dsh 或 zod，可带 @版本/tag" style="flex:2" onkeydown="if(event.key==='Enter')addNpmPkg()">
        <button class="btn primary" onclick="addNpmPkg()">＋ 添加</button>
      </div>
      <div class="row" style="margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <button class="btn" onclick="checkNpmSyncStatus()">⟳ 刷新同步状态</button>
        <button class="btn primary" id="npmsyncAllBtn" onclick="syncAllNpmPkgs()">🚀 同步全部未同步</button>
        <span class="sync-hint" id="npmsyncState"></span>
        <span style="color:var(--faint);font-size:12px">同步目标：顶部全局栏「内网 registry」；执行需顶部全局栏「本机管理能力」已连接</span>
      </div>
      <div id="npmsyncProgress" style="margin-bottom:12px"></div>
      <div class="plugin-cards" id="npmsyncList"></div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
        <span style="font-size:12.5px;color:var(--muted)">清单改动自动保存；「同步到 vX」依赖本机 launcher 管理能力 ≥ 0.3.0（指定版本/tag），旧版仅能同步 latest</span>
      </div>
    </div>
  </section>

  <!-- Launcher 发布 -->
  <section id="view-launcher" class="view">
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">Launcher 托盘发布</h2>
        <div class="card-desc">上传 launcher 新版 exe 到服务端，同事 launcher 周期检查 <code>/api/launcher/latest</code> 发现新版后自动下载升级（内网自托管，版本号 + sha256 校验）。当前无发布物时同事端不升级</div></div>
      </div>
      <div id="launcherReleaseCurrent" style="margin-bottom:14px"></div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="newLauncherExe" type="file" accept=".exe" style="flex:2">
        <input class="input" id="newLauncherVersion" placeholder="版本号（如 0.3.0，与 package.json 一致）" style="flex:1">
      </div>
      <div class="row" style="margin-bottom:10px">
        <input class="input" id="newLauncherNotes" placeholder="更新说明（可选，同事托盘更新提示里显示）" style="flex:1">
      </div>
      <div class="row" style="margin-bottom:12px">
        <button class="btn primary" id="launcherUploadBtn" onclick="uploadLauncherRelease()">⬆ 上传并发布</button>
        <span class="sync-hint" id="launcherUploadState"></span>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line,#eee)">
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:6px">只改「更新说明」——不改版本号/不重传 exe（已发布的 exe 与 sha256 保持不变）：</div>
        <div class="row" style="margin-bottom:10px">
          <input class="input" id="launcherNotesEdit" placeholder="新的更新说明（同事托盘更新提示里显示）" style="flex:1">
          <button class="btn" id="launcherNotesBtn" onclick="updateLauncherNotes()">✎ 保存说明</button>
        </div>
        <span class="sync-hint" id="launcherNotesState"></span>
      </div>
      <div style="font-size:12.5px;color:var(--muted)">
        上传前先在本机构建新版本 exe（<code>cargo build --release</code> 产物即可，绿色版分发），
        服务端自动计算 sha256 校验、替换 latest 元数据并清理旧产物。同事 launcher 需 ≥ 0.3.0 才具备自动更新能力。
      </div>
    </div>
  </section>

  <!-- 菜单策略 -->
  <section id="view-menu" class="view">
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">托盘「常用网址」菜单策略</h2>
        <div class="card-desc">统一下发同事托盘里的快捷菜单，启用后覆盖客户端本地菜单展示，关闭后自动回退</div></div>
        <label class="switch" title="启停统一下发">
          <input type="checkbox" id="menuEnabled" onchange="current.managedMenu.enabled=this.checked">
          <span class="sl"></span>
        </label>
      </div>
      <div id="menuList"></div>
      <div class="row" style="margin-top:14px">
        <input class="input" id="newMenuLabel" placeholder="菜单名，如 公司OA">
        <input class="input" id="newMenuUrl" placeholder="https:// 或 http:// 地址" onkeydown="if(event.key==='Enter')addMenuItem()">
        <button class="btn primary" onclick="addMenuItem()">＋ 添加</button>
      </div>
      <div style="margin-top:16px"><button class="btn primary" onclick="saveMenuPolicy()">保存菜单策略</button></div>
    </div>
  </section>

  <!-- 客户端 -->
  <section id="view-clients" class="view">
    <div class="toolbar" id="clientsToolbar"></div>
    <div class="client-grid" id="clientGrid"></div>
  </section>
</main>

<!-- 登录门禁：口令验证通过前锁定管理页（不可关闭） -->
<div class="mask" id="tokenMask">
  <div class="modal">
    <h3>管理口令</h3>
    <div class="desc">输入服务端启动时的 <code>--token</code> 值（未设置则留空）。验证通过后进入管理页。</div>
    <div class="field">
      <label>管理口令</label>
      <input class="input" type="password" id="tokenInput" placeholder="如 local-admin" onkeydown="if(event.key==='Enter')saveToken()">
    </div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn primary" id="tokenSaveBtn" onclick="saveToken()">登录</button>
    </div>
    <div class="desc" id="tokenError" style="color:var(--red);display:none">口令错误，请重试</div>
  </div>
</div>

<div class="toast-wrap" id="toastWrap"></div>

<script src="/admin.js"></script>
</body>
</html>`;
}

module.exports = { adminPageHtml }
