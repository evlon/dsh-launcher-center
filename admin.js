let TOKEN = localStorage.getItem("adminToken") || "";
let current = { plugins: [], managedMenu: { enabled: false, quickLinks: [] } };
let latestClients = [];
// 「npm 包同步」清单：{name, spec}[]；spec="latest"|版本号|dist-tag
let mirrorPackages = [];
let bridgeVersion = ""; // 本机管理能力版本（/api/health 返回，>=0.3.0 才支持 pkg@spec）
// npm 包同步轮询定时器（与插件页 mirrorPollTimer 互不干扰）
let npmPollTimer=null;

function headers(j){ const h = j?{"Content-Type":"application/json"}:{}; if(TOKEN) h["X-Admin-Token"]=TOKEN; return h; }
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function toast(msg, type){
  const w=document.getElementById("toastWrap");
  const t=document.createElement("div"); t.className="toast "+(type||"");
  t.innerHTML=msg; w.appendChild(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transition="opacity .3s"; setTimeout(()=>t.remove(),300); },2600);
}
function fmtTime(iso){ if(!iso) return "—"; const d=new Date(iso); const now=new Date();
  const diff=Math.round((now-d)/1000);
  if(diff<60) return "刚刚"; if(diff<3600) return Math.floor(diff/60)+" 分钟前";
  if(diff<86400) return Math.floor(diff/3600)+" 小时前";
  return d.toLocaleDateString()+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}

// ── Tab 切换 ──
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  t.classList.add("active");
  document.getElementById("view-"+t.dataset.view).classList.add("active");
}));

// ── 登录门禁 ──
// 页面加载先验证 token：403 → 锁定全屏登录；通过 → 正常加载数据
function openTokenModal(){
  const ti=document.getElementById("tokenInput");
  if(ti) ti.value=TOKEN;
  showLoginGate();
}
function showLoginGate(){
  const m=document.getElementById("tokenMask");
  if(m) m.classList.add("show");
  const err=document.getElementById("tokenError");
  if(err) err.style.display="none";
}
function hideLoginGate(){
  const m=document.getElementById("tokenMask");
  if(m) m.classList.remove("show");
}
// 验证当前 TOKEN 是否有效（调 /api/status——GET 需 token；/api/config GET 是公开的不适合）
async function verifyToken(){
  try{
    const r=await fetch("/api/status",{headers:headers(false)});
    if(r.ok) return true;
    if(r.status===403) return false;
    return true; // 其他错误（网络等）不锁页面
  }catch(e){ return true; }
}
async function saveToken(){
  TOKEN=document.getElementById("tokenInput").value.trim();
  localStorage.setItem("adminToken",TOKEN);
  const err=document.getElementById("tokenError");
  // 用新 token 验证（/api/status 需 token）
  try{
    const r=await fetch("/api/status",{headers:headers(false)});
    if(r.ok){
      if(err) err.style.display="none";
      hideLoginGate(); toast("登录成功","ok");
      refreshAll();
    } else {
      if(err) err.style.display="block";
    }
  }catch(e){ hideLoginGate(); refreshAll(); }
}

// ── 数据加载 ──
async function loadConfig(){
  try{
    const r=await fetch("/api/config"); const j=await r.json();
    if(r.status===403){ showLoginGate(); return; }
    if(!r.ok){ throw new Error((j&&j.error)||("HTTP "+r.status)); }
    current=j; current.managedMenu=current.managedMenu||{enabled:false,quickLinks:[]};
    current.clientDefaults=current.clientDefaults||{};
    renderPlugins(); renderMenuPolicy(); renderClientDefaults();
    loadMirrorPackages();
  }catch(e){ toast("加载配置失败："+esc(e.message),"err"); }
}
function renderClientDefaults(){
  const cd=current.clientDefaults||{};
  document.getElementById("cdNpmRegistry").value=(cd.npmRegistry||[]).join(", ");
  document.getElementById("cdGhMirror").value=(cd.ghMirrorPrefix||[]).join(", ");
  document.getElementById("cdPort").value=cd.port||"";
  document.getElementById("cdSyncSecs").value=cd.syncIntervalSecs||"";
  document.getElementById("cdProfile").value=cd.profile||"";
  document.getElementById("cdUseSystemNode").checked=!!cd.useSystemNode;
  document.getElementById("cdDshRegistry").value=cd.dshRegistry||"";
  const ms=current.mirrorSettings||{};
  document.getElementById("mirrorRegistry").value=ms.registry||"http://registry.ict.cmcc";
  document.getElementById("mirrorToken").value=ms.tokenValue||"";
  document.getElementById("dshMirrorUrl").value=ms.dshMirrorUrl||"";
}
async function saveClientDefaults(){
  try{
    const cd={};
    // 逗号分隔输入 → 数组（多源）
    const toList=(s)=>s.split(",").map(x=>x.trim()).filter(Boolean);
    const npm=document.getElementById("cdNpmRegistry").value.trim();
    const gh=document.getElementById("cdGhMirror").value.trim();
    const port=document.getElementById("cdPort").value.trim();
    const sync=document.getElementById("cdSyncSecs").value.trim();
    const prof=document.getElementById("cdProfile").value.trim();
    const npmList=toList(npm), ghList=toList(gh);
    if(npmList.length) cd.npmRegistry=npmList;
    if(ghList.length) cd.ghMirrorPrefix=ghList;
    if(port){ const p=parseInt(port,10); if(p<1||p>65535){ toast("端口无效","warn"); return; } cd.port=p; }
    if(sync){ const s=parseInt(sync,10); if(s<30){ toast("同步间隔需 >=30","warn"); return; } cd.syncIntervalSecs=s; }
    if(prof) cd.profile=prof;
    cd.useSystemNode=document.getElementById("cdUseSystemNode").checked;
    // dshRegistry：内网 dsh 安装源（下发给同事装/更新 dsh 用）；空=不下发（保留）
    const dshReg=document.getElementById("cdDshRegistry").value.trim();
    if(dshReg){ cd.dshRegistry=dshReg; }
    const body={plugins:current.plugins,managedMenu:current.managedMenu,clientDefaults:cd};
    const r=await fetch("/api/config",{method:"POST",headers:headers(true),body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    current=j; current.clientDefaults=current.clientDefaults||{};
    renderClientDefaults(); toast("客户端默认配置已保存","ok");
  }catch(e){ toast("保存失败："+esc(e.message),"err"); }
}

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
let mirrorPollTimer=null;
let mirrorPollFailures=0; // 连续轮询失败次数（bridge 短暂卡顿时重试，不永久停在"同步中"）
const MIRROR_POLL_MAX_FAILURES=5;
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
    renderKpis(); renderOverviewClients(); renderClients();
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
  st.innerHTML='<span style="color:var(--muted)">本机管理能力未连接——同步/上传需管理员在本机 launcher 托盘「管理能力」开启</span>';
}
async function setBridgePort(){
  const v=document.getElementById("bridgePortInput").value.trim();
  const p=parseInt(v,10);
  if(!p||p<1||p>65535){ toast("端口无效","warn"); return; }
  // 验证该端口确实是本机管理能力（带超时）
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),3000);
  try{
    const r=await fetch("http://127.0.0.1:"+p+"/api/health",{headers:headers(false),signal:ctrl.signal});
    clearTimeout(timer);
    const j=await r.json();
    if(!r.ok||!j||!j.ok){ toast("该端口不是有效的管理能力服务","warn"); return; }
    bridgeVersion=(j.version||"").replace(/^v/,"");
  }catch(e){ clearTimeout(timer); toast("无法连接该端口（本机管理能力未开启？）","warn"); return; }
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

