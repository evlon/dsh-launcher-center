/**
 * launcher 托盘发布物管理（内网自托管自动更新）。
 *
 * 上传新 exe 到服务端 → 同事端 launcher 轮询 /api/launcher/latest 发现新版
 * → 下载 → sha256 校验 → 替换自身。sha256 由服务端计算（管理页 http 非安全上下文，
 * 前端 crypto.subtle 不可用）。
 */

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
      const dlUrl=location.origin+"/api/launcher/download?file="+encodeURIComponent(j.file);
      const shareUrl=location.origin+"/download";
      el.innerHTML='<div class="chips" style="align-items:center"><span class="chip" style="background:var(--green-bg);color:var(--green)">✓ 当前发布 v'+esc(j.version)+'</span>'+
        '<span class="chip dim">'+esc(j.file)+'</span>'+
        '<span class="chip dim">'+Math.round(j.size/1024/1024)+' MB</span>'+
        (j.notes?'<span class="chip dim">'+esc(j.notes)+'</span>':'')+
        '</div><div style="font-size:12px;color:var(--muted);margin-top:6px">发布 '+dt+' · sha256 '+esc((j.sha256||"").slice(0,16))+'…</div>'
        +'<div style="margin-top:10px;padding:10px 12px;background:var(--card-bg,#f7f8fa);border:1px solid var(--border,#e3e6ea);border-radius:8px">'
        +'<div style="font-size:12.5px;color:var(--muted);margin-bottom:6px">📤 分享给同事的下载链接（免鉴权，可直接发群）：</div>'
        +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
        +'<code id="launcherShareUrl" style="flex:1;min-width:260px;padding:6px 8px;background:#fff;border:1px solid var(--border,#e3e6ea);border-radius:6px;font-size:12.5px;word-break:break-all">'+esc(shareUrl)+'</code>'
        +'<button class="btn" type="button" onclick="copyLauncherLink(\''+esc(shareUrl)+'\')">复制链接</button>'
        +'<a class="btn" href="'+esc(shareUrl)+'" target="_blank" rel="noopener">打开下载页</a>'
        +'</div>'
        +'<div style="font-size:12px;color:var(--muted);margin-top:8px">直链 exe（可右键另存）：<a href="'+esc(dlUrl)+'" style="color:var(--blue,#2563eb)">'+esc(dlUrl)+'</a></div>'
        +'</div>';
      return;
    }
    el.innerHTML='<div class="chip dim">查询失败</div>';
  }catch(e){ el.innerHTML='<div class="chip dim">查询失败：'+esc(e.message)+'</div>'; }
}
// 复制 launcher 下载分享链接（管理页用；失败回退到手动选择）
function copyLauncherLink(url){
  const done=()=>toast&&toast("链接已复制，可直接发给同事","ok");
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(done).catch(()=>fallbackCopy(url,done));
  }else{ fallbackCopy(url,done); }
}
function fallbackCopy(url,done){
  try{
    const ta=document.createElement("textarea");
    ta.value=url; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    done&&done();
  }catch(e){ window.prompt("复制下面的链接：",url); }
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

