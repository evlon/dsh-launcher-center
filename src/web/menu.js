/**
 * 托盘菜单策略：统一下发同事端 launcher 的快捷链接。
 */

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