// ── 插件策略 ──
const pluginMetaCache = {}; // name -> meta（npmjs 上游元信息）
let lastSyncStates = {};    // name -> 内网 registry 同步状态（上次渲染结果，供汇总提示）
// 语义化版本比较（支持 v 前缀 / x.y.z；不带 .patch 的按 .0 补全；异常返回 null 交由调用方降级）
function cmpVer(a,b){
  if(a==null||b==null) return null;
  const pa=String(a).replace(/^v/,"").split("-")[0].split(".").map(n=>parseInt(n,10));
  const pb=String(b).replace(/^v/,"").split("-")[0].split(".").map(n=>parseInt(n,10));
  if(pa.some(x=>Number.isNaN(x))||pb.some(x=>Number.isNaN(x))) return null;
  for(let i=0;i<3;i++){
    const x=pa[i]||0, y=pb[i]||0;
    if(x!==y) return x<y?-1:1;
  }
  return 0;
}
// 管理员本机管理能力端口：从 localStorage 恢复（刷新不丢），无则 null 交给自动探测
let bridgePort = (()=>{
  const saved=parseInt(localStorage.getItem("bridgePort")||"0",10);
  return saved>0&&saved<65536 ? saved : null;
})();
// 预填端口 + token 输入框（刷新后可见已保存值）。
// 状态诚实：不直接显示"已连接"——已存端口只是上次连过，是否活着由
// autoDetectBridge 的真实探测决定（loadStatus → autoDetectBridge 会覆盖此文案）。
if(bridgePort){
  const fill=()=>{
    const pi=document.getElementById("bridgePortInput");
    if(pi){ pi.value=bridgePort; }
    const ti=document.getElementById("bridgeTokenInput");
    const tok=localStorage.getItem("bridgeToken")||"";
    if(ti && tok) ti.value=tok;
    // 预填期间显示检测中，避免"假已连接"；autoDetectBridge 探测后更新真实状态
    const st=document.getElementById("bridgeState");
    if(st) st.innerHTML='<span style="color:var(--muted)">检测中…</span>';
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",fill);
  else fill();
}
// 元信息缓存：只缓存「真上游」（registry 指向外网 npm 源）的结果。
// 服务端 /api/plugins/meta 只能查内网 registry（网络边界设计），其返回的 latest
// 是内网已有版本，不是 npmjs 上游版本——绝不能混入 pluginMetaCache 冒充上游。
// 上游版本缺失时返回空 latest，渲染端显示「未连接管理能力，无法查询 npmjs 上游」。
async function fetchPluginMetas(names, force){
  if(force){
    // 强制刷新：清掉这批的缓存，上游/内网都重查（用户点「刷新同步状态」= 最新事实）
    names.forEach(n=>delete pluginMetaCache[n]);
  }
  const need = names.filter(n=>!pluginMetaCache[n]);
  if(need.length){
    // 优先走管理员本机管理能力（外网代理网关）：服务端不直接出外网
    if(bridgePort){
      const bridgeTok=localStorage.getItem("bridgeToken")||"";
      // 逐包查（bridge 单包 API）；token 无效返回 {ok:false}——明确报错而不是
      // 静默降级服务端（服务端只有内网版本，冒充上游会误判「已是最新/已同步」）
      const failed=[];
      for(const n of need){
        try{
          const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/meta?name="+encodeURIComponent(n)+"&token="+encodeURIComponent(bridgeTok),{headers:headers(false)});
          const j=await r.json();
          if(j&&j.ok&&j.meta&&j.meta.name){ pluginMetaCache[j.meta.name]=j.meta; }
          else failed.push(n);
        }catch(e){ failed.push(n); /* 本地 API 不可达，见下 */ }
      }
      // bridge 可达但个别失败（token 错/网络）：不降级服务端（会拿内网数据冒充上游），
      // 由渲染端显示「查询失败」；bridge 完全不可达（fetch 抛错）同样不降级。
      void failed;
    }
    // 注意：不再降级服务端 /api/plugins/meta 作为上游来源——服务端仅内网数据，
    // 语义错误（把内网已同步版本当 npmjs 最新）。上游只能来自本机管理能力 bridge。
  }
  return names.map(n=>pluginMetaCache[n]).filter(Boolean);
}
// npm 包同步专用：逐包经 bridge /api/registry/meta 查上游元信息（bridge 单包查询可靠；
// 多包时逐个串行）。force 清缓存。上游只能来自本机管理能力 bridge——服务端只有内网
// 版本，不做降级来源（避免把内网版本当 npmjs 上游，误判「已是最新」）。
async function fetchNpmMetas(names, force){
  const out=[];
  if(!names.length) return out;
  const missing=[];
  for(const n of names){
    if(force) delete pluginMetaCache[n];
    if(pluginMetaCache[n]) out.push(pluginMetaCache[n]);
    else missing.push(n);
  }
  if(missing.length&&bridgePort){
    const bridgeTok=localStorage.getItem("bridgeToken")||"";
    for(const n of missing){
      try{
        const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/meta?name="+encodeURIComponent(n)+"&token="+encodeURIComponent(bridgeTok),{headers:headers(false)});
        const j=await r.json();
        if(j&&j.ok&&j.meta&&j.meta.name){ pluginMetaCache[j.meta.name]=j.meta; out.push(j.meta); }
      }catch(e){ /* 单包失败跳过：该包无上游版本信息，渲染端显示占位 */ }
    }
  }
  return names.map(n=>pluginMetaCache[n]).filter(Boolean);
}
async function renderPlugins(force){
  const el=document.getElementById("pluginList");
  const names=current.plugins||[];
  if(!names.length){ el.innerHTML='<div class="empty">暂无应装插件 —— 所有客户端视为插件齐全</div>'; return; }
  // 先渲染占位（loading），再填充元信息 + 同步状态
  el.innerHTML=names.map((p,i)=>'<div class="pcard loading" id="pcard-'+i+'">'
    +'<div class="phead"><span class="pname">'+esc(p)+'</span><span class="pver">…</span></div>'
    +'<div class="pdesc">正在查询…</div>'
    +'<div class="pfoot"><button class="btn sm danger" onclick="removePlugin('+i+')">移除</button></div>'
    +'</div>').join("");
  const metas=await fetchPluginMetas(names,force);
  // 查询内网 registry 同步状态（经服务端转发）
  const syncStates=await checkRegistryStatus(names);
  lastSyncStates=syncStates; // 供 checkAllSyncStatus 汇总提示
  const upstreamKnown=!!bridgePort; // 上游版本只有 bridge（外网网关）在连时才有意义
  names.forEach((p,i)=>{
    const card=document.getElementById("pcard-"+i);
    if(!card) return;
    const m=metas.find(x=>x.name===p);
    const ss=syncStates[p]||{state:"checking"};
    const upstream=(m&&m.latest)||"";
    // 是否有 npmjs 新版本可同步：内网已同步该版本号，且 内网版本 < npmjs latest
    const hasNew = upstreamKnown && ss.state==="synced" && upstream && cmpVer(ss.version,upstream)<0;
    // 版本标注诚实：只有确实查到 npmjs 上游版本才写 "npmjs vX"；bridge 未连接/查询失败时
    // 明确显示「—」（绝不把服务端查到的内网版本冒充 npmjs 上游——此前因此误显示 0.1.6）
    const ver = upstream
      ? '<span class="pver">npmjs v'+esc(upstream)+'</span>'
      : (upstreamKnown
          ? '<span class="pver" style="color:var(--red)">上游查询失败</span>'
          : '<span class="pver" style="color:var(--muted)">npmjs 上游 —（未连管理能力）</span>');
    const src=m&&m.registry?'<span class="src">'+esc(m.registry)+'</span>':'';
    const desc=m&&m.description?esc(m.description):'<span class="missing">（无描述）</span>';
    const home=m&&m.homepage?'<a href="'+esc(m.homepage)+'" target="_blank" rel="noopener">主页 ↗</a>':'';
    // 同步状态徽章（有新版时最醒目）
    let badge='';
    if(hasNew) badge='<span class="sync-badge update" title="内网 registry 已同步 v'+esc(ss.version)+'，npmjs 已有 v'+esc(upstream)+'">⬆ npmjs 有新版 v'+esc(upstream)+'</span>';
    else if(ss.state==="synced") badge='<span class="sync-badge synced">✓ 已同步 v'+esc(ss.version)+'</span>';
    else if(ss.state==="unsynced") badge='<span class="sync-badge unsynced">⚠ 未同步</span>';
    else if(ss.state==="error") badge='<span class="sync-badge checking" title="registry 查询失败：'+esc(ss.error||"未知错误")+'。同步本身可能已完成，请点下方「⟳ 刷新同步状态」重查">⚠ 查询失败</span>';
    else badge='<span class="sync-badge checking">查询中…</span>';
    // 同步按钮：有新版时橙色高亮 + 行动文案（error/查询中状态不给「同步此插件」按钮，避免误导重复上传）
    const syncBtn = (hasNew||ss.state==="unsynced")
      ? '<button class="btn sm primary sync-btn'+(hasNew?' up':'')+'" id="syncbtn-'+i+'" onclick="syncOnePlugin('+i+')">'
        +(hasNew?'⬆ 同步到 v'+esc(upstream):'同步此插件')+'</button>'
      : '';
    card.className="pcard"+(hasNew?" update":"");
    card.innerHTML='<div class="phead"><span class="pname">'+esc(p)+'</span>'+ver+'</div>'
      +'<div class="pdesc">'+desc+'</div>'
      +'<div class="pmeta">'+src+(home||'')+'</div>'
      +'<div class="pfoot">'+badge+syncBtn+'<button class="btn sm danger" onclick="removePlugin('+i+')">移除</button></div>';
  });
}

// ── 同步状态查询（服务端转发查内网 registry） ──
let syncRegistryCache="";
// 同步目标 registry 单一来源：顶部全局栏「内网 registry」输入框（避免两处配置困惑）
function syncRegistryUrl(){
  const v=document.getElementById("mirrorRegistry").value.trim();
  return v||"http://registry.ict.cmcc";
}
async function checkRegistryStatus(names){
  const out={};
  if(!names.length) return out;
  names.forEach(p=>{ out[p]={state:"checking"}; });
  const reg=syncRegistryUrl();
  try{
    // 经服务端 /api/registry/sync-status 转发查询：服务端机房内网直连 registry，
    // 不会被管理页所在本机的 uproxy 透明代理改写 JSON（此前浏览器直查会误判「未同步」）
    const r=await fetch("/api/registry/sync-status?names="+encodeURIComponent(names.join(","))
      +"&registry="+encodeURIComponent(reg),{headers:headers(false)});
    const j=await r.json();
    if(r.ok&&j&&j.plugins){
      for(const p of names){
        const s=j.plugins[p];
        if(!s){ out[p]={state:"error"}; continue; }
        out[p]={state:s.state==="synced"?"synced":(s.state==="unsynced"?"unsynced":"error"),
          version:s.version||"", error:s.error||""};
      }
    }
  }catch(e){
    // 服务端接口不可达：全部标记 error（显示「查询失败」而不是误判「未同步」）
    names.forEach(p=>{ out[p]={state:"error",error:"server-unreachable"}; });
  }
  return out;
}
async function checkAllSyncStatus(){
  const names=current.plugins||[];
  if(!names.length){ toast("无应装插件","warn"); return; }
  // 强制：清 npmjs 元信息缓存 + 重查内网 registry，让「npmjs 有新版」反映最新事实
  names.forEach(n=>delete pluginMetaCache[n]);
  document.getElementById("syncState").innerHTML='<span style="color:var(--amber)">检查中…</span>';
  toast("正在检查同步状态（含 npmjs 最新版本）…","ok");
  try{
    await renderPlugins(true);
    // 上游版本只有 bridge 在连时才有意义；bridge 未连时明确提示而不是误报「均已最新」
    if(!bridgePort){
      document.getElementById("syncState").innerHTML='<span style="color:var(--amber)">⚠ 本机管理能力未连接——无法对比 npmjs 上游，仅显示内网同步状态</span>';
      return;
    }
    const upd = current.plugins.filter(n=>{ const ss=lastSyncStates[n]; return ss&&ss.state==="synced"&&pluginMetaCache[n]&&cmpVer(ss.version,pluginMetaCache[n].latest)<0; });
    document.getElementById("syncState").innerHTML = upd.length
      ? '<span style="color:var(--amber)"><b>'+upd.length+'</b> 个插件 npmjs 有新版可同步</span>'
      : '<span style="color:var(--green)">✓ 均已同步到 npmjs 最新版</span>';
  }catch(e){
    document.getElementById("syncState").innerHTML='';
  }
}
async function syncOnePlugin(i){
  const btn=document.getElementById("syncbtn-"+i);
  const setBtn=(text,disabled)=>{ if(btn){ btn.textContent=text; btn.disabled=!!disabled; } };
  // 前置条件检查（明确反馈，不只 toast）
  if(!bridgePort){
    toast("❌ 未连接管理员本机管理能力——请先在页面顶部全局栏连接「本机管理能力」","err");
    return;
  }
  const bridgeTok=localStorage.getItem("bridgeToken")||"";
  const name=(current.plugins||[])[i];
  const token=document.getElementById("mirrorToken").value.trim();
  if(!token){
    toast("❌ 未配置发布 token——请在顶部全局栏「内网 registry」填写","err");
    setBtn("同步此插件",false);
    return;
  }
  const reg=syncRegistryUrl();
  // 点击立即反馈：按钮禁用 + 状态
  setBtn("⏳ 同步中…",true);
  try{
    const ctrl=new AbortController();
    setTimeout(()=>ctrl.abort(),15000); // 15s 超时
    const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/start?token="+encodeURIComponent(bridgeTok),{
      method:"POST",headers:headers(true),
      body:JSON.stringify({registry:reg,token:token,only:name}),
      signal:ctrl.signal
    });
    const j=await r.json();
    if(!j.ok){
      setBtn("同步此插件",false);
      toast("❌ 同步启动失败："+esc(j.error||("HTTP "+r.status)),"err");
      return;
    }
    toast("🚀 正在同步 "+esc(name)+"（含依赖）…","ok");
    // 立即刷新一次进度 + 定时轮询
    pollMirrorProgress();
    // 轮询期间按钮保持「同步中」
    const t=setInterval(()=>{
      fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/progress?token="+encodeURIComponent(bridgeTok),{headers:headers(false)})
        .then(r=>r.json()).then(j=>{
          const p=(j&&j.progress)||{};
          if(p.state==="done"||p.state==="error"){
            clearInterval(t);
            setBtn("同步此插件",false);
            toast(p.state==="done" ? ("✅ "+esc(name)+" 已同步") : ("❌ 同步失败："+esc((p.error||"").slice(0,120))), p.state==="done"?"ok":"err");
            renderPlugins(); // 刷新徽章
          }
        }).catch(()=>{});
    },2000);
  }catch(e){
    setBtn("同步此插件",false);
    toast("❌ 无法连接管理能力："+esc(e.message),"err");
  }
}
async function syncAllPlugins(){
  const btn=document.getElementById("syncAllBtn");
  if(!bridgePort){ toast("❌ 未连接管理员本机管理能力——请在上方输入端口并连接","err"); return; }
  const bridgeTok=localStorage.getItem("bridgeToken")||"";
  const token=document.getElementById("mirrorToken").value.trim();
  if(!token){ toast("❌ 未配置发布 token——请在顶部全局栏「内网 registry」填写","err"); return; }
  const reg=syncRegistryUrl();
  if(btn){ btn.disabled=true; btn.textContent="⏳ 同步中…"; }
  try{
    const ctrl=new AbortController();
    setTimeout(()=>ctrl.abort(),15000);
    const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/start?token="+encodeURIComponent(bridgeTok),{
      method:"POST",headers:headers(true),
      body:JSON.stringify({registry:reg,token:token}),
      signal:ctrl.signal
    });
    const j=await r.json();
    if(!j.ok){ toast("❌ 同步启动失败："+esc(j.error||""),"err"); if(btn){btn.disabled=false;btn.textContent="🚀 同步全部未同步";} return; }
    toast("🚀 已开始同步全部未同步插件","ok");
    pollMirrorProgress();
  }catch(e){ toast("❌ 无法连接管理能力："+esc(e.message),"err"); if(btn){btn.disabled=false;btn.textContent="🚀 同步全部未同步";} }
}
function addPlugin(){
  const v=document.getElementById("newPlugin").value.trim();
  if(!v){ toast("请输入包名","warn"); return; }
  if(!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(v)){ toast("包名格式不合法","warn"); return; }
  if(!current.plugins.includes(v)) current.plugins.push(v);
  document.getElementById("newPlugin").value=""; renderPlugins();
}
function removePlugin(i){ current.plugins.splice(i,1); renderPlugins(); }
async function saveConfig(){
  try{
    const r=await fetch("/api/config",{method:"POST",headers:headers(true),body:JSON.stringify({plugins:current.plugins})});
    const j=await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    current=j; current.managedMenu=current.managedMenu||{enabled:false,quickLinks:[]};
    renderPlugins(); toast("插件策略已保存（"+current.plugins.length+" 个）","ok");
  }catch(e){ toast("保存失败："+esc(e.message),"err"); }
}

