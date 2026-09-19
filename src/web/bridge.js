/**
 * 管理员本机管理能力（bridge）——外网代理网关。
 *
 * ## 为什么需要它
 * 中心服务端在生产机房内网，**不能出外网**（也未必能访问内网 registry）。
 * 管理员本机 launcher 的本地 API（默认 127.0.0.1:3410）既能出外网查 npmjs，
 * 又能访问内网 registry，因此「上游元信息查询 / 镜像同步」都由它承担。
 *
 * ## 关键前提（生产拓扑）
 * 本文件代码运行在**管理员本机的浏览器**里（页面从 ai-conf 拉回后本地执行），
 * 所以 127.0.0.1 恒指管理员自己的电脑——与「服务端是否同机」无关。
 * 服务端从不主动访问 bridge（server.js 无 3410/localhost 出站）。
 *
 * ## 状态诚实原则
 * /api/health 免 token，只证明「服务在」；token 是否有效必须实测
 * （用 mirror/progress 自检：只读本地、不触外网，token 错返回 invalid bridge token）。
 * 绝不在未授权时显示「已连接」。
 */

// ── 镜像上传 ──
async function saveMirrorSettings(){
  try{
    const dshMirror=document.getElementById("dshMirrorUrl").value.trim();
    const ms={
      registry:document.getElementById("mirrorRegistry").value.trim(),
      tokenValue:document.getElementById("mirrorToken").value.trim(),
      dshMirrorUrl:dshMirror,
    };
    if(!/^https?:\/\/\S+$/.test(ms.registry)){ toast("registry 必须是 http(s) 地址","warn"); return; }
    if(dshMirror && !/^https?:\/\/\S+$/.test(dshMirror)){ toast("dsh 分发源必须是 http(s) 地址","warn"); return; }
    const body={plugins:current.plugins,managedMenu:current.managedMenu,clientDefaults:current.clientDefaults||{},mirrorSettings:ms};
    const r=await fetch("/api/config",{method:"POST",headers:headers(true),body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    current=j; toast("镜像设置已保存（含 token）","ok");
  }catch(e){ toast("保存失败："+esc(e.message),"err"); }
}
async function startMirrorUpload(){
  if(!bridgePort){ toast("请先在页面顶部全局栏连接「本机管理能力」","warn"); return; }
  const reg=document.getElementById("mirrorRegistry").value.trim()||"http://registry.ict.cmcc";
  const token=document.getElementById("mirrorToken").value.trim();
  if(!token){ toast("请先配置发布 token（镜像设置）","warn"); return; }
  try{
    // token 经 POST body 传递（不进 URL/日志）
    const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/start",{
      method:"POST",headers:headers(true),
      body:JSON.stringify({registry:reg,token:token})
    });
    const j=await r.json();
    if(!j.ok){ toast("启动失败："+esc(j.error||""),"err"); return; }
    toast("上传已开始，请查看进度","ok");
    pollMirrorProgress();
  }catch(e){ toast("无法连接管理员管理能力："+esc(e.message),"err"); }
}
async function pollMirrorProgress(){
  if(!bridgePort) return;
  const bridgeTok=localStorage.getItem("bridgeToken")||"";
  try{
    const ctrl=new AbortController();
    setTimeout(()=>ctrl.abort(),8000); // 单次轮询超时（bridge 卡死时不无限挂起）
    const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/progress?token="+encodeURIComponent(bridgeTok),{headers:headers(false),signal:ctrl.signal});
    const j=await r.json();
    if(!j.ok) return;
    mirrorPollFailures=0; // 成功一次即重置失败计数
    const p=j.progress||{};
    const el=document.getElementById("mirrorProgress");
    const st=document.getElementById("mirrorState");
    // 同步工具栏进度显示
    const spEl=document.getElementById("syncProgress");
    const ssEl=document.getElementById("syncState");
    if(p.state==="running"){
      el.innerHTML='<div style="background:#eef4ff;border:1px solid #cfe0ff;border-radius:8px;padding:10px 14px">'+
        '⏳ 上传中：<b>'+esc(p.current_pkg||"…")+'</b><br>'+
        '进度：'+p.done_pkgs+'/'+p.total_pkgs+' 个包（应装 '+p.total_plugins+' 个插件）'+
        '</div>';
      st.innerHTML='<span style="color:var(--amber)">进行中…</span>';
      document.getElementById("mirrorStartBtn").disabled=true;
      document.getElementById("syncAllBtn").disabled=true;
      if(spEl) spEl.innerHTML='<div style="background:#eef4ff;border:1px solid #cfe0ff;border-radius:8px;padding:8px 12px;font-size:13px">'+
        '⏳ 同步中：'+p.done_pkgs+'/'+p.total_pkgs+' 个包 · 当前 '+esc(p.current_pkg||"…")+'</div>';
      if(ssEl) ssEl.innerHTML='<span style="color:var(--amber)">同步中…</span>';
      if(mirrorPollTimer) clearTimeout(mirrorPollTimer);
      mirrorPollTimer=setTimeout(pollMirrorProgress,3000);
    } else if(p.state==="done"){
      if(mirrorPollTimer){ clearTimeout(mirrorPollTimer); mirrorPollTimer=null; }
      el.innerHTML='<div style="background:#e8f7ee;border:1px solid #b7e3c8;border-radius:8px;padding:10px 14px">'+
        '✅ 上传完成：'+p.done_pkgs+'/'+p.total_pkgs+' 个包已同步到 '+esc(p.registry||"")+
        '</div>';
      st.innerHTML='<span style="color:var(--green)">已完成</span>';
      document.getElementById("mirrorStartBtn").disabled=false;
      document.getElementById("syncAllBtn").disabled=false;
      if(spEl) spEl.innerHTML='<div style="background:#e8f7ee;border:1px solid #b7e3c8;border-radius:8px;padding:8px 12px;font-size:13px">'+
        '✅ 同步完成：'+p.done_pkgs+'/'+p.total_pkgs+' 个包已同步</div>';
      if(ssEl) ssEl.innerHTML='<span style="color:var(--green)">已完成</span>';
      // 完成后刷新插件同步状态徽章
      renderPlugins();
    } else if(p.state==="error"){
      if(mirrorPollTimer){ clearTimeout(mirrorPollTimer); mirrorPollTimer=null; }
      el.innerHTML='<div style="background:#fdeaea;border:1px solid #f5c6c6;border-radius:8px;padding:10px 14px">'+
        '❌ 上传出错：'+esc((p.error||"").slice(0,300))+
        '</div>';
      st.innerHTML='<span style="color:var(--red)">出错</span>';
      document.getElementById("mirrorStartBtn").disabled=false;
      document.getElementById("syncAllBtn").disabled=false;
      if(spEl) spEl.innerHTML='<div style="background:#fdeaea;border:1px solid #f5c6c6;border-radius:8px;padding:8px 12px;font-size:13px">'+
        '❌ 同步出错：'+esc((p.error||"").slice(0,200))+'</div>';
      if(ssEl) ssEl.innerHTML='<span style="color:var(--red)">出错</span>';
    }
  }catch(e){
    // 轮询失败（bridge 卡死/暂时不可用）：重试而不是永久停在"同步中"
    mirrorPollFailures++;
    if(mirrorPollFailures<=MIRROR_POLL_MAX_FAILURES){
      if(mirrorPollTimer) clearTimeout(mirrorPollTimer);
      mirrorPollTimer=setTimeout(pollMirrorProgress,5000); // 失败间隔拉长到 5s
    }else{
      if(mirrorPollTimer){ clearTimeout(mirrorPollTimer); mirrorPollTimer=null; }
      const spEl=document.getElementById("syncProgress");
      const ssEl=document.getElementById("syncState");
      if(spEl) spEl.innerHTML='<div style="background:#fdf3e7;border:1px solid #f0d4b0;border-radius:8px;padding:8px 12px;font-size:13px">'+
        '⚠ 进度查询中断（本机管理能力无响应）——已停止轮询，可刷新页面重试</div>';
      if(ssEl) ssEl.innerHTML='<span style="color:var(--amber)">查询中断</span>';
    }
  }
}
async function loadStatus(){
  try{
    const r=await fetch("/api/status",{headers:headers(false)}); const j=await r.json();
    if(r.status===403){ showLoginGate(); return; }
    if(!r.ok){
      throw new Error((j&&j.error)||("HTTP "+r.status));
      return;
    }
    latestClients=j.clients||[];
    renderKpis(); renderOverviewClients(); renderClientsToolbar(); renderClients();
    autoDetectBridge();
    // 恢复镜像上传进度轮询：若本机管理能力已连接且上传可能在进行（上次停在了 running），
    // 页面刷新/加载后继续显示进度，而不是停留在旧状态（插件页 + npm 同步页各自恢复）
    if(bridgePort && (!mirrorPollTimer || !npmPollTimer)){
      try{
        const ctrl=new AbortController();
        setTimeout(()=>ctrl.abort(),4000);
        const pr=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/progress?token="+encodeURIComponent(localStorage.getItem("bridgeToken")||""),{headers:headers(false),signal:ctrl.signal});
        const pj=await pr.json();
        if(pj&&pj.ok&&pj.progress&&pj.progress.state==="running"){
          if(!mirrorPollTimer) pollMirrorProgress();
          if(!npmPollTimer) pollNpmMirrorProgress(true);
        }
      }catch(e){ /* 未连接/无上传，忽略 */ }
    }
    const t=latestClients.length? ("上次更新 " + fmtTime(latestClients[0].lastSyncAt)) : "等待客户端上报";
    document.getElementById("syncHint").innerHTML="<b>"+latestClients.length+"</b> 台客户端 · "+t;
  }catch(e){ toast("加载客户端失败："+esc(e.message),"err"); }
}
// 管理能力：只探测「本机」（管理页所在电脑）的 launcher，不猜其他客户端。
// 主动 fetch /api/health 确认真的可用，连不上就明确显示未连接。
// 状态诚实原则：localStorage 里存的端口只是"上次连过"，不代表现在还活着——
// 每次加载都真实探测：已存端口优先验证，不通则清掉并继续探测候选端口。
async function autoDetectBridge(){
  const st=document.getElementById("bridgeState");
  const savedPort=parseInt(localStorage.getItem("bridgePort")||"0",10);
  const candidates=[];
  // 已存端口（>0 合法）优先验证存活；验证失败会清理，不残留假连接
  if(savedPort>0&&savedPort<65536) candidates.push(savedPort);
  candidates.push(3410);
  const seen=new Set();
  for(const port of candidates){
    if(seen.has(port)) continue;
    seen.add(port);
    // fetch 加超时（3s）——防止端口有服务但不响应时永远「检测中…」
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),3000);
    try{
      const r=await fetch("http://127.0.0.1:"+port+"/api/health",{headers:headers(false),signal:ctrl.signal});
      clearTimeout(timer);
      if(r.ok){
        const j=await r.json();
        if(j&&j.ok){
          bridgePort=port;
          bridgeVersion=(j.version||"").replace(/^v/,"");
          document.getElementById("bridgePortInput").value=port;
          // 恢复已保存的 token（输入框 + localStorage）
          const saved=localStorage.getItem("bridgeToken")||"";
          document.getElementById("bridgeTokenInput").value=saved;
          // 自动连接成功也持久化（刷新不丢）
          localStorage.setItem("bridgePort",String(port));
          // 诚实授权状态：health 免 token 只证明服务在，不证明 token 有效。
          // 有已存 token 时实测一次。自检用 mirror/progress（只读本地进度、不触外网）：
          // token 错 → 403 invalid bridge token；token 对 → 200（即便无上传进度也 ok:true）。
          // 不用 /api/registry/meta 自检——那会真去查 npmjs 外网，管理员本机断网时会误报未授权。
          let authed=!!saved;
          if(authed){
            try{
              const ac=new AbortController();
              const at=setTimeout(()=>ac.abort(),6000);
              const ar=await fetch("http://127.0.0.1:"+port+"/api/registry/mirror/progress?token="+encodeURIComponent(saved),{headers:headers(false),signal:ac.signal});
              clearTimeout(at);
              const aj=await ar.json().catch(()=>null);
              // ok:false + error 含 invalid token = 未授权；其余（真查询失败/无进度）视为已授权
              authed = !(aj&&aj.ok===false&&/invalid.*token/i.test(aj.error||""));
            }catch(e){ authed=false; /* 探测超时/失败：保守按未授权处理 */ }
          }
          localStorage.setItem("bridgeAuthed",authed?"1":"0");
          updateBridgeButton(authed?"connected":"unauthorized");
          st.innerHTML = authed
            ? '<span style="color:var(--green)">✓ 已连接本机管理能力（端口 '+port+'，v'+esc(j.version||"?")+'）</span>'
            : '<span style="color:var(--amber)">⚠ 已连接端口 '+port+' 但 token 未授权——请填入托盘显示的管理 token</span>';
          // 连接状态变化后刷新插件/包卡片（loadConfig 可能已用旧状态渲染过）
          if(document.getElementById("pluginList")&&document.getElementById("pluginList").innerHTML) renderPlugins();
          if(document.getElementById("npmsyncList")&&document.getElementById("npmsyncList").innerHTML) renderNpmSync();
          return;
        }
      }
    }catch(e){ clearTimeout(timer); /* 该端口无服务，继续 */ }
  }
  // 全部失败：清理可能残留的假连接状态，明确显示未连接
  if(bridgePort){ bridgePort=null; localStorage.removeItem("bridgePort"); }
  bridgeVersion="";
  updateBridgeButton("disconnected");
  st.innerHTML='<span style="color:var(--muted)">本机管理能力未连接——同步/上传需管理员在本机 launcher 托盘「管理能力」开启</span>';
}
// 按钮状态：连接中 ⏳ / 已连接 ✓（绿色）/ 已连接未授权 ⚠ / 未连接「连接」。让按钮实时反映状态。
function updateBridgeButton(state){
  const btn=document.getElementById("bridgeBtn");
  if(!btn) return;
  // 清掉旧状态 class，恢复基础样式
  btn.classList.remove("ok","warn");
  if(state==="connecting"){
    btn.textContent="连接中…"; btn.disabled=true;
  }else if(state==="connected"){
    btn.textContent="✓ 已连接"; btn.disabled=false; btn.classList.add("ok");
  }else if(state==="unauthorized"){
    btn.textContent="⚠ 未授权"; btn.disabled=false; btn.classList.add("warn");
  }else{ // disconnected
    btn.textContent="连接"; btn.disabled=false;
  }
}
async function setBridgePort(){
  const v=document.getElementById("bridgePortInput").value.trim();
  const p=parseInt(v,10);
  if(!p||p<1||p>65535){ toast("端口无效","warn"); return; }
  document.getElementById("bridgeBtn") && updateBridgeButton("connecting");
  // 验证该端口确实是本机管理能力（带超时）
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),3000);
  try{
    const r=await fetch("http://127.0.0.1:"+p+"/api/health",{headers:headers(false),signal:ctrl.signal});
    clearTimeout(timer);
    const j=await r.json();
    if(!r.ok||!j||!j.ok){ updateBridgeButton("disconnected"); toast("该端口不是有效的管理能力服务","warn"); return; }
    bridgeVersion=(j.version||"").replace(/^v/,"");
  }catch(e){ clearTimeout(timer); updateBridgeButton("disconnected"); toast("无法连接该端口（本机管理能力未开启？）","warn"); return; }
  bridgePort=p;
  localStorage.setItem("bridgePort",String(p));
  // 保存连接 token（无条件写，空则清除旧值）
  const tok=document.getElementById("bridgeTokenInput").value.trim();
  localStorage.setItem("bridgeToken",tok);
  // 验证 token 授权状态：带 token 实测（空 token 必未授权，诚实提示而不是假装可用）。
  // 自检用 mirror/progress（只读本地、不触外网；token 错 → invalid bridge token）。
  const st=document.getElementById("bridgeState");
  let authed=!!tok;
  if(authed){
    try{
      const ac=new AbortController();
      const at=setTimeout(()=>ac.abort(),6000);
      const ar=await fetch("http://127.0.0.1:"+p+"/api/registry/mirror/progress?token="+encodeURIComponent(tok),{headers:headers(false),signal:ac.signal});
      clearTimeout(at);
      const aj=await ar.json().catch(()=>null);
      authed = !(aj&&aj.ok===false&&/invalid.*token/i.test(aj.error||""));
    }catch(e){ authed=false; }
  }
  localStorage.setItem("bridgeAuthed",authed?"1":"0");
  updateBridgeButton(authed?"connected":"unauthorized");
  if(st){
    st.innerHTML = authed
      ? '<span style="color:var(--green)">✓ 已连接本机管理能力（端口 '+p+'，v'+esc(bridgeVersion||"?")+'）</span>'
      : '<span style="color:var(--amber)">⚠ 已连接端口 '+p+' 但 token 未授权——请填入托盘显示的管理 token</span>';
  }
  // 清缓存强制刷新插件信息 + npm 包同步（上游版本来自 bridge，token 变化直接影响能否拿到）
  Object.keys(pluginMetaCache).forEach(k=>delete pluginMetaCache[k]);
  renderPlugins();
  if(document.getElementById("npmsyncList")&&document.getElementById("npmsyncList").innerHTML) renderNpmSync();
  toast(authed?"已连接本机管理能力（端口 "+p+"，v"+esc(bridgeVersion||"?")+"）":"已连接端口但 token 未授权","ok");
}
function refreshAll(){ loadConfig(); loadStatus(); loadLauncherRelease(); toast("已刷新","ok"); }

