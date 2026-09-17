/**
 * 登录门禁与 Tab 切换。
 *
 * 管理页鉴权模型：页面本身可打开（内网），但 /api/status 等接口需 token；
 * 页面加载即校验 token，403 则锁定全屏登录门禁。
 */

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

