/**
 * 我的数字分身（Twin）状态页 —— 纯只读、本机探测。
 *
 * 用法：浏览器打开 http://conf.ai.ict.cmcc/twin
 * 探测：JS 探测 127.0.0.1:3410~3420/api/health → 本机 launcher bridge；
 *       健康 → 调 /api/twin/status 展示分身状态；不健康 → 提示「请先打开 launcher」。
 *
 * 安全：只读无操作；不含敏感信息（仅 status/phase/user_id/owner/homeserver_url/access_token_set/launcher_running）。
 *      仅本机可达（127.0.0.1）+ CORS 白名单 conf/ai-conf。
 */
'use strict'

function twinPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>我的数字分身（Twin）</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#0d1117;color:#e6eaf2;margin:0;padding:24px;font-size:13.5px;line-height:1.6}
    .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:18px;margin-top:20px}
    .header{display:flex;align-items:center;gap:12px}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff4d4d}
    .dot.ok{background:#2ea043}
    .status{font-size:13px;margin-left:6px}
    .section{margin-top:18px}
    .label{font-weight:600;color:#8b95a9;margin-top:10px;margin-bottom:3px}
    .val{font-size:12.5px}
    .note{font-size:12px;color:#8b95a9;margin-top:12px;font-style:italic}
    .alert{background:#232c36;border-left:3px solid #ff4d4d;border-radius:6px;padding:12px 16px;margin-top:20px}
    @media (max-width:480px){body{padding:16px}}
  </style>
</head>
<body>
  <div class="header">
    <div class="dot" id="statusDot"></div>
    <h1>我的数字分身</h1>
    <span class="status" id="StatusE"></span>
  </div>

  <div id="content" style="opacity:.35"><div class="section">
    <div class="label">状态</div>
    <div class="val" id="statusPhase">&mdash;</div>
    <div class="label">账号</div>
    <div class="val" id="twinUser">&mdash;</div>
    <div class="val" id="twinOwner">&mdash;</div>
    <div class="label">接入</div>
    <div class="val" id="homeserverUrl">&mdash;</div>
    <div class="label">接入权限</div>
    <div class="val" id="tokenSet">&mdash;</div>
    <div class="label">运行时</div>
    <div class="val" id="launcherRunning">&mdash;</div>
    <div class="label" style="margin-top:16px">操作</div>
    <button id="openWizardBtn" onclick="openWizard()" style="margin-top:2px;padding:8px 16px;background:#2ea043;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">打开本机配置向导</button>
    <div class="val" style="margin-top:6px;font-size:11.5px;color:#8b95a9">启停 / 重新激活 / 换账号都在 launcher 自己的向导窗口里完成（本机操作，浏览器不直接触碰能力）。</div>
  </div></div>

  <div id="nolauncher" class="alert" style="display:none">
    <strong>未检测到本机 launcher</strong><br>
    请先在本机运行 DeepSeek Harness Launcher，然后刷新本页。
  </div>

  <div class="note">
    本页面运行在浏览器，仅探测本机；完全在本地完成，不含任何敏感凭据。
  </div>

  <script>
    // 端口探测：bridge 端口顺延范围 3410-3420（普通 fetch，页面 Origin 在 CORS 白名单）
    async function probeHealth(port){
      try{
        const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),800);
        const r=await fetch("http://127.0.0.1:"+port+"/api/health",{signal:ctrl.signal});
        clearTimeout(t);
        if(!r.ok) return false;
        const j=await r.json().catch(()=>null);
        return !!(j&&j.bridge);
      }catch(e){ return false; }
    }
    async function findBridgePort(){
      for(let p=3410;p<=3420;p++){ if(await probeHealth(p)) return p; }
      return undefined;
    }
    async function loadStatus(port){
      const r=await fetch("http://127.0.0.1:"+port+"/api/twin/status");
      if(!r.ok) return undefined;
      return await r.json();
    }
    function $(id){ return document.getElementById(id); }
    // 调起本机 launcher 配置向导（matrix-setup:// 已是注册协议）。
    // 不向网页暴露启停 API——启停在 launcher 自己的窗口里完成，守住
    // 「能力只在客户端主动发起的本地 UI 可控」的安全边界。
    function openWizard(){
      try{
        location.href = "matrix-setup://localhost/index.html";
      }catch(e){
        $("openWizardBtn").textContent = "调起失败，请从托盘打开配置向导";
      }
    }
    async function render(){
      const p=await findBridgePort();
      if(!p){ showMissingLauncher(); return; }
      const j=await loadStatus(p);
      if(!j||!j.ok){ showMissingLauncher(); return; }
      $("statusDot").className="dot ok";
      $("StatusE").textContent="就绪（本机桥 "+p+"）";
      $("statusPhase").textContent=j.status+"（"+(j.phase||"")+"）";
      $("twinUser").textContent=j.user_id||"—";
      $("twinOwner").textContent=j.owner||"—";
      $("homeserverUrl").textContent=j.homeserver_url||"—";
      $("tokenSet").textContent=j.access_token_set?"已设置":"未设置";
      $("launcherRunning").textContent=j.launcher_running?"🟢 运行中":"⏸ 未运行";
      $("nolauncher").style.display="none";
      $("content").style.opacity=1;
    }
    function showMissingLauncher(){
      $("statusDot").className="dot";
      $("StatusE").textContent="未检测到 launcher";
      $("nolauncher").style.display="block";
    }
    render();
    setInterval(render,10000); // 每 10s 刷新
  </script>
</body>
</html>`
}

module.exports = { twinPageHtml }