// ── 内网 registry 同步状态查询（单一入口） ──
/**
 * 查内网 registry 上各包的同步状态（徽章用）。
 *
 * ## 为什么优先走 bridge（架构修正）
 * 生产环境中心服务端在机房集群内，**未必能解析/访问内网 registry**——实测集群
 * CoreDNS 拒绝解析 registry.ict.cmcc，导致服务端 /api/registry/sync-status 全部
 * 返回 error，管理页徽章一律「⚠ 查询失败」。
 * 按网络边界设计，registry 查询应由**管理员本机 launcher** 承担：它既能出外网
 * 又能访问内网 registry，是天然的桥接者（服务端只是记录者）。
 *
 * ## 降级策略
 *   bridge 可用（已连 + token 授权）→ bridge /api/registry/sync-status（首选）
 *   bridge 不可用/失败          → 服务端 /api/registry/sync-status（兼容旧版
 *                                 launcher 0.3.10 及以前没有该端点的情况）
 *
 * @param {string[]} names 包名数组，可含 pkg@spec
 * @returns {Promise<Object>} name → { state, version, error, targetVersion?, targetSynced? }
 */
async function queryInternalSyncStatus(names){
  const out={};
  if(!names||!names.length) return out;
  const reg=syncRegistryUrl();
  const q=encodeURIComponent(names.join(","))+"&registry="+encodeURIComponent(reg);
  // 1) 首选：本机管理能力 bridge（生产拓扑下唯一可靠的查询者）
  if(bridgePort){
    try{
      const bridgeTok=localStorage.getItem("bridgeToken")||"";
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),15000);
      const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/sync-status?names="+q+"&token="+encodeURIComponent(bridgeTok),{headers:headers(false),signal:ctrl.signal});
      clearTimeout(timer);
      const j=await r.json().catch(()=>null);
      if(r.ok&&j&&j.ok&&j.plugins) return j.plugins;
      // 旧版 launcher（<0.3.11）无此端点 → 404/not found，落到服务端降级
    }catch(e){ /* bridge 不可达/超时：降级服务端 */ }
  }
  // 2) 降级：服务端转发（要求服务端能访问内网 registry；开发机同机时成立）
  try{
    const r=await fetch("/api/registry/sync-status?names="+q,{headers:headers(false)});
    const j=await r.json();
    if(r.ok&&j&&j.plugins) return j.plugins;
  }catch(e){ /* 服务端也不可达：返回空，由调用方标记 error */ }
  return out;
}
/** 把查询结果归一化为统一的 { state, version, error } 结构（两来源字段一致，容错兜底）。 */
function normalizeSyncEntry(s){
  if(!s) return {state:"error"};
  return {
    state: s.state==="synced"?"synced":(s.state==="unsynced"?"unsynced":"error"),
    version: s.version||"",
    error: s.error||"",
    targetVersion: s.targetVersion||"",
    targetSynced: !!s.targetSynced,
  };
}

