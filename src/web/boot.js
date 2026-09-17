/**
 * 启动引导（最后加载）：校验 token → 加载数据；并起定时刷新。
 */

// ── 启动 ──
// 先验证 token：有效 → 加载数据；无效 → 锁定登录门禁
(async()=>{
  const ok=await verifyToken();
  if(ok){
    hideLoginGate();
    refreshAll();
  } else {
    showLoginGate();
    // 预填上次输入的 token（方便重试）
    const ti=document.getElementById("tokenInput");
    if(ti && TOKEN) ti.value=TOKEN;
  }
})();
setInterval(loadStatus, 15000);
