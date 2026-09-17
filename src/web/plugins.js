/**
 * 插件策略：应装清单、上游版本对比、一键同步。
 *
 * ## 版本语义（踩坑记录，勿混淆）
 *   - 「内网版本」：来自服务端 /api/registry/sync-status（内网 registry 现有版本）
 *   - 「npmjs 上游版本」：只能来自 bridge（/api/registry/meta）——服务端查不到外网
 * 卡片上的 "npmjs vX" 必须是**真上游**；bridge 不可用时显示占位，
 * 绝不拿内网版本冒充（曾因此把内网 0.1.6 显示成 npmjs 0.1.6）。
 */

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

