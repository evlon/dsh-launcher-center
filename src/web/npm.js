/**
 * 「npm 包同步」：把任意通用 npm 包（含依赖树）镜像进内网 registry。
 *
 * 与「插件策略」的区别：这里管的是**非插件的通用依赖**（如 @deepseek-ai/dsh 本体、
 * zod 等），用于加速同事端安装；清单独立存 mirror-packages.json，不下发客户端。
 * 支持 pkg@spec 指定版本/dist-tag（需 launcher ≥ 0.3.0）。
 */

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
  // 2) 内网同步状态：带 spec 查询（bridge 优先、服务端降级，见 queryInternalSyncStatus）
  const queryNames=items.map(p=>p.spec&&p.spec!=="latest"?p.name+"@"+p.spec:p.name);
  const syncStates=await queryInternalSyncStatus(queryNames);
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
// 查询单个 npm 包内网是否已同步（bridge 优先、服务端降级）
async function npmPkgIsSynced(item){
  try{
    const q=item.spec&&item.spec!=="latest"?item.name+"@"+item.spec:item.name;
    const res=await queryInternalSyncStatus([q]);
    const s=res[item.name];
    return !!(s&&s.state==="synced");
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

