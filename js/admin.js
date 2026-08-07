/* ===== ThirdHub js/admin.js — 管理后台（v1.7） =====
   入口 admin.html · 账号 admin · 密码 123456
   功能：会员套餐定价（月付/年付实时修改，会员中心即刻生效）· 意见反馈管理（回复 / 标记状态）· 数据概览
   所有写操作经 Supabase RPC 口令校验，无需暴露 service key */
const CLOUD = {
  url: 'https://mxvxlgjzeboktufumxbp.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODM5OTcsImV4cCI6MjA5OTk1OTk5N30.QjSLfYAFhwX72YSeAcbTN5O2_PDLaNcv76HhdGJsqpo',
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sb = null;
let PWD = sessionStorage.getItem('th-admin-pwd') || '';

async function loadSb() {
  if (sb) return sb;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  sb = window.supabase.createClient(CLOUD.url, CLOUD.anon);
  return sb;
}

function toast(msg, ok = true) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;left:50%;bottom:60px;transform:translateX(-50%);padding:10px 20px;border-radius:10px;background:${ok ? '#22c55e' : '#ef4444'};color:#fff;font-size:14px;z-index:9999`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- 登录门 ---------- */
async function renderGate() {
  $('#app').innerHTML = `
    <div class="adm-login">
      <img src="icons/brand.jpg" alt="ThirdHub">
      <h2 style="margin:0 0 4px">ThirdHub 管理后台</h2>
      <p class="muted" style="margin:0 0 18px">第三方科技 · 运营管理</p>
      <input class="input" id="g-user" placeholder="账号" value="admin" style="width:100%;margin-bottom:10px">
      <input class="input" id="g-pwd" type="password" placeholder="密码" style="width:100%;margin-bottom:14px">
      <button class="btn btn-primary btn-block" id="g-login" style="width:100%">登录</button>
      <p class="muted" id="g-err" style="color:#ef4444;margin-top:10px"></p>
    </div>`;
  $('#g-login').onclick = doLogin;
  $('#g-pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  async function doLogin() {
    const user = $('#g-user').value.trim();
    const pwd = $('#g-pwd').value;
    if (user !== 'admin') { $('#g-err').textContent = '账号不存在'; return; }
    try {
      const cli = await loadSb();
      const { error } = await cli.rpc('admin_list_feedback', { pwd });
      if (error) throw error;
      PWD = pwd;
      sessionStorage.setItem('th-admin-pwd', pwd);
      renderHome();
    } catch (e) { $('#g-err').textContent = '密码错误或云端不可用'; }
  }
}

/* ---------- 主界面 ---------- */
let tab = 'plans';
async function renderHome() {
  $('#app').innerHTML = `
    <div class="adm-wrap">
      <div class="adm-head">
        <img src="icons/brand.jpg">
        <div class="grow" style="flex:1">
          <div style="font-size:18px;font-weight:800">ThirdHub 管理后台</div>
          <div class="muted">第三方科技 · 运营管理端</div>
        </div>
        <button class="btn btn-sm" id="adm-logout">退出</button>
      </div>
      <div class="adm-tabs">
        <button class="adm-tab ${tab === 'plans' ? 'on' : ''}" data-t="plans">会员定价</button>
        <button class="adm-tab ${tab === 'feedback' ? 'on' : ''}" data-t="feedback">意见反馈</button>
        <button class="adm-tab ${tab === 'overview' ? 'on' : ''}" data-t="overview">数据概览</button>
      </div>
      <div id="adm-body"></div>
    </div>`;
  $('#adm-logout').onclick = () => { sessionStorage.removeItem('th-admin-pwd'); PWD = ''; renderGate(); };
  $$('.adm-tab').forEach((b) => b.onclick = () => { tab = b.dataset.t; renderHome(); });
  if (tab === 'plans') renderPlans();
  else if (tab === 'feedback') renderFeedback();
  else renderOverview();
}

/* ---------- 会员定价 ---------- */
async function renderPlans() {
  const body = $('#adm-body');
  body.innerHTML = '<p class="muted">加载中…</p>';
  const cli = await loadSb();
  const { data, error } = await cli.from('th_vip_plans').select('*');
  if (error) { body.innerHTML = `<p class="muted">加载失败：${esc(error.message)}</p>`; return; }
  const order = ['satellite', 'planet', 'star', 'galaxy'];
  const plans = (data || []).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  body.innerHTML = `
    <p class="muted" style="margin-bottom:14px">修改后点击「保存」，用户端会员中心立即生效。价格单位：人民币元。</p>
    <div class="col gap8" style="display:flex;flex-direction:column;gap:12px">
      ${plans.map((p) => {
        const d = p.data || {};
        return `<div class="card" data-pid="${esc(p.id)}">
          <div class="row gap8" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
            <b style="font-size:15px">${esc(d.name || p.id)}</b>
            <span class="tag tag-blue">${esc(d.storage || '')}</span>
          </div>
          <div class="plan-edit">
            <label class="muted">套餐名称<input class="input" data-f="name" value="${esc(d.name || '')}"></label>
            <label class="muted">副标题<input class="input" data-f="tagline" value="${esc(d.tagline || '')}"></label>
            <label class="muted">月付价格（元）<input class="input" type="number" min="0" data-f="monthly" value="${d.monthly || 0}"></label>
            <label class="muted">年付价格（元）<input class="input" type="number" min="0" data-f="yearly" value="${d.yearly || 0}"></label>
            <label class="muted">存储额度<input class="input" data-f="storage" value="${esc(d.storage || '')}"></label>
            <label class="muted">会员等级 ID<input class="input" data-f="level" value="${esc(d.level || p.id)}"></label>
          </div>
          <label class="muted" style="display:block;margin-top:10px">权益列表（每行一条）
            <textarea class="input" rows="4" data-f="benefits" style="width:100%">${esc((d.benefits || []).join('\n'))}</textarea>
          </label>
          <button class="btn btn-primary btn-sm" data-a="save" style="margin-top:10px">保存</button>
        </div>`;
      }).join('')}
    </div>`;
  $$('[data-a="save"]', body).forEach((b) => b.onclick = async () => {
    const card = b.closest('[data-pid]');
    const d = {
      name: $('[data-f="name"]', card).value.trim(),
      tagline: $('[data-f="tagline"]', card).value.trim(),
      monthly: +$('[data-f="monthly"]', card).value || 0,
      yearly: +$('[data-f="yearly"]', card).value || 0,
      storage: $('[data-f="storage"]', card).value.trim(),
      level: $('[data-f="level"]', card).value.trim(),
      benefits: $('[data-f="benefits"]', card).value.split('\n').map((x) => x.trim()).filter(Boolean),
    };
    b.disabled = true;
    try {
      const { error: e2 } = await cli.rpc('admin_upsert_vip_plan', { pwd: PWD, pid: card.dataset.pid, pdata: d });
      if (e2) throw e2;
      toast('已保存：' + d.name);
    } catch (e) { toast('保存失败：' + e.message, false); }
    b.disabled = false;
  });
}

/* ---------- 意见反馈管理 ---------- */
async function renderFeedback() {
  const body = $('#adm-body');
  body.innerHTML = '<p class="muted">加载中…</p>';
  const cli = await loadSb();
  const { data, error } = await cli.rpc('admin_list_feedback', { pwd: PWD });
  if (error) { body.innerHTML = `<p class="muted">加载失败：${esc(error.message)}</p>`; return; }
  const items = data || [];
  if (!items.length) { body.innerHTML = '<p class="muted">暂无反馈</p>'; return; }
  body.innerHTML = `<p class="muted" style="margin-bottom:14px">共 ${items.length} 条反馈（含「仅管理员可见」）。以「管理员」身份回复后，用户可在反馈详情中看到。</p>` +
    items.map((f) => {
      const d = f.data || {};
      return `<div class="card" data-fid="${esc(f.id)}" style="margin-bottom:12px">
        <div class="row gap8" style="display:flex;gap:8px;align-items:baseline">
          <b style="flex:1">${esc(d.title || '')}</b>
          <span class="tag ${d.visibility === 'public' ? 'tag-green' : 'tag-gray'}">${d.visibility === 'public' ? '公开' : '仅管理员'}</span>
          <span class="tag ${d.status === 'resolved' ? 'tag-blue' : 'tag-orange'}">${d.status === 'resolved' ? '已处理' : '待处理'}</span>
        </div>
        <div class="muted" style="margin:8px 0;white-space:pre-wrap">${esc(d.content || '')}</div>
        <div class="muted" style="font-size:12px">${esc(d.nickname || '用户')} · ${d.createdAt ? new Date(d.createdAt).toLocaleString('zh-CN') : ''}</div>
        <div class="row gap8" style="display:flex;gap:8px;margin-top:10px">
          <input class="input" data-f="reply" placeholder="以管理员身份回复…" style="flex:1">
          <button class="btn btn-sm btn-primary" data-a="reply">回复</button>
          <button class="btn btn-sm" data-a="toggle">${d.status === 'resolved' ? '标记待处理' : '标记已处理'}</button>
        </div>
      </div>`;
    }).join('');
  $$('[data-a="reply"]', body).forEach((b) => b.onclick = async () => {
    const card = b.closest('[data-fid]');
    const v = $('[data-f="reply"]', card).value.trim();
    if (!v) return;
    try {
      const { error: e2 } = await cli.rpc('admin_reply_feedback', { pwd: PWD, fid: card.dataset.fid, content: v });
      if (e2) throw e2;
      toast('已回复');
      $('[data-f="reply"]', card).value = '';
    } catch (e) { toast('回复失败：' + e.message, false); }
  });
  $$('[data-a="toggle"]', body).forEach((b) => b.onclick = async () => {
    const card = b.closest('[data-fid]');
    const nowResolved = b.textContent.includes('待处理') ? false : true;
    try {
      const { error: e2 } = await cli.rpc('admin_set_feedback_status', { pwd: PWD, fid: card.dataset.fid, status: nowResolved ? 'open' : 'resolved' });
      if (e2) throw e2;
      renderFeedback();
    } catch (e) { toast('操作失败：' + e.message, false); }
  });
}

/* ---------- 数据概览 ---------- */
async function renderOverview() {
  const body = $('#adm-body');
  body.innerHTML = '<p class="muted">加载中…</p>';
  const cli = await loadSb();
  const counts = {};
  for (const t of ['th_profiles', 'th_feedback', 'th_vip_plans', 'th_devices', 'th_settings', 'th_bookshelf']) {
    try {
      const { count, error } = await cli.from(t).select('*', { count: 'exact', head: true });
      counts[t] = error ? '—' : count;
    } catch (e) { counts[t] = '—'; }
  }
  const NAMES = { th_profiles: '注册用户', th_feedback: '意见反馈', th_vip_plans: '会员套餐', th_devices: '登记设备', th_settings: '设置同步', th_bookshelf: '书架同步记录' };
  let version = '—';
  try { version = (await (await fetch('version.json?_=' + Date.now())).json()).version; } catch (e) {}
  body.innerHTML = `
    <div class="card" style="margin-bottom:12px"><b>当前站点版本</b><div style="font-size:24px;font-weight:800;color:var(--primary,#3b5bfd);margin-top:6px">v${esc(version)}</div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
      ${Object.keys(NAMES).map((t) => `<div class="card" style="text-align:center"><div style="font-size:22px;font-weight:800">${counts[t]}</div><div class="muted">${NAMES[t]}</div></div>`).join('')}
    </div>
    <p class="muted" style="margin-top:16px">版本发布流程：更新代码 → 推送到 GitHub（网页版主仓库）→ Cloudflare Pages 自动镜像。版本号格式 x.y。</p>`;
}

/* ---------- 启动 ---------- */
(async () => {
  if (PWD) {
    try {
      const cli = await loadSb();
      const { error } = await cli.rpc('admin_list_feedback', { pwd: PWD });
      if (!error) return renderHome();
    } catch (e) {}
    sessionStorage.removeItem('th-admin-pwd');
  }
  renderGate();
})();
