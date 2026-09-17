/**
 * 中心配置读取与「客户端默认配置」编辑。
 *
 * 注意两处配置的区别：
 *   - 全局栏「内网 registry」：镜像目标 + 同步状态查询源（见 bridge.js）
 *   - 本文件「客户端默认配置」：下发给同事端的默认值（本地显式设置过的不被覆盖）
 */

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

