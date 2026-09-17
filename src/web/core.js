/**
 * 全局状态与通用工具（必须最先加载：其余模块的函数体引用这里的变量）。
 *
 * 状态集中在此，避免散落各处导致「谁改了 bridgePort」难以追查。
 * 约定：顶层 let/const 状态只在本文件声明；其他文件只放函数。
 */

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

let mirrorPollTimer=null;
let mirrorPollFailures=0; // 连续轮询失败次数（bridge 短暂卡顿时重试，不永久停在"同步中"）
const MIRROR_POLL_MAX_FAILURES=5;
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
// ── 同步状态查询（服务端转发查内网 registry） ──
let syncRegistryCache="";
// 同步目标 registry 单一来源：顶部全局栏「内网 registry」输入框（避免两处配置困惑）
function syncRegistryUrl(){
  const v=document.getElementById("mirrorRegistry").value.trim();
  return v||"http://registry.ict.cmcc";
}
// ── npm 包同步（通用 npm 包镜像，独立清单） ──
const npmSpecRe=/^[A-Za-z0-9][A-Za-z0-9.*+^~<>=|\s-]*$/;
// 解析 "pkg@spec"（含 scoped）→ {name, spec}
let npmPollFailures=0;
