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
    loadMirrorPackages(); loadEnvDefaults(); renderJobPresets();
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

// ── 环境默认配置（envDefaults）：{ "<namespace>": { "<key>": "<值>" } } ──
// 工作副本 envDraft：命名空间不可改名（需改名请删除重建），键值可直接编辑。
let envDraft = {};
function loadEnvDefaults(){
  envDraft = {};
  const ed = current.envDefaults || {};
  for (const ns of Object.keys(ed)) {
    envDraft[ns] = {};
    for (const k of Object.keys(ed[ns] || {})) {
      const v = ed[ns][k];
      // 值只接受字符串/数字/布尔（服务端校验），统一按字符串展示
      envDraft[ns][k] = (typeof v === "boolean" || typeof v === "number") ? String(v) : String(v ?? "");
    }
  }
  renderEnvDefaults();
}
function renderEnvDefaults(){
  const el = document.getElementById("envDefaultsList");
  const nss = Object.keys(envDraft);
  if (!nss.length) {
    el.innerHTML = '<div class="empty">暂无环境默认配置 —— 点上方「＋ 添加命名空间」开始</div>';
    return;
  }
  el.innerHTML = nss.map((ns) => {
    const keys = Object.keys(envDraft[ns]);
    const rows = keys.map((k) =>
      '<div class="env-row">'
      + '<input class="input key" value="'+esc(k)+'" onchange="editEnvKey(\''+escJs(ns)+'\','+keys.indexOf(k)+',this.value)" placeholder="键名">'
      + '<input class="input val" value="'+esc(envDraft[ns][k])+'" onchange="editEnvVal(\''+escJs(ns)+'\','+keys.indexOf(k)+',this.value)" placeholder="值（如 https://auth.ict.cmcc/realms/employees）">'
      + '<button class="btn sm danger" onclick="removeEnvKey(\''+escJs(ns)+'\','+keys.indexOf(k)+')" title="删除此键">✕</button>'
      + '</div>'
    ).join("");
    return '<div class="env-card">'
      + '<div class="env-head"><span class="ns">'+esc(ns)+'</span>'
      + '<button class="btn sm ghost" onclick="addEnvKey(\''+escJs(ns)+'\')" title="添加键">＋ 键</button>'
      + '<button class="btn sm danger" onclick="removeEnvNamespace(\''+escJs(ns)+'\')" title="删除整个命名空间">✕</button></div>'
      + '<div class="env-body">' + (rows || '<div class="env-empty">无键 —— 点「＋ 键」添加</div>') + '</div>'
      + '</div>';
  }).join("");
}
// 唯一引号安全序列化（用于内联 onclick 参数）
function escJs(s){ return String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }
function addEnvNamespace(){
  const v = document.getElementById("newEnvNs").value.trim();
  if (!v) { toast("命名空间不能为空","warn"); return; }
  if (!/^[A-Za-z0-9_-]+$/.test(v)) { toast("命名空间限字母数字-_(如 matrix-activation)","warn"); return; }
  if (envDraft[v]) { toast("命名空间 "+esc(v)+" 已存在","warn"); return; }
  envDraft[v] = {};
  document.getElementById("newEnvNs").value = "";
  renderEnvDefaults();
}
function removeEnvNamespace(ns){
  delete envDraft[ns];
  renderEnvDefaults();
}
function addEnvKey(ns){
  // 追加一个空键行（自动生成未占用键名）
  const keys = Object.keys(envDraft[ns]);
  let k = "key" + (keys.length || "");
  let n = 1;
  while (envDraft[ns][k] !== undefined) { k = "key" + (keys.length + n); n++; }
  envDraft[ns][k] = "";
  renderEnvDefaults();
}
function removeEnvKey(ns, idx){
  const keys = Object.keys(envDraft[ns]);
  delete envDraft[ns][keys[idx]];
  renderEnvDefaults();
}
function editEnvKey(ns, idx, v){
  const keys = Object.keys(envDraft[ns]);
  const old = keys[idx];
  if (v === old) return;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) { toast("键名限字母数字-_","warn"); renderEnvDefaults(); return; }
  if (envDraft[ns][v] !== undefined && v !== old) { toast("键已存在","warn"); renderEnvDefaults(); return; }
  const val = envDraft[ns][old];
  const newKeys = keys.slice(); newKeys[idx] = v;
  delete envDraft[ns][old];
  envDraft[ns][v] = val;
  // 保持原有顺序
  const reordered = {};
  for (const k of newKeys) reordered[k] = envDraft[ns][k];
  envDraft[ns] = reordered;
  renderEnvDefaults();
}
function editEnvVal(ns, idx, v){
  const keys = Object.keys(envDraft[ns]);
  envDraft[ns][keys[idx]] = v;
}
async function saveEnvDefaults(){
  // 清洗：去掉空键行；空值保留（表示"下发空串"）但可被下方过滤
  const cleaned = {};
  for (const ns of Object.keys(envDraft)) {
    const row = {};
    for (const k of Object.keys(envDraft[ns])) {
      if (!k.trim()) continue;                        // 跳过空键名
      const val = (envDraft[ns][k] || "").trim();
      if (val === "") continue;                        // 跳过空值（避免持久化空串破坏幂等）
      row[k] = val;
    }
    if (Object.keys(row).length) cleaned[ns] = row;
  }
  try{
    const body = {
      plugins: current.plugins || [],
      managedMenu: current.managedMenu,
      clientDefaults: current.clientDefaults || {},
      envDefaults: cleaned,
    };
    const r = await fetch("/api/config",{method:"POST",headers:headers(true),body:JSON.stringify(body)});
    const j = await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    current = j; current.envDefaults = current.envDefaults || {};
    loadEnvDefaults(); toast("环境默认配置已保存","ok");
  }catch(e){ toast("保存失败："+esc(e.message),"err"); }
}