// ── npm 包同步（通用 npm 包镜像，独立清单） ──
const npmSpecRe=/^[A-Za-z0-9][A-Za-z0-9.*+^~<>=|\s-]*$/;
// 解析 "pkg@spec"（含 scoped）→ {name, spec}
function splitNpmSpec(input){
  const s=String(input||"").trim();
  if(!s) return null;
  const at=s.lastIndexOf("@");
  if(at>0){
    const name=s.slice(0,at), spec=s.slice(at+1);
    if(/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)&&spec&&npmSpecRe.test(spec)) return {name,spec};
  }
  if(!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(s)) return null;
  return {name:s,spec:"latest"};
}
// 从服务端拉取清单（含鉴权失败处理）
async function loadMirrorPackages(){
  try{
    const r=await fetch("/api/mirror/packages",{headers:headers(false)});
    const j=await r.json();
    if(r.status===403){ showLoginGate(); return; }
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    mirrorPackages=j.packages||[];
    renderNpmSync();
  }catch(e){ toast("加载 npm 包清单失败："+esc(e.message),"err"); }
}
// 保存清单（自动随增删触发，不单独设保存按钮）
async function saveMirrorPackages(){
  try{
    const r=await fetch("/api/mirror/packages",{method:"POST",headers:headers(true),body:JSON.stringify({packages:mirrorPackages})});
    const j=await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    mirrorPackages=j.packages||[];
  }catch(e){ toast("保存 npm 包清单失败："+esc(e.message),"err"); }
}
function addNpmPkg(){
  const v=document.getElementById("newNpmPkg").value.trim();
  if(!v){ toast("请输入包名","warn"); return; }
  const item=splitNpmSpec(v);
  if(!item){ toast("包名格式不合法（支持 @scope/pkg 或 pkg@版本/tag）","warn"); return; }
  const ex=mirrorPackages.findIndex(p=>p.name===item.name);
  if(ex>=0){ mirrorPackages[ex]=item; toast("已更新 "+esc(item.name)+" 的 spec 为 "+esc(item.spec),"ok"); }
  else mirrorPackages.push(item);
  document.getElementById("newNpmPkg").value="";
  saveMirrorPackages().then(()=>renderNpmSync());
}
function removeNpmPkg(i){ mirrorPackages.splice(i,1); saveMirrorPackages().then(()=>renderNpmSync()); }
// 渲染清单卡片：占位 → 元信息（bridge 或服务端）→ 内网同步状态
async function renderNpmSync(force){
  const el=document.getElementById("npmsyncList");
  if(!el) return;
  const items=mirrorPackages||[];
  if(!items.length){
    el.innerHTML='<div class="empty">暂无同步包 —— 添加非插件的通用 npm 包（如 <b>@deepseek-ai/dsh</b>），一键连依赖镜像进内网加速安装</div>';
    return;
  }
  el.innerHTML=items.map((p,i)=>'<div class="pcard loading" id="npcard-'+i+'">'
    +'<div class="phead"><span class="pname">'+esc(p.name)+'</span><span class="pver">…</span></div>'
    +'<div class="pdesc">正在查询…</div>'
    +'<div class="pfoot"><button class="btn sm danger" onclick="removeNpmPkg('+i+')">移除</button></div>'
    +'</div>').join("");
  // 1) 上游元信息（latest 版本/tag）：bridge /meta 单包逐个查（可靠）；bridge 不可达则降级服务端
  const names=items.map(p=>p.name);
  const metas=await fetchNpmMetas(names,force);
  // 2) 内网同步状态：带 spec 经服务端查询
  const queryNames=items.map(p=>p.spec&&p.spec!=="latest"?p.name+"@"+p.spec:p.name);
  const reg=syncRegistryUrl();
  const syncStates={};
  try{
    const r=await fetch("/api/registry/sync-status?names="+encodeURIComponent(queryNames.join(","))+"&registry="+encodeURIComponent(reg),{headers:headers(false)});
    const j=await r.json();
    if(r.ok&&j&&j.plugins) Object.assign(syncStates,j.plugins);
  }catch(e){ /* 全部 error 态 */ }
  items.forEach((p,i)=>{
    const card=document.getElementById("npcard-"+i);
    if(!card) return;
    const m=metas.find(x=>x.name===p.name);
    const upstream=(m&&m.latest)||"";
    const ss=syncStates[p.name]||{state:"error",spec:p.spec};
    const specLabel = p.spec&&p.spec!=="latest" ? '<span class="src" style="background:#eef0f6;color:#555">@'+esc(p.spec)+'</span>' : '';
    // 徽章判定：
    // - synced：内网存在该 spec（latest=内网有 latest；指定版本=targetSynced）
    // - hasNew：指定 latest 且内网 < 上游（可升级）
    // - unsynced / error
    let badge='';
    if(ss.state==="synced"){
      if(p.spec==="latest"&&upstream&&cmpVer(ss.version||"",upstream)<0){
        badge='<span class="sync-badge update" title="内网已同步 v'+esc(ss.version)+'，npmjs 已有 v'+esc(upstream)+'">⬆ npmjs 有新版 v'+esc(upstream)+'</span>';
      } else if(p.spec!=="latest"){
        const tv=ss.targetVersion||ss.spec||"";
        badge='<span class="sync-badge synced" title="目标 '+esc(p.spec)+' 已在内网">✓ 已同步 '+esc(tv)+'</span>';
      } else {
        badge='<span class="sync-badge synced">✓ 已同步 v'+esc(ss.version||"?")+'</span>';
      }
    } else if(ss.state==="unsynced") badge='<span class="sync-badge unsynced">⚠ 未同步</span>';
    else if(ss.state==="error") badge='<span class="sync-badge checking" title="registry 查询失败：'+esc(ss.error||"未知")+'。可点「⟳ 刷新同步状态」重查">⚠ 查询失败</span>';
    else badge='<span class="sync-badge checking">查询中…</span>';
    // 按钮：仅当 unsynced 或指定版本未同步时提供「同步此包」；有新版 → 同步到新版
    const isUnsynced=ss.state==="unsynced";
    const hasUp = ss.state==="synced"&&p.spec==="latest"&&upstream&&cmpVer(ss.version||"",upstream)<0;
    let syncBtn='';
    if(isUnsynced||hasUp){
      const target = p.spec!=="latest" ? p.spec : (hasUp?upstream:"");
      const label = hasUp?('⬆ 同步到 v'+esc(upstream)):'同步此包';
      const only = target ? (p.name+"@"+target) : p.name;
      syncBtn='<button class="btn sm primary sync-btn'+(hasUp?' up':'')+'" id="npmsyncbtn-'+i+'" onclick="syncOneNpmPkg('+i+',\''+esc(only)+'\')">'+label+'</button>';
    }
    const ver = upstream
      ? '<span class="pver">npmjs v'+esc(upstream)+'</span>'
      : (bridgePort
          ? '<span class="pver" style="color:var(--red)">上游查询失败</span>'
          : '<span class="pver" style="color:var(--muted)">npmjs 上游 —（未连管理能力）</span>');
    const src=m&&m.registry?'<span class="src">'+esc(m.registry)+'</span>':'';
    const desc=m&&m.description?esc(m.description).slice(0,120):'<span class="missing">（无描述）</span>';
    card.className="pcard"+(hasUp?" update":"");
    card.innerHTML='<div class="phead"><span class="pname">'+esc(p.name)+'</span>'+ver+specLabel+'</div>'
      +'<div class="pdesc">'+desc+'</div>'
      +'<div class="pmeta">'+src+'</div>'
      +'<div class="pfoot">'+badge+(syncBtn||'')+'<button class="btn sm danger" onclick="removeNpmPkg('+i+')">移除</button></div>';
  });
}
// 强制刷新 npm 同步状态（清元信息缓存重查）
async function checkNpmSyncStatus(){
  const names=(mirrorPackages||[]).map(p=>p.name);
  if(!names.length){ toast("无同步包","warn"); return; }
  const st=document.getElementById("npmsyncState");
  names.forEach(n=>delete pluginMetaCache[n]);
  if(st) st.innerHTML='<span style="color:var(--amber)">检查中…</span>';
  toast("正在检查 npm 包同步状态…","ok");
  try{
    await renderNpmSync(true);
    const ss=document.getElementById("npmsyncState");
    if(ss) ss.innerHTML='<span style="color:var(--green)">✓ 已刷新</span>';
  }catch(e){ const ss=document.getElementById("npmsyncState"); if(ss) ss.innerHTML=''; }
}
// 同步单个 npm 包（含依赖）→ bridge mirror/start（only=name@spec）
async function syncOneNpmPkg(i,onlyStr){
  const btn=document.getElementById("npmsyncbtn-"+i);
  const setBtn=(text,disabled)=>{ if(btn){ btn.textContent=text; btn.disabled=!!disabled; } };
  if(!bridgePort){ toast("❌ 未连接管理员本机管理能力——请在页面顶部全局栏连接","err"); return; }
  const item=(mirrorPackages||[])[i];
  if(!item) return;
  // 指定版本/tag 需要 launcher ≥ 0.3.0（支持 pkg@spec）；bridgeVersion 空时放行（未知版本不拦）
  const needsSpec = onlyStr && onlyStr.includes("@") && onlyStr.lastIndexOf("@")>0 && (onlyStr.split("@").pop()!=="latest");
  if(needsSpec && bridgeVersion && cmpVer(bridgeVersion,"0.3.0")<0){
    toast("❌ 当前管理能力 v"+esc(bridgeVersion)+" 不支持指定版本/tag——请升级本机 launcher ≥ 0.3.0","err");
    return;
  }
  const bridgeTok=localStorage.getItem("bridgeToken")||"";
  const token=document.getElementById("mirrorToken").value.trim();
  if(!token){ toast("❌ 未配置发布 token——请在顶部全局栏「内网 registry」填写","err"); return; }
  const reg=syncRegistryUrl();
  setBtn("⏳ 同步中…",true);
  try{
    const ctrl=new AbortController();
    setTimeout(()=>ctrl.abort(),15000);
    const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/start?token="+encodeURIComponent(bridgeTok),{
      method:"POST",headers:headers(true),
      body:JSON.stringify({registry:reg,token:token,only:onlyStr||item.name}),
      signal:ctrl.signal
    });
    const j=await r.json();
    if(!j.ok){ setBtn("同步此包",false); toast("❌ 同步启动失败："+esc(j.error||("HTTP "+r.status)),"err"); return; }
    toast("🚀 正在同步 "+esc(onlyStr||item.name)+"（含依赖）…","ok");
    pollNpmMirrorProgress(item.name);
    const t=setInterval(()=>{
      fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/progress?token="+encodeURIComponent(bridgeTok),{headers:headers(false)})
        .then(r=>r.json()).then(j=>{
          const p=(j&&j.progress)||{};
          if(p.state==="done"||p.state==="error"){
            clearInterval(t);
            setBtn("同步此包",false);
            toast(p.state==="done" ? ("✅ "+esc(onlyStr||item.name)+" 已同步") : ("❌ 同步失败："+esc((p.error||"").slice(0,150))), p.state==="done"?"ok":"err");
            renderNpmSync();
          }
        }).catch(()=>{});
    },2000);
  }catch(e){ setBtn("同步此包",false); toast("❌ 无法连接管理能力："+esc(e.message),"err"); }
}
// 同步全部未同步 npm 包（逐个排队发起：bridge 一次只能跑一个任务）
async function syncAllNpmPkgs(){
  const items=(mirrorPackages||[]).filter(p=>p);
  if(!items.length){ toast("无同步包","warn"); return; }
  if(!bridgePort){ toast("❌ 未连接管理员本机管理能力——请在页面顶部全局栏连接","err"); return; }
  const st=document.getElementById("npmsyncState");
  if(st) st.innerHTML='<span style="color:var(--amber)">已逐个发起…</span>';
  for(let i=0;i<items.length;i++){
    const item=items[i];
    const target=item.spec&&item.spec!=="latest"?item.spec:"";
    // 检查该包是否需要同步（先查状态，synced 跳过）
    const isSynced = await npmPkgIsSynced(item);
    if(isSynced) continue;
    const only = target? (item.name+"@"+target) : item.name;
    const bridgeTok=localStorage.getItem("bridgeToken")||"";
    const token=document.getElementById("mirrorToken").value.trim();
    if(!token){ toast("❌ 未配置发布 token","err"); return; }
    const reg=syncRegistryUrl();
    try{
      const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/start?token="+encodeURIComponent(bridgeTok),{
        method:"POST",headers:headers(true),
        body:JSON.stringify({registry:reg,token:token,only}),
        signal:AbortSignal.timeout(15000)
      });
      const j=await r.json();
      if(!j.ok){ toast("❌ "+esc(item.name)+" 启动失败："+esc(j.error||""),"err"); continue; }
      toast("🚀 已发起 "+esc(only)+"（含依赖）…","ok");
      // 等待该任务完成（轮询）
      await waitNpmMirrorDone(item.name);
    }catch(e){ toast("❌ 同步 "+esc(item.name)+" 失败："+esc(e.message),"err"); }
  }
  if(st) st.innerHTML='';
  renderNpmSync();
}
// 查询单个 npm 包内网是否已同步
async function npmPkgIsSynced(item){
  try{
    const q=item.spec&&item.spec!=="latest"?item.name+"@"+item.spec:item.name;
    const r=await fetch("/api/registry/sync-status?names="+encodeURIComponent(q)+"&registry="+encodeURIComponent(syncRegistryUrl()),{headers:headers(false)});
    const j=await r.json();
    const s=j&&j.plugins&&j.plugins[item.name];
    return s&&s.state==="synced";
  }catch(e){ return false; }
}
// 等待 bridge 镜像任务结束（供 syncAllNpmPkgs 串行）
function waitNpmMirrorDone(name){
  return new Promise((resolve)=>{
    const bridgeTok=localStorage.getItem("bridgeToken")||"";
    const t=setInterval(async ()=>{
      try{
        const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/progress?token="+encodeURIComponent(bridgeTok),{headers:headers(false)});
        const j=await r.json();
        const p=(j&&j.progress)||{};
        if(p.state==="done"||p.state==="error"){
          clearInterval(t);
          if(p.state==="error") toast("❌ 同步 "+esc(name)+" 失败："+esc((p.error||"").slice(0,150)),"err");
          resolve();
        }
      }catch(e){ clearInterval(t); resolve(); }
    },2000);
  });
}
// npm 包同步进度轮询（独立 DOM：npmsyncProgress/npmsyncState/npmsyncAllBtn）
let npmPollFailures=0;
async function pollNpmMirrorProgress(refreshAfterDone){
  if(!bridgePort) return;
  const bridgeTok=localStorage.getItem("bridgeToken")||"";
  const el=document.getElementById("npmsyncProgress");
  const st=document.getElementById("npmsyncState");
  try{
    const ctrl=new AbortController();
    setTimeout(()=>ctrl.abort(),8000);
    const r=await fetch("http://127.0.0.1:"+bridgePort+"/api/registry/mirror/progress?token="+encodeURIComponent(bridgeTok),{headers:headers(false),signal:ctrl.signal});
    const j=await r.json();
    if(!j.ok) return;
    npmPollFailures=0;
    const p=j.progress||{};
    const allBtn=document.getElementById("npmsyncAllBtn");
    if(p.state==="running"){
      if(el) el.innerHTML='<div style="background:#eef4ff;border:1px solid #cfe0ff;border-radius:8px;padding:10px 14px">'+
        '⏳ 同步中：<b>'+esc(p.current_pkg||"…")+'</b><br>进度：'+p.done_pkgs+'/'+p.total_pkgs+' 个包</div>';
      if(st) st.innerHTML='<span style="color:var(--amber)">同步中…</span>';
      if(allBtn) allBtn.disabled=true;
      if(npmPollTimer) clearTimeout(npmPollTimer);
      npmPollTimer=setTimeout(()=>pollNpmMirrorProgress(refreshAfterDone),3000);
    } else if(p.state==="done"){
      if(npmPollTimer){ clearTimeout(npmPollTimer); npmPollTimer=null; }
      if(el) el.innerHTML='<div style="background:#e8f7ee;border:1px solid #b7e3c8;border-radius:8px;padding:10px 14px">'+
        '✅ 同步完成：'+p.done_pkgs+'/'+p.total_pkgs+' 个包已同步到 '+esc(p.registry||"")+'</div>';
      if(st) st.innerHTML='<span style="color:var(--green)">已完成</span>';
      if(allBtn) allBtn.disabled=false;
      if(refreshAfterDone) renderNpmSync();
    } else if(p.state==="error"){
      if(npmPollTimer){ clearTimeout(npmPollTimer); npmPollTimer=null; }
      if(el) el.innerHTML='<div style="background:#fdeaea;border:1px solid #f5c6c6;border-radius:8px;padding:10px 14px">'+
        '❌ 同步出错：'+esc((p.error||"").slice(0,300))+'</div>';
      if(st) st.innerHTML='<span style="color:var(--red)">出错</span>';
      if(allBtn) allBtn.disabled=false;
      if(refreshAfterDone) renderNpmSync();
    }
  }catch(e){
    npmPollFailures++;
    if(npmPollFailures<=5){
      if(npmPollTimer) clearTimeout(npmPollTimer);
      npmPollTimer=setTimeout(()=>pollNpmMirrorProgress(refreshAfterDone),5000);
    } else {
      if(npmPollTimer){ clearTimeout(npmPollTimer); npmPollTimer=null; }
      if(st) st.innerHTML='<span style="color:var(--amber)">查询中断</span>';
    }
  }
}

