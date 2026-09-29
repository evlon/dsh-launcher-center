/**
 * 三通道版本组合管理（正式版/预览版/开发版）。
 *
 * 每个通道下发：dsh 核心版本 + 插件清单（name@version）+ 岗位清单（jobs）。
 * 客户端按当前通道对齐安装；管理员在此维护「哪个通道该装什么」。
 *
 * 发布流程（test-gate）：先在 preview/dev 通道验证 → 「升为正式版」把 preview 复制到 stable。
 * 数据存 /api/releases（服务端 config.json 的 releases 字段）。
 */

const RELEASE_CHANNELS = [
  { key: "stable",  label: "正式版", color: "#16a34a", bg: "#e8f7ee", desc: "全员默认通道，稳定优先" },
  { key: "preview", label: "预览版", color: "#d97706", bg: "#fef3e2", desc: "灰度验证，新功能提前试用" },
  { key: "dev",     label: "开发版", color: "#dc2626", bg: "#fdeaea", desc: "内测，尝鲜最新开发进展" },
];

// 当前三通道草稿（loadReleases 时从 current.releases 复制，避免直接改 current）
let releasesDraft = { stable: {}, preview: {}, dev: {} };

function emptyManifest(){ return { releaseId: "", dsh: "", plugins: [], jobs: [] }; }

function normManifest(m){ m = m || {}; return {
  releaseId: (m.releaseId || "").trim(),
  dsh: (m.dsh || "").trim(),
  plugins: Array.isArray(m.plugins) ? m.plugins : [],
  jobs: Array.isArray(m.jobs) ? m.jobs : [],
}; }

function pluginLine(p){ return (p.name || "") + (p.version ? "@" + p.version : ""); }

// 渲染三通道卡片
function renderReleases(){
  const grid = document.getElementById("releasesGrid");
  if(!grid) return;
  grid.innerHTML = RELEASE_CHANNELS.map(function(ch){
    const m = normManifest(releasesDraft[ch.key]);
    return '<div style="border:1px solid var(--line,#e5e8f0);border-radius:12px;padding:14px;background:#fff">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+ch.color+'"></span>' +
        '<b style="font-size:14.5px">'+ch.label+'</b>' +
        '<span class="sync-hint" style="font-size:11.5px">'+ch.desc+'</span>' +
      '</div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11.5px;color:var(--muted)">dsh 核心版本</label>' +
        '<input class="input" id="rel-'+ch.key+'-dsh" placeholder="如 0.1.7-rc.2" value="'+esc(m.dsh)+'" style="margin-top:3px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11.5px;color:var(--muted)">插件清单（每行 name@version）</label>' +
        '<textarea class="input" id="rel-'+ch.key+'-plugins" rows="3" placeholder="dsh-matrix-agent@0.3.10" style="margin-top:3px;font-family:monospace;font-size:12px">' +
        esc(m.plugins.map(pluginLine).join("\n")) + '</textarea></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11.5px;color:var(--muted)">岗位（逗号分隔，可空）</label>' +
        '<input class="input" id="rel-'+ch.key+'-jobs" placeholder="客服专员, 质检员" value="'+esc((m.jobs||[]).join(", "))+'" style="margin-top:3px"></div>' +
      (ch.key === "stable"
        ? '<div style="font-size:11.5px;color:var(--muted);margin-top:6px">💡 发布流程：先在预览/开发通道验证通过，点下方「从预览升为正式版」一键灰度。</div>'
        : '<button class="btn" type="button" style="font-size:12px;padding:5px 12px" onclick="promoteToStable(\''+ch.key+'\')">⬆ 升为正式版</button>') +
    '</div>';
  }).join("");
}

// 读取输入框 → 草稿（校验版本号格式）
function readReleasesFromForm(){
  const out = { stable: emptyManifest(), preview: emptyManifest(), dev: emptyManifest() };
  const verRe = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;
  for(const ch of RELEASE_CHANNELS){
    const dsh = (document.getElementById("rel-"+ch.key+"-dsh")||{}).value.trim();
    if(dsh && !verRe.test(dsh)){ toast("❌ "+ch.label+" dsh 版本号格式非法："+esc(dsh)+"（如 0.1.7-rc.2）","err"); return null; }
    const pluginsText = (document.getElementById("rel-"+ch.key+"-plugins")||{}).value || "";
    const plugins = pluginsText.split("\n").map(function(l){ return l.trim(); }).filter(Boolean).map(function(line){
      const at = line.lastIndexOf("@");
      if(at <= 0) { toast("❌ 插件格式非法："+esc(line)+"（应 name@version）","err"); return null; }
      return { name: line.slice(0, at).trim(), version: line.slice(at+1).trim() };
    });
    if(plugins.some(function(p){ return p === null; })) return null;
    const jobsText = (document.getElementById("rel-"+ch.key+"-jobs")||{}).value || "";
    const jobs = jobsText.split(/[,，]/).map(function(j){ return j.trim(); }).filter(Boolean);
    out[ch.key] = { releaseId: "", dsh: dsh, plugins: plugins, jobs: jobs };
  }
  return out;
}

// 从预览/开发通道复制到正式版（灰度发布）
function promoteToStable(from){
  const src = normManifest(releasesDraft[from]);
  releasesDraft.stable = JSON.parse(JSON.stringify(src));
  renderReleases();
  toast("已将「"+from+"」通道配置复制到正式版草稿，点「保存三通道配置」生效","ok");
}

// 加载三通道（从 current.releases 复制到草稿）
function loadReleases(){
  releasesDraft = {
    stable: normManifest(current.releases && current.releases.stable),
    preview: normManifest(current.releases && current.releases.preview),
    dev: normManifest(current.releases && current.releases.dev),
  };
  renderReleases();
}

// 保存三通道配置（POST /api/releases）
async function saveReleases(){
  const draft = readReleasesFromForm();
  if(!draft) return;
  const st = document.getElementById("releasesState");
  try{
    const r = await fetch("/api/releases",{ method:"POST", headers:headers(true), body:JSON.stringify({ releases: draft }) });
    const j = await r.json();
    if(!r.ok) throw new Error((j && j.error) || ("HTTP " + r.status));
    releasesDraft = draft;
    if(current.releases) current.releases = j.releases;
    if(st) st.innerHTML = '<span style="color:var(--green)">✅ 已保存，客户端下次同步生效</span>';
    toast("✅ 三通道版本组合已保存","ok");
    setTimeout(function(){ if(st) st.innerHTML = ""; }, 4000);
  }catch(e){
    if(st) st.innerHTML = "";
    toast("❌ 保存失败："+esc(e.message),"err");
  }
}
