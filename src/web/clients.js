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
// 员工身份展示：姓名（中文）优先，其次账号；都空则「未登录」。
// 数据来自客户端上报（Keycloak SSO 登录写入本机 settings.yaml 的 username/displayName）。
function identityOf(c){
  const id=(c&&c.identity)||{};
  const name=String(id.displayName||"").trim();
  const user=String(id.username||"").trim();
  const owner=String(id.owner||"").trim();
  const twin=String(id.twinUserId||"").trim();
  const empty=!name&&!user&&!owner&&!twin;
  // 主显示：姓名 > 账号 > owner 的 localpart > 未登录
  let primary=name||user;
  if(!primary&&owner) primary=owner.replace(/^@/,"").split(":")[0];
  if(!primary) primary="未登录";
  // 副显示：账号（当主显示已是姓名时）/ 分身 userId
  const sub=[];
  if(name&&user) sub.push(user);
  if(twin) sub.push(twin);
  return {empty,primary,sub:sub.join(" · "),name,user,owner,twin};
}
// 身份徽标（概览 chips 里的小标签）
function identityChip(c){
  const id=identityOf(c);
  if(id.empty) return '<span class="chip dim" title="客户端未上报员工身份（未 SSO 登录，或 launcher < 0.4.2）">👤 未登录</span>';
  const tip=esc(["姓名："+(id.name||"—"),"账号："+(id.user||"—"),"主人："+(id.owner||"—"),"分身："+(id.twin||"—")].join("\n"));
  return '<span class="chip" title="'+tip+'">👤 '+esc(id.primary)+'</span>';
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
    return '<span class="chip dim"><span class="dot '+h.dot+'"></span>'+esc(c.hostname||c.clientId.slice(0,8))+'</span>'+identityChip(c);
  }).join("")+'</div>';
}
// 员工身份筛选词（工具栏输入框；空=不过滤）。
// 匹配姓名/账号/主人/分身/主机名，便于「找某个人用的那台机器」。
let clientFilter = "";
// 按筛选词过滤客户端（纯函数，便于自测）。
function filterClients(list, q){
  const kw=String(q||"").trim().toLowerCase();
  if(!kw) return list;
  return (list||[]).filter(c=>{
    const id=(c&&c.identity)||{};
    const hay=[c.hostname, c.clientId, id.displayName, id.username, id.owner, id.twinUserId]
      .map(x=>String(x||"").toLowerCase()).join(" ");
    return hay.includes(kw);
  });
}
function renderClients(){
  const el=document.getElementById("clientGrid");
  if(!latestClients.length){ el.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty">尚无客户端上报 —— 同事端配置 serverUrl 后会自动同步到这里</div></div>'; return; }
  const shown=filterClients(latestClients, clientFilter);
  if(!shown.length){
    el.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty">没有匹配「'+esc(clientFilter)+'」的客户端 —— 换个人名/账号/主机名试试</div></div>';
    return;
  }
  const pe=!!(current.managedMenu&&current.managedMenu.enabled);
  el.innerHTML=shown.map(c=>{
    const h=healthOf(c);
    const pend=(c.pending||[]).map(p=>'<span class="chip pending">'+esc(p)+'</span>').join("")||'<span class="chip dim">无</span>';
    const menu=(c.menu||[]).map(m=>'<span class="chip">'+esc(m.label)+'</span>').join("")||'<span class="chip dim">无</span>';
    const applied = c.offline ? '<span class="status gray"><span class="dot gray"></span>离线未知</span>'
      : pe ? (c.menuApplied?'<span class="status ok"><span class="dot ok"></span>已应用</span>':'<span class="status warn"><span class="dot warn"></span>未应用</span>')
      : '<span class="status gray"><span class="dot gray"></span>策略关闭</span>';
    const profs=(c.profiles||[]).map(p=>'<span class="chip dim">'+esc(p)+'</span>').join("")||'<span class="chip dim">—</span>';
    // 员工身份行：谁在用这台机器（姓名/账号/分身）
    const id=identityOf(c);
    const idBody = id.empty
      ? '<span class="chip dim" title="客户端未上报员工身份（未 SSO 登录，或 launcher < 0.4.2）">未登录 / 未上报</span>'
      : '<span class="chip" title="登录账号">'+esc(id.primary)+'</span>'
        + (id.user&&id.name?'<span class="chip dim">'+esc(id.user)+'</span>':'')
        + (id.twin?'<span class="chip dim" title="数字分身 userId">'+esc(id.twin)+'</span>':'');
    return '<div class="client">'
      +'<div class="chead"><div class="avatar">🖥</div>'
      +'<div class="who"><div class="host">'+esc(c.hostname||"未命名")+'</div><div class="cid">'+esc(c.clientId||"")+'</div></div>'
      +'<span class="status '+h.k+'"><span class="dot '+h.dot+'"></span>'+h.txt+'</span></div>'
      +'<div class="cbody">'
      +'<div class="sec">员工身份</div><div class="chips">'+idBody+'</div>'
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
// 渲染客户端页工具栏（离线数量 + 身份筛选 + 批量清理按钮）
function renderClientsToolbar(){
  const el=document.getElementById("clientsToolbar");
  if(!el) return;
  const off=latestClients.filter(c=>c.offline).length;
  const on=latestClients.length-off;
  // 未登录（老客户端或未 SSO）台数：管理员据此知道有多少机器还没身份
  const noId=latestClients.filter(c=>identityOf(c).empty).length;
  el.innerHTML='<span id="clientsSummary" style="color:var(--muted);font-size:12.5px"></span>'
    +'<input id="clientFilterInput" class="input" style="max-width:220px" placeholder="按姓名/账号/主机名筛选" '
      +'value="'+esc(clientFilter)+'" oninput="onClientFilterInput(this.value)">'
    +'<button class="btn" onclick="loadStatus()">刷新</button>'
    +(off>0?'<button class="btn danger" onclick="purgeOfflineClients()">清理离线（'+off+'）</button>':'');
  updateClientsSummary(noId);
}
// 筛选输入：只重绘卡片与汇总，**不重建输入框**（否则光标会丢、输入被打断）。
function onClientFilterInput(v){
  clientFilter=v;
  renderClients();
  updateClientsSummary(latestClients.filter(c=>identityOf(c).empty).length);
}
// 汇总文案（与筛选结果联动）
function updateClientsSummary(noId){
  const el=document.getElementById("clientsSummary");
  if(!el) return;
  const off=latestClients.filter(c=>c.offline).length;
  const on=latestClients.length-off;
  const shown=filterClients(latestClients, clientFilter).length;
  el.innerHTML='共 '+latestClients.length+' 台 · 在线 '+on+' · 离线 '+off
    + (noId>0? ' · <span title="这些客户端未上报员工身份：未 SSO 登录，或 launcher 版本 < 0.4.2">未登录 '+noId+'</span>' : '')
    + (clientFilter? ' · 匹配 '+shown+' 台' : '');
}