// ── 菜单策略 ──
function renderMenuPolicy(){
  document.getElementById("menuEnabled").checked=!!current.managedMenu.enabled;
  const el=document.getElementById("menuList");
  const links=current.managedMenu.quickLinks||[];
  el.innerHTML=links.length
    ? links.map((q,i)=>'<div class="menu-item">'
        +'<span class="idx">'+(i+1)+'</span>'
        +'<input class="input" value="'+esc(q.label)+'" onchange="editMenuLabel('+i+',this.value)" placeholder="菜单名">'
        +'<input class="input" value="'+esc(q.url)+'" onchange="editMenuUrl('+i+',this.value)" placeholder="http(s)://地址">'
        +'<button class="btn sm ghost" onclick="moveMenuItem('+i+',-1)" title="上移">↑</button>'
        +'<button class="btn sm ghost" onclick="moveMenuItem('+i+',1)" title="下移">↓</button>'
        +'<button class="btn sm danger" onclick="removeMenuItem('+i+')" title="删除">✕</button>'
      +'</div>').join("")
    : '<div class="empty">暂无菜单项 —— 启用策略后客户端仍显示自己的本地菜单</div>';
}
function addMenuItem(){
  const label=document.getElementById("newMenuLabel").value.trim();
  const url=document.getElementById("newMenuUrl").value.trim();
  if(!label||!/^https?:\/\/\S+$/i.test(url)){ toast("菜单名非空、地址需 http/https","warn"); return; }
  current.managedMenu.quickLinks=current.managedMenu.quickLinks||[];
  current.managedMenu.quickLinks.push({label,url});
  document.getElementById("newMenuLabel").value=""; document.getElementById("newMenuUrl").value="";
  renderMenuPolicy();
}
function removeMenuItem(i){ current.managedMenu.quickLinks.splice(i,1); renderMenuPolicy(); }
function moveMenuItem(i,d){ const a=current.managedMenu.quickLinks; const j=i+d;
  if(j<0||j>=a.length) return; [a[i],a[j]]=[a[j],a[i]]; renderMenuPolicy(); }
