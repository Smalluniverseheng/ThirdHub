/* ===== ThirdHub js/modules/dsh-console.js — DSH 工作台（v6.9）：通过 Agent 转发 DSH Web API ===== */
import { $, $$, el, esc, icon, toast } from '../ui.js';
import { listDevices, getStatus, dshCall, dshGet, backendCall } from './compute.js';
import { getApprovalState, onApprovalChange } from './approvals.js';

/* 审批状态快照注入（approvals.js → 本工作台审批页） */
window.__approvals = getApprovalState;

let _devId = null;
let _curTab = 'overview';

async function call(path, payload = {}) {
  const r = await dshCall(_devId, path, payload);
  if (!r || !r.ok) throw new Error((r && r.data && r.data.error && (r.data.error.message || JSON.stringify(r.data.error).slice(0, 120))) || '请求失败');
  const res = r.data && r.data.result;
  if (res && res.ok === false) throw new Error((res.error && (res.error.message || JSON.stringify(res.error).slice(0, 140))) || 'DSH 返回错误');
  return res && res.value !== undefined ? res.value : res;
}
async function get(path) {
  const r = await dshGet(_devId, path);
  if (!r || !r.ok) throw new Error('请求失败');
  return r.data;
}

function tabName(t) { return { overview: '总览', presets: '模式预设', tasks: '任务看板', sessions: '会话轨迹', plugins: '插件', models: '模型', settings: '设置', storage: '电脑存储', approvals: '审批' }[t] || t; }

function shell(page) {
  const dev = (listDevices() || []).find((d) => d.id === _devId);
  const st = getStatus(_devId);
  page.innerHTML = `
    <div class=\"page-head\">
      <button class=\"icon-btn\" data-a=\"back\">${icon('arrowL')}</button>
      <div class=\"page-title\">DSH 工作台</div>
      <div class=\"spacer\"></div>
      <button class=\"icon-btn\" data-a=\"refresh\" title=\"刷新\">${icon('refresh')}</button>
    </div>
    <div class=\"muted\" style=\"padding:0 16px 10px;font-size:12px\">${esc((dev && dev.name) || '')} · ${st === 'online' ? '🟢 已连接' : '⚪ 离线'} · 数据来自电脑 DSH Web</div>
    <div class=\"row gap4\" style=\"padding:0 12px 12px;flex-wrap:wrap\">
      ${['overview', 'presets', 'tasks', 'sessions', 'plugins', 'models', 'settings', 'storage', 'approvals'].map((t) => `<button class=\"btn btn-sm${_curTab === t ? ' btn-primary' : ''}\" data-tab=\"${t}\">${tabName(t)}${t === 'approvals' ? '<span class=\"apr-badge\" style=\"display:none;margin-left:5px\"></span>' : ''}</button>`).join('')}
    </div>
    <div data-role=\"content\" style=\"padding:0 16px 40px\"></div>
  `;
  $('[data-a=\"back\"]', page).onclick = async () => { const m = await import('./compute.js'); m.renderCompute(page); };
  $('[data-a=\"refresh\"]', page).onclick = () => render();
  $$('[data-tab]', page).forEach((b) => b.onclick = () => { _curTab = b.dataset.tab; render(); });
  function render() { renderTab($('[data-role=\"content\"]', page)); refreshAprBadges(); }
  render();
}

/* 审批标签徽标刷新（v9.2） */
function refreshAprBadges() {
  const n = getApprovalState().pending.length;
  document.querySelectorAll('[data-tab=\"approvals\"] .apr-badge').forEach((b) => {
    b.textContent = n > 0 ? n : '';
    b.style.display = n > 0 ? 'inline-block' : 'none';
  });
}

async function renderTab(box) {
  box.innerHTML = '<div class="loading-row" style="margin:40px 0"><div class="spinner"></div></div>';
  try {
    if (_curTab === 'overview') await renderOverview(box);
    else if (_curTab === 'presets') await renderPresets(box);
    else if (_curTab === 'tasks') await renderTasks(box);
    else if (_curTab === 'sessions') await renderSessions(box);
    else if (_curTab === 'plugins') await renderPlugins(box);
    else if (_curTab === 'models') await renderModels(box);
    else if (_curTab === 'settings') await renderSettings(box);
    else if (_curTab === 'storage') await renderStorage(box);
    else if (_curTab === 'approvals') renderApprovals(box);
  } catch (e) {
    box.innerHTML = '<div class="empty"><div class="empty-title">加载失败</div><div class="muted" style="font-size:12px;margin-top:6px">' + esc(e.message || String(e)) + '</div></div>';
  }
}

/* ---------- 总览 ---------- */
async function renderOverview(box) {
  const [host, tb, presets, inv, llm, sess] = await Promise.all([
    call('/api/host.describe').catch(() => null),
    get('/api/task-board/state').catch(() => null),
    call('/api/agentPreset.list').catch(() => null),
    call('/api/dynamicCordisRunner/inventory').catch(() => null),
    call('/api/llm.providers').catch(() => null),
    call('/api/session.list').catch(() => null),
  ]);
  const presetsList = (presets && presets.presets) || [];
  const plugins = (inv && inv.plugins) || [];
  const sessions = (sess && sess.items) || [];
  const cards = [
    ['运行中会话', (tb && tb.power && tb.power.runningSessions) || 0],
    ['任务看板任务', (tb && tb.tasks && tb.tasks.length) || 0],
    ['模式预设', presetsList.length],
    ['已加载插件', plugins.length],
    ['会话总数', sessions.length],
    ['LLM 提供商', (llm && (llm.providers || []).length) || 0],
  ];
  box.innerHTML = `<div class=\"section-title\">DSH 运行状态</div>
    <div class=\"row\" style=\"flex-wrap:wrap;gap:8px\">
      ${cards.map(([k, v]) => `<div class=\"card\" style=\"flex:1;min-width:30%;padding:12px\"><div style=\"font-size:22px;font-weight:700\">${v}</div><div class=\"muted\" style=\"font-size:12px\">${k}</div></div>`).join('')}
    </div>
    <div class=\"section-title\" style=\"margin-top:18px\">主机信息</div>
    <div class=\"card\" style=\"padding:12px;font-size:12px;line-height:1.9;word-break:break-all\">${esc(JSON.stringify(host || {}, null, 1)).replace(/\n/g, '<br>')}</div>
    <div class=\"muted\" style=\"font-size:12px;margin-top:14px\">DSH 工作台通过电脑上的 DSH Web(3789)实时读取；任务看板可查看后台任务与并发会话。</div>`;
}

