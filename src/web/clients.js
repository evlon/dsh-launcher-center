/**
 * 客户端状态展示（概览 KPI + 客户端卡片）。
 *
 * 数据来自客户端主动上报（POST /api/sync），服务端只是记录者，不反向探测。
 */

// ── 客户端 ──
// offline 由服务端按 lastSyncAt 计算（客户端上报的 offline 恒为 false，不可信）
function healthOf(c){
  if(c.offline) return {k:"bad",txt:"离线",dot:"bad"};
  if((c.pending||[]).length>0) return {k:"warn",txt:"缺插件",dot:"warn"};
  const pe=!!(current.managedMenu&&current.managedMenu.enabled);
  if(pe&&!c.menuApplied) return {k:"warn",txt:"菜单未应用",dot:"warn"};
  return {k:"ok",txt:"正常",dot:"ok"};
}
// 删除客户端记录（服务端 DELETE /api/clients）
async function removeClient(clientId,hostname){
  if(!confirm("确定删除客户端记录？\n\n"+(hostname||"未命名")+"\n"+clientId+
    "\n\n若该机器仍在线，下次同步（几分钟内）会自动重新出现。")) return;
  try{
    const r=await fetch("/api/clients",{method:"DELETE",headers:headers(true),
      body:JSON.stringify({clientId})});
    const j=await r.json().catch(()=>({}));
    if(r.status===403){ showLoginGate(); return; }
    if(!r.ok){ toast("删除失败："+((j&&j.error)||("HTTP "+r.status)),"bad"); return; }
    if(j.deleted>0){ toast("已删除 "+(hostname||clientId),"ok"); loadStatus(); }
    else toast("记录不存在（可能已被清理）","warn");
  }catch(e){ toast("删除失败："+e.message,"bad"); }
}
// 批量清理全部离线客户端（服务端按同一阈值判定 offline）
async function purgeOfflineClients(){
  const off=latestClients.filter(c=>c.offline);
  if(!off.length){ toast("当前没有离线客户端","warn"); return; }
  const names=off.slice(0,8).map(c=>"· "+(c.hostname||c.clientId.slice(0,8))).join("\n");
  if(!confirm("确定清理全部离线客户端？共 "+off.length+" 台\n\n"+names+
    (off.length>8?"\n… 等 "+(off.length-8)+" 台":"")+
    "\n\n若某台机器只是暂时关机，重新开机同步后会再次出现。")) return;
  try{
    const r=await fetch("/api/clients",{method:"DELETE",headers:headers(true),
      body:JSON.stringify({offline:true})});
    const j=await r.json().catch(()=>({}));
    if(r.status===403){ showLoginGate(); return; }
    if(!r.ok){ toast("清理失败："+((j&&j.error)||("HTTP "+r.status)),"bad"); return; }
    toast("已清理 "+j.deleted+" 台离线客户端","ok"); loadStatus();
  }catch(e){ toast("清理失败："+e.message,"bad"); }
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
      +'<span title="'+esc(c.lastSyncAt||"")+'">'+fmtTime(c.lastSyncAt)+'</span>'
      +'<button class="btn danger sm" title="删除此客户端记录" onclick="removeClient(\''+esc(c.clientId||"")+'\',\''+esc(c.hostname||"")+'\')">删除</button>'
      +'</div>'
      +'</div>';
  }).join("");
}
// 渲染客户端页工具栏（离线数量 + 批量清理按钮）
function renderClientsToolbar(){
  const el=document.getElementById("clientsToolbar");
  if(!el) return;
  const off=latestClients.filter(c=>c.offline).length;
  const on=latestClients.length-off;
  el.innerHTML='<span style="color:var(--muted);font-size:12.5px">共 '+latestClients.length+' 台 · 在线 '+on+' · 离线 '+off+'</span>'
    +'<button class="btn" onclick="loadStatus()">刷新</button>'
    +(off>0?'<button class="btn danger" onclick="purgeOfflineClients()">清理离线（'+off+'）</button>':'');
}