function editMenuLabel(i,v){ current.managedMenu.quickLinks[i].label=v; }
function editMenuUrl(i,v){ current.managedMenu.quickLinks[i].url=v; }
async function saveMenuPolicy(){
  try{
    current.managedMenu.enabled=document.getElementById("menuEnabled").checked;
    const body={plugins:current.plugins,managedMenu:current.managedMenu};
    const r=await fetch("/api/config",{method:"POST",headers:headers(true),body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    current=j; current.managedMenu=current.managedMenu||{enabled:false,quickLinks:[]};
    renderMenuPolicy(); toast("菜单策略已保存","ok");
  }catch(e){ toast("保存失败："+esc(e.message),"err"); }
}

// ── 客户端 ──
function healthOf(c){
  if(c.offline) return {k:"bad",txt:"离线",dot:"bad"};
  if((c.pending||[]).length>0) return {k:"warn",txt:"缺插件",dot:"warn"};
  const pe=!!(current.managedMenu&&current.managedMenu.enabled);
  if(pe&&!c.menuApplied) return {k:"warn",txt:"菜单未应用",dot:"warn"};
  return {k:"ok",txt:"正常",dot:"ok"};
}
function chipPlugins(list){
  if(!list||!list.length) return '<span class="chip dim">未上报</span>';
  return list.map(p=>{
    const web=p.client?'<span class="web">web</span>':'';
    const pf=p.profile?'<span class="pf">'+esc(p.profile)+'</span>':'';
    const tip=esc((p.description||"")+"  ·  "+p.name+"@"+(p.version||"?")+"  ·  profile: "+(p.profile||"-"));
    return '<span class="chip" title="'+tip+'">'+esc(p.name)+'<span class="ver">@'+esc(p.version||"?")+'</span>'+pf+web+'</span>';
  }).join("");
}
function renderKpis(){
  const cs=latestClients;
  const online=cs.filter(c=>!c.offline).length;
  const missing=cs.filter(c=>(c.pending||[]).length>0).length;
  const pe=!!(current.managedMenu&&current.managedMenu.enabled);
  const notApplied=pe?cs.filter(c=>!c.offline&&!c.menuApplied).length:null;
  document.getElementById("kpis").innerHTML=
    kpi(cs.length,"客户端总数","🖥","b")+
    kpi(online,"在线","🟢","g")+
    kpi(missing,"缺插件","⚠️","r")+
    (notApplied!==null?kpi(notApplied,"菜单未应用","🔧","a"):"");
}
function kpi(n,label,ico,cls){ return '<div class="kpi '+cls+'"><div class="ico">'+ico+'</div><div><div class="num">'+n+'</div><div class="lbl">'+label+'</div></div></div>'; }
function renderOverviewClients(){
  const el=document.getElementById("overviewClients");
  if(!latestClients.length){ el.innerHTML='<div class="empty">尚无客户端上报 —— 同事端配置 serverUrl 后会自动同步到这里</div>'; return; }
  el.innerHTML='<div class="chips">'+latestClients.slice(0,12).map(c=>{
    const h=healthOf(c);
    return '<span class="chip dim"><span class="dot '+h.dot+'"></span>'+esc(c.hostname||c.clientId.slice(0,8))+'</span>';
  }).join("")+'</div>';
}
function renderClients(){
  const el=document.getElementById("clientGrid");
  if(!latestClients.length){ el.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty">尚无客户端上报 —— 同事端配置 serverUrl 后会自动同步到这里</div></div>'; return; }
  const pe=!!(current.managedMenu&&current.managedMenu.enabled);
  el.innerHTML=latestClients.map(c=>{
    const h=healthOf(c);
    const pend=(c.pending||[]).map(p=>'<span class="chip pending">'+esc(p)+'</span>').join("")||'<span class="chip dim">无</span>';
    const menu=(c.menu||[]).map(m=>'<span class="chip">'+esc(m.label)+'</span>').join("")||'<span class="chip dim">无</span>';
    const applied = c.offline ? '<span class="status gray"><span class="dot gray"></span>离线未知</span>'
      : pe ? (c.menuApplied?'<span class="status ok"><span class="dot ok"></span>已应用</span>':'<span class="status warn"><span class="dot warn"></span>未应用</span>')
      : '<span class="status gray"><span class="dot gray"></span>策略关闭</span>';
    const profs=(c.profiles||[]).map(p=>'<span class="chip dim">'+esc(p)+'</span>').join("")||'<span class="chip dim">—</span>';
    return '<div class="client">'
      +'<div class="chead"><div class="avatar">🖥</div>'
      +'<div class="who"><div class="host">'+esc(c.hostname||"未命名")+'</div><div class="cid">'+esc(c.clientId||"")+'</div></div>'
      +'<span class="status '+h.k+'"><span class="dot '+h.dot+'"></span>'+h.txt+'</span></div>'
      +'<div class="cbody">'
      +'<div class="sec">插件（'+(c.plugins||[]).length+'）</div><div class="chips">'+chipPlugins(c.plugins)+'</div>'
      +'<div class="sec">待装</div><div class="chips">'+pend+'</div>'
      +'<div class="sec">托盘菜单</div><div class="chips">'+menu+'</div>'
      +'<div class="sec">Profile</div><div class="chips">'+profs+'</div>'
      +'</div>'
      +'<div class="foot"><span>'+applied+'</span>'
      +'<span title="'+esc(c.lastSyncAt||"")+'">'+fmtTime(c.lastSyncAt)+'</span></div>'
      +'</div>';
  }).join("");
}

// ── Launcher 托盘发布 ──
async function loadLauncherRelease(){
  const el=document.getElementById("launcherReleaseCurrent");
  if(!el) return;
  try{
    const r=await fetch("/api/launcher/latest",{headers:headers(false)});
    const j=await r.json();
    if(j&&j.noRelease){
      el.innerHTML='<div class="chip dim" style="padding:6px 14px">当前无发布物 —— 同事 launcher 不触发升级</div>';
      return;
    }
    if(j&&j.version){
      const dt=j.publishedAt?(" · "+fmtTime(j.publishedAt)):"";
      el.innerHTML='<div class="chips" style="align-items:center"><span class="chip" style="background:var(--green-bg);color:var(--green)">✓ 当前发布 v'+esc(j.version)+'</span>'+
        '<span class="chip dim">'+esc(j.file)+'</span>'+
        '<span class="chip dim">'+Math.round(j.size/1024/1024)+' MB</span>'+
        (j.notes?'<span class="chip dim">'+esc(j.notes)+'</span>':'')+
        '</div><div style="font-size:12px;color:var(--muted);margin-top:6px">发布 '+dt+' · sha256 '+esc((j.sha256||"").slice(0,16))+'…</div>';
      return;
    }
    el.innerHTML='<div class="chip dim">查询失败</div>';
  }catch(e){ el.innerHTML='<div class="chip dim">查询失败：'+esc(e.message)+'</div>'; }
}
async function uploadLauncherRelease(){
  const btn=document.getElementById("launcherUploadBtn");
  const st=document.getElementById("launcherUploadState");
  const fileInput=document.getElementById("newLauncherExe");
  const ver=document.getElementById("newLauncherVersion").value.trim();
  const notes=document.getElementById("newLauncherNotes").value.trim();
  const f=fileInput&&fileInput.files&&fileInput.files[0];
  if(!f){ toast("请选择 launcher exe 文件","warn"); return; }
  if(!ver){ toast("请填版本号","warn"); return; }
  if(!/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(ver)){ toast("版本号格式非法（如 0.3.0）","warn"); return; }
  if(f.size<1000*1024){ toast("exe 过小（<1MB），不像有效二进制","warn"); return; }
  if(btn) btn.disabled=true;
  if(st) st.innerHTML='<span style="color:var(--amber)">上传中 '+Math.round(f.size/1024/1024)+' MB…</span>';
  try{
    const buf=await f.arrayBuffer();
    const r=await fetch("/api/launcher/releases?v="+encodeURIComponent(ver),{
      method:"POST",
      headers:Object.assign(headers(true),{"X-Notes":notes||""}),
      body:buf
    });
    const j=await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    toast("✅ launcher v"+esc(ver)+" 已发布（sha256 "+esc(j.release.sha256.slice(0,12))+"…）","ok");
    if(st) st.innerHTML='<span style="color:var(--green)">✅ 已发布 v'+esc(ver)+'</span>';
    document.getElementById("newLauncherExe").value="";
    document.getElementById("newLauncherVersion").value="";
    document.getElementById("newLauncherNotes").value="";
    loadLauncherRelease();
  }catch(e){
    if(st) st.innerHTML='';
    toast("❌ 发布失败："+esc(e.message),"err");
  }finally{
    if(btn) btn.disabled=false;
  }
}

// ── 启动 ──
// 先验证 token：有效 → 加载数据；无效 → 锁定登录门禁
(async()=>{
  const ok=await verifyToken();
  if(ok){
    hideLoginGate();
    refreshAll();
  } else {
    showLoginGate();
    // 预填上次输入的 token（方便重试）
    const ti=document.getElementById("tokenInput");
    if(ti && TOKEN) ti.value=TOKEN;
  }
})();
setInterval(loadStatus, 15000);