/* ---------- 模式预设 ---------- */
async function renderPresets(box) {
  const { presets } = await call('/api/agentPreset.list');
  box.innerHTML = '<div class="section-title">Agent 预设（模式）</div><div class="col gap8">' +
    presets.map((p) => `<div class=\"card\" style=\"padding:12px\">
      <div class=\"row\"><b style=\"font-size:14px\">${esc(p.name)}</b>${p.isDefault ? '<span class=\"tag tag-green\" style=\"margin-left:8px\">默认</span>' : ''}${p.trust === 'user' ? '<span class=\"tag\" style=\"margin-left:8px\">自建</span>' : ''}</div>
      <div class=\"muted\" style=\"font-size:12px;margin:6px 0;line-height:1.7\">${esc(p.description || '')}</div>
      <button class=\"btn btn-sm\" data-new=\"${esc(p.id)}\">＋ 以此模式新建会话</button>
    </div>`).join('') + '</div>';
  $$('[data-new]', box).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await call('/api/session.create', { agentPreset: b.dataset.new });
      toast('已创建会话：' + (r.sessionId || ''), 'ok');
      _curTab = 'sessions';
      renderTab(box.closest('[data-role=content]'));
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  });
}

/* ---------- 任务看板 ---------- */
async function renderTasks(box) {
  const tb = await get('/api/task-board/state');
  const tasks = (tb && tb.tasks) || [];
  const running = (tb && tb.power && tb.power.runningSessions) || 0;
  const statusOf = (s) => ({ planned: '待规划', todo: '待办', in_progress: '进行中', done: '已完成', failed: '已失败' }[s] || s || '—');
  box.innerHTML = `<div class=\"row\"><div class=\"section-title\" style=\"margin:0\">后台任务</div><div class=\"spacer\"></div><span class=\"tag\">运行中会话 ${running}</span></div>` +
    (tasks.length ? tasks.map((t) => `<div class=\"card\" style=\"padding:12px;margin-top:10px\">
      <div class=\"row\"><b style=\"font-size:13.5px\">${esc(t.title || t.name || t.id || '任务')}</b><span class=\"tag\" style=\"margin-left:8px\">${statusOf(t.status)}</span></div>
      ${t.detail ? `<div class=\"muted\" style=\"font-size:12px;margin-top:4px\">${esc(t.detail)}</div>` : ''}
    </div>`).join('') : '<div class=\"empty\" style=\"margin-top:30px\"><div class=\"empty-title\">任务看板为空</div><div class=\"muted\" style=\"font-size:12px\">后台没有运行中的任务</div></div>') +
    '<div class="muted" style="font-size:12px;margin-top:14px">任务看板数据来自电脑 DSH Web；SSE 实时推送后续版本接入。</div>';
}

/* ---------- 会话与轨迹 ---------- */
async function renderSessions(box) {
  const { items } = await call('/api/session.list');
  const sessions = items || [];
  if (!sessions.length) { box.innerHTML = '<div class="empty"><div class="empty-title">还没有会话</div></div>'; return; }
  box.innerHTML = '<div class="section-title">会话列表（点击查看轨迹）</div><div class="col gap6">' +
    sessions.map((s) => `<button class=\"list-item\" data-sid=\"${esc(s.sessionId)}\" style=\"width:100%;text-align:left\">
      <div class=\"grow\" style=\"min-width:0\">
        <div style=\"font-size:13.5px;font-weight:600\" class=\"ellipsis\">${esc((s.projections && s.projections.values && s.projections.values.title) || s.sessionId)}</div>
        <div class=\"muted\" style=\"font-size:11px\">${esc((s.projections && s.projections.values && s.projections.values.agentPreset) || '')}${s.running ? ' · 🟢 运行中' : ''}${s.blank ? ' · 空白' : ''}</div>
      </div>
      ${s.running ? '<span class=\"cp-dot on\"></span>' : ''}
    </button>`).join('') + '</div>';
  $$('[data-sid]', box).forEach((b) => b.onclick = () => showTrajectory(box, b.dataset.sid));
}
async function showTrajectory(box, sid) {
  try {
    const { events } = await call('/api/session.history', { sessionId: sid });
    const blocks = [];
    let cur = null;
    const newA = () => { cur = { type: 'assistant', text: '', reasoning: '', tools: [] }; blocks.push(cur); return cur; };
    for (const e of events || []) {
      const ev = e.event || e; const t = ev.type || ''; const d = ev.data || {};
      if (t === 'turn/start') blocks.push({ type: 'turn', turn: d.turn || 1 });
      else if (t === 'user/message') { const c = (d.content || [])[0]; blocks.push({ type: 'user', text: (c && (c.text || c.content)) || '' }); }
      else if (t === 'assistant/chunk') {
        const c = d.chunk || {};
        if (c.type === 'text-delta' && c.text) { if (!cur || cur.type !== 'assistant') newA(); cur.text += c.text; }
        else if (c.type === 'reasoning-delta' && c.text) { if (!cur || cur.type !== 'assistant') newA(); cur.reasoning += c.text; }
      }
      else if (t === 'tool/call' || t === 'tool/start') { if (!cur || cur.type !== 'assistant') newA(); cur.tools.push({ name: String(d.tool || d.name || '工具'), args: String(d.arguments || d.args || ''), result: '' }); }
      else if (t === 'tool/result' || t === 'tool/end') { const a = blocks[blocks.length - 1]; if (a && a.type === 'assistant' && a.tools.length) a.tools[a.tools.length - 1].result = String(d.result || d.output || ''); }
    }
    const html = blocks.map((b) => {
      if (b.type === 'turn') return '<div class="muted" style="font-size:12px;text-align:center;margin:14px 0 6px">— 第 ' + b.turn + ' 轮 —</div>';
      if (b.type === 'user') return '<div style="display:flex;justify-content:flex-end;margin:8px 0"><div style="max-width:85%;background:var(--primary);color:#fff;border-radius:14px 14px 4px 14px;padding:9px 12px;font-size:14px;line-height:1.6;word-break:break-word">' + esc(b.text) + '</div></div>';
      const think = b.reasoning ? '<details style="margin:6px 0"><summary style="cursor:pointer;font-size:12px;color:var(--primary)">🤔 深度思考（' + b.reasoning.length + ' 字）</summary><div style="background:var(--bg-card);border-left:3px solid var(--primary);padding:8px 10px;margin-top:4px;font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word">' + esc(b.reasoning) + '</div></details>' : '';
      const tools = b.tools.map((tl) => '<details style="margin:6px 0"><summary style="cursor:pointer;font-size:12.5px">🔧 ' + esc(tl.name) + (tl.args ? '<span class="muted"> · ' + esc(tl.args.slice(0, 50)) + '</span>' : '') + '</summary><div style="background:var(--bg-card);border-radius:8px;padding:8px 10px;margin-top:4px;font-size:12px;line-height:1.6;word-break:break-all"><div class="muted">参数</div>' + esc(tl.args.slice(0, 300)) + (tl.result ? '<div class="muted" style="margin-top:6px">结果</div>' + esc(tl.result.slice(0, 600)) : '') + '</div></details>').join('');
      return '<div style="margin:8px 0"><div style="font-size:13px;font-weight:600;color:var(--tx-2)">🤖 助手</div>' + think + tools + '<div style="font-size:14px;line-height:1.7;word-break:break-word;white-space:pre-wrap">' + esc(b.text || '') + '</div></div>';
    }).join('');
    box.innerHTML = '<div class="row"><button class="btn btn-sm" data-a="back2">← 返回会话列表</button></div>' +
      '<div class="section-title" style="margin-top:10px">轨迹：' + esc(sid) + '</div>' +
      '<div style="padding:4px 2px 20px">' + (html || '<div class="empty"><div class="empty-title">无轨迹内容</div></div>') + '</div>';
    $('[data-a=back2]', box).onclick = () => renderSessions(box);
  } catch (e) { box.innerHTML = '<div class="empty"><div class="empty-title">轨迹加载失败</div><div class="muted">' + esc(e.message) + '</div></div>'; }
}
/* ---------- 插件 ---------- */
async function renderPlugins(box) {
  const inv = await call('/api/dynamicCordisRunner/inventory');
  const plugins = (inv && inv.plugins) || (inv && inv.items) || [];
  if (!plugins.length) { box.innerHTML = '<div class="empty"><div class="empty-title">插件清单为空</div><div class="muted" style="font-size:12px">' + esc(JSON.stringify(inv).slice(0, 200)) + '</div></div>'; return; }
  box.innerHTML = '<div class="row"><div class="section-title" style="margin:0">已加载插件（' + plugins.length + '）</div><div class="spacer"></div><button class="btn btn-sm" data-a="prefresh">' + icon('refresh') + ' 刷新</button></div><div class="col gap6" style="margin-top:10px">' +
    plugins.map((p) => `<div class=\"list-item\" style=\"width:100%\">
      <div class=\"grow\" style=\"min-width:0\">
        <div style=\"font-size:13px;font-weight:600\" class=\"ellipsis\">${esc(p.name || p.id || '')} <span class=\"muted\" style=\"font-size:11px\">${esc(p.version || '')}</span></div>
        <div class=\"muted\" style=\"font-size:11px\" class=\"ellipsis\">${esc(p.description || p.id || '')}</div>
      </div>
      <span class=\"tag ${p.enabled === false ? 'tag-gray' : 'tag-green'}\">${p.enabled === false ? '已停用' : '启用'}</span>
    </div>`).join('') + '</div>';
  $('[data-a=prefresh]', box).onclick = () => renderPlugins(box);
}

/* ---------- 模型 ---------- */
async function renderModels(box) {
  const llm = await call('/api/llm.providers');
  const provs = (llm && llm.providers) || [];
  if (!provs.length) { box.innerHTML = '<div class="empty"><div class="empty-title">无模型提供商</div></div>'; return; }
  box.innerHTML = '<div class="section-title">模型提供商（' + provs.length + '）</div><div class="col gap6">' +
    provs.map((p) => `<div class=\"card\" style=\"padding:12px\">
      <div style=\"font-size:13.5px;font-weight:600\">${esc(p.name || p.id || '')}</div>
      <div class=\"muted\" style=\"font-size:11.5px;margin-top:4px\">${esc((p.models || []).map((m) => (typeof m === 'string' ? m : (m.id || m.model || ''))).join(' · ').slice(0, 220))}</div>
    </div>`).join('') + '</div>';
}

/* ---------- 电脑存储(书源托管 / 电子书 / 搜索执行) ---------- */
async function renderStorage(box) {
  const st = await backendCall(_devId, 'storage.get').catch(() => null);
  const srcs = await backendCall(_devId, 'sources.list').catch(() => null);
  const dir = (st && st.dir) || '';
  const books = (st && st.books) || [];
  const sources = (srcs && srcs.sources) || [];
  box.innerHTML = '<div class="section-title">存储位置</div>' +
    '<div class="row gap8"><input class="input" data-f="dir" value="' + esc(dir) + '" placeholder="如 D:\\Books 或 ~/ThirdHub"><button class="btn btn-primary btn-sm" data-a="setdir">设置</button></div>' +
    '<div class="muted" style="font-size:12px;margin-top:6px">电子书 / 漫画 / 音频文件将保存到这个目录（电脑本地）。</div>' +
    '<div class="section-title" style="margin-top:18px">电脑上的书源（' + sources.length + '）</div>' +
    '<div class="col gap6">' +
      (sources.length ? sources.map((s) => '<div class="list-item" style="width:100%"><div class="grow" style="min-width:0"><div style="font-size:13px;font-weight:600" class="ellipsis">' + esc(s.name || s.id) + '</div><div class="muted" style="font-size:11px">' + esc(s.type || '') + (s.searchUrl ? ' · 支持后端搜索' : '') + '</div></div><span class="list-arrow" data-delsrc="' + esc(s.id) + '" style="color:var(--danger)">×</span></div>').join('') : '<div class="muted" style="font-size:12px">还没有书源。可在「我的 → 连接器管理」导入后同步到电脑。</div>') +
    '</div>' +
    '<div class="section-title" style="margin-top:18px">电脑上的电子书（' + books.length + '）</div>' +
    '<div class="col gap6">' +
      (books.length ? books.map((b) => '<div class="list-item" style="width:100%"><div class="grow" style="min-width:0"><div style="font-size:13px;font-weight:600" class="ellipsis">' + esc(b.name) + esc(b.ext) + '</div><div class="muted" style="font-size:11px">' + fmtSize(b.size) + ' · ' + new Date(b.ts).toLocaleString() + '</div></div><span class="list-arrow" data-delbook="' + esc(b.id) + '" style="color:var(--danger)">×</span></div>').join('') : '<div class="muted" style="font-size:12px">还没有存储的文件。</div>') +
    '</div>' +
    '<div class="section-title" style="margin-top:18px">后端搜索测试</div>' +
    '<div class="row gap8"><input class="input" data-f="kw" placeholder="输入关键词，用电脑执行书源搜索"><button class="btn btn-primary btn-sm" data-a="gosearch">电脑搜索</button></div>' +
    '<div data-v="sr"></div>';
  $('[data-a=setdir]', box).onclick = async () => { const dir2 = $('[data-f=dir]', box).value.trim(); if (!dir2) return toast('请输入目录', 'err'); const r = await backendCall(_devId, 'storage.setDir', { dir: dir2 }); toast(r.ok ? '存储目录已设置：' + r.dir : (r.error || '失败'), r.ok ? 'ok' : 'err'); };
  $$('[data-delsrc]', box).forEach((b) => b.onclick = async () => { const r = await backendCall(_devId, 'sources.delete', { id: b.dataset.delsrc }); toast(r.ok ? '已删除' : (r.error || '失败'), r.ok ? 'ok' : 'err'); renderStorage(box); });
  $$('[data-delbook]', box).forEach((b) => b.onclick = async () => { const r = await backendCall(_devId, 'storage.delete', { id: b.dataset.delbook }); toast(r.ok ? '已删除' : (r.error || '失败'), r.ok ? 'ok' : 'err'); renderStorage(box); });
  $('[data-a=gosearch]', box).onclick = async () => {
    const kw = $('[data-f=kw]', box).value.trim();
    if (!kw) return toast('请输入关键词', 'err');
    const box2 = $('[data-v=sr]', box);
    box2.innerHTML = '<div class="muted" style="font-size:12px;margin-top:8px">电脑执行中…（需要书源带有 searchUrl 字段）</div>';
    const out = [];
    for (const s of sources) {
      if (!s.searchUrl) continue;
      const r = await backendCall(_devId, 'search', { kw, type: s.type || 'novel', sourceId: s.id });
      if (r.ok) out.push.apply(out, (r.items || []).map((it) => Object.assign({}, it, { from: s.name || s.id })));
    }
    box2.innerHTML = out.length ? out.slice(0, 30).map((it) => '<div style="padding:6px 8px;border-bottom:1px solid var(--line);font-size:12.5px">' + esc(it.title) + ' <span class="muted">· ' + esc(it.author || '') + ' · ' + esc(it.from) + '</span></div>').join('') : '<div class="muted" style="font-size:12px;margin-top:8px">没有结果（或书源不支持后端执行）</div>';
  };
}
function fmtSize(n) { if (n == null) return '-'; if (n > 1048576) return (n / 1048576).toFixed(1) + 'MB'; if (n > 1024) return (n / 1024).toFixed(1) + 'KB'; return n + 'B'; }

/* ---------- 设置 ---------- */
async function renderSettings(box) {
  const s = await call('/api/settings.describe').catch(() => null);
  const ui = await call('/api/dsh-web-ui-settings/describe').catch(() => null);
  box.innerHTML = '<div class="section-title">DSH 设置（只读）</div>' +
    '<div class="card" style="padding:12px;font-size:12px;line-height:1.8;word-break:break-all">' + esc(JSON.stringify({ settings: s, ui }, null, 1)).replace(/\n/g, '<br>').slice(0, 6000) + '</div>' +
    '<div class="muted" style="font-size:12px;margin-top:10px">设置修改（settings.update）在后续版本开放；当前可在电脑 DSH Web 中修改。</div>';
}

/* ---------- 审批（v9.2：实时卡片 + 最近处理记录） ---------- */
function renderApprovals(box) {
  const m = window.__approvals; // 由 approvals.js 注入的状态快照
  const st = m ? m() : { pending: [], recent: [] };
  if (!m) {
    box.innerHTML = '<div class="empty"><div class="empty-title">审批联动未启动</div><div class="muted" style="font-size:12px;margin-top:6px">请确认前端已加载 approvals 模块（v9.2+）</div></div>';
    return;
  }
  const pendHtml = st.pending.length ? st.pending.map((p) => {
    const f = p.frame;
    if (f.type === 'question/requested') {
      return '<div class="card" style="padding:12px;margin-top:10px;border-left:3px solid #3b5bfd"><div class="row"><b>💬 电脑端提问</b><div class="spacer"></div><span class="tag">待回答</span></div><div class="muted" style="font-size:12px;margin-top:6px">' + esc((f.questions || []).map((q) => q.question).join('；')) + '</div></div>';
    }
    return '<div class="card" style="padding:12px;margin-top:10px;border-left:3px solid #ff9f43"><div class="row"><b>🔐 权限审批</b><div class="spacer"></div><span class="tag tag-orange">待审批</span></div><div class="muted" style="font-size:12px;margin-top:6px">工具：' + esc(f.toolName || '未知') + (f.reason ? '；' + esc(f.reason) : '') + '</div><div class="muted" style="font-size:11px;margin-top:4px">弹出悬浮卡片即可操作</div></div>';
  }).join('') : '<div class="empty" style="margin-top:20px"><div class="empty-title">暂无待处理审批</div><div class="muted" style="font-size:12px">电脑端有审批/提问时会实时弹出卡片</div></div>';
  const recHtml = st.recent.length ? '<div class="section-title" style="margin-top:18px">最近处理</div>' + st.recent.slice(0, 20).map((r) => {
    const f = r.frame || {};
    const label = f.type === 'question/requested' ? '提问' : (f.toolName || '审批');
    return '<div class="card" style="padding:10px;margin-top:8px"><div class="row"><span style="font-size:13px">' + esc(label) + '</span><div class="spacer"></div><span class="muted" style="font-size:12px">' + esc(r.outcome || '') + '</span></div></div>';
  }).join('') : '';
  box.innerHTML = '<div class="section-title">实时审批</div>' + pendHtml + recHtml +
    '<div class="muted" style="font-size:12px;margin-top:14px">审批事件经电脑 Agent 实时推送（DSH Web /api/events.mux）；允许一次=本次放行，拒绝=本次禁止。</div>';
}

export async function renderDshConsole(page, devId) {
  _devId = devId;
  shell(page);
  /* 审批徽标：待处理数实时显示在「审批」标签上 */
  if (!window.__aprBadgeOn) {
    window.__aprBadgeOn = true;
    onApprovalChange(refreshAprBadges);
  }
  refreshAprBadges();
}