// ── 预装岗位（jobPresets）：字符串数组，新用户激活数字人后 himarket 自动落盘 ──
// 内置候选岗位清单（HiMarket 已发布的岗位技能名）。搜索框过滤 + chip 勾选；清单外岗位可手输追加。
const BUILTIN_JOBS = [
  { id: "pm",        label: "产品经理",   desc: "产品需求、PRD、需求澄清与优先级" },
  { id: "dev",       label: "研发工程师", desc: "接口联调、告警定位、排期评估、技术方案" },
  { id: "qa",        label: "测试工程师", desc: "测试用例、缺陷跟踪、验收" },
  { id: "leader",    label: "团队负责人", desc: "任务分配、进度跟进、决策驱动" },
  { id: "newbie",    label: "新员工",     desc: "新员工上手引导与答疑" },
  { id: "general",   label: "通用",       desc: "通用办公助手" },
  { id: "secretary", label: "秘书",       desc: "请示分级、决策回传、上呈主人、转达话术" },
  { id: "reception", label: "前台接待",   desc: "访客接待、咨询分流" },
];
// 已选岗位工作副本（含内置 + 手输清单外岗位），保存时整体提交。
let jobDraft = [];
function renderJobPresets(){
  jobDraft = Array.isArray(current.jobPresets) ? current.jobPresets.slice() : [];
  renderJobSelected(); renderJobCandidates();
}
function renderJobSelected(){
  const wrap = document.getElementById("jobSelectedWrap");
  const cnt = document.getElementById("jobPickCount");
  if (wrap) {
    wrap.innerHTML = jobDraft.length
      ? jobDraft.map(j => {
          const known = BUILTIN_JOBS.find(b => b.id === j);
          const label = known ? known.label : j;
          return '<span class="chip">'+esc(label)
            + '<span class="x" title="移除" onclick="removeJobPreset(\''+escJs(j)+'\')">✕</span></span>';
        }).join("")
      : '<span class="chip dim">尚未选择岗位 —— 下方勾选，或手输岗位名回车追加</span>';
  }
  if (cnt) cnt.textContent = "已选 " + jobDraft.length + " 个岗位";
}
function renderJobCandidates(){
  const wrap = document.getElementById("jobCandidatesWrap");
  if (!wrap) return;
  const q = (document.getElementById("jobSearchInput")?.value || "").trim().toLowerCase();
  const sel = new Set(jobDraft);
  const matched = BUILTIN_JOBS.filter(b =>
    !q || b.id.toLowerCase().includes(q) || b.label.toLowerCase().includes(q) || (b.desc||'').toLowerCase().includes(q)
  );
  if (!matched.length) {
    wrap.innerHTML = '<div class="job-empty">无匹配岗位。清单外岗位可直接在搜索框输入岗位名并回车追加。</div>';
    return;
  }
  wrap.innerHTML = '<div class="chips">' + matched.map(b => {
    const on = sel.has(b.id);
    const desc = b.desc ? '<span class="job-desc">'+esc(b.desc)+'</span>' : '';
    return '<span class="job-cand'+(on?' on':'')+'" onclick="toggleJobPreset(\''+escJs(b.id)+'\')">'
      + '<span class="tick">'+(on?'✓':'○')+'</span>'
      + '<span class="job-name">'+esc(b.label)+'</span>'
      + desc
      + '<span class="ver">'+esc(b.id)+'</span></span>';
  }).join("") + '</div>';
}
function toggleJobPreset(id){
  const i = jobDraft.indexOf(id);
  if (i >= 0) jobDraft.splice(i, 1); else jobDraft.push(id);
  renderJobSelected(); renderJobCandidates();
}
function removeJobPreset(id){
  const i = jobDraft.indexOf(id);
  if (i >= 0) jobDraft.splice(i, 1);
  renderJobSelected(); renderJobCandidates();
}
function addJobPresetManual(){
  const inp = document.getElementById("jobSearchInput");
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(v)) { toast("岗位名限字母数字-_（1-64 位）","warn"); return; }
  if (jobDraft.indexOf(v) < 0) jobDraft.push(v);
  inp.value = "";
  renderJobSelected(); renderJobCandidates();
  toast("已追加岗位 "+esc(v),"ok");
}
async function saveJobPresets(){
  try{
    const body = {
      plugins: current.plugins || [],
      managedMenu: current.managedMenu,
      clientDefaults: current.clientDefaults || {},
      envDefaults: current.envDefaults || {},
      jobPresets: jobDraft,
    };
    const r = await fetch("/api/config",{method:"POST",headers:headers(true),body:JSON.stringify(body)});
    const j = await r.json();
    if(!r.ok) throw new Error((j&&j.error)||("HTTP "+r.status));
    current = j; current.jobPresets = current.jobPresets || [];
    renderJobPresets(); toast("预装岗位已保存（"+jobDraft.length+" 个）","ok");
  }catch(e){ toast("保存失败："+esc(e.message),"err"); }
}

