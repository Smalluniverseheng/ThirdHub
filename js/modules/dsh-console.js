/* ===== ThirdHub js/modules/dsh-console.js — DSH 工作台（v6.9）：通过 Agent 转发 DSH Web API ===== */
import { $, $$, el, esc, icon, toast } from '../ui.js';
import { listDevices, getStatus, dshCall, dshGet, backendCall } from './compute.js';

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

function tabName(t) { return { overview: '总览', presets: '模式预设', tasks: '任务看板', sessions: '会话轨迹', plugins: '插件', models: '模型', settings: '设置', storage: '电脑存储' }[t] || t; }

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
      ${['overview', 'presets', 'tasks', 'sessions', 'plugins', 'models', 'settings'].map((t) => `<button class=\"btn btn-sm${_curTab === t ? ' btn-primary' : ''}\" data-tab=\"${t}\">${tabName(t)}</button>`).join('')}
    </div>
    <div data-role=\"content\" style=\"padding:0 16px 40px\"></div>
  `;
  $('[data-a=\"back\"]', page).onclick = async () => { const m = await import('./compute.js'); m.renderCompute(page); };
  $('[data-a=\"refresh\"]', page).onclick = () => render();
  $$('[data-tab]', page).forEach((b) => b.onclick = () => { _curTab = b.dataset.tab; render(); });
  function render() { renderTab($('[data-role=\"content\"]', page)); }
  render();
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
    const lines = [];
    for (const e of events || []) {
      const ev = e.event || e;
      const t = ev.type || '';
      const d = ev.data || {};
      if (t === 'turn/start') lines.push('<div class="muted" style="font-size:12px;margin:10px 0 4px">—— 第 ' + (d.turn || '?') + ' 轮 ——</div>');
      else if (t === 'user/message') { const c = (d.content || [])[0]; lines.push('<div style="padding:8px 10px;background:var(--bg-card);border-radius:10px;margin:4px 0">👤 ' + esc((c && (c.text || c.content)) || '[内容]') + '</div>'); }
      else if (t === 'assistant/chunk') { const c = d.chunk || {}; if (c.type === 'text-delta' && c.text) { const last = lines[lines.length - 1] || ''; if (last.startsWith('🤖')) lines[lines.length - 1] = last + esc(c.text); else lines.push('🤖 ' + esc(c.text)); } }
      else if (t === 'tool/call') { const nm = d.tool || d.name || 'tool'; lines.push('<div class="muted" style="font-size:12px;padding:4px 8px">🔧 调用工具：' + esc(String(nm)) + '</div>'); }
      else if (t === 'tool/result' || t === 'tool/end') { const nm = d.tool || d.name || 'tool'; lines.push('<div class="muted" style="font-size:12px;padding:4px 8px">✅ 工具完成：' + esc(String(nm)) + '</div>'); }
    }
    box.innerHTML = '<div class="row"><button class="btn btn-sm" data-a="back2">← 返回会话列表</button></div>' +
      '<div class="section-title" style="margin-top:10px">轨迹：' + esc(sid) + '</div>' +
      (lines.length ? lines.join('') : '<div class="empty"><div class="empty-title">无轨迹内容</div></div>');
    $('[data-a=back2]', box).onclick = () => renderSessions(box);
  } catch (e) { box.innerHTML = '<div class="empty"><div class="empty-title">轨迹加载失败</div><div class="muted">' + esc(e.message) + '</div></div>'; }
}

/* ---------- 插件 ---------- */
async function renderPlugins(box) {
  const inv = await call('/api/dynamicCordisRunner/inventory');
  const plugins = (inv && inv.plugins) || (inv && inv.items) || [];
  if (!plugins.length) { box.innerHTML = '<div class="empty"><div class="empty-title">插件清单为空</div><div class="muted" style="font-size:12px">' + esc(JSON.stringify(inv).slice(0, 200)) + '</div></div>'; return; }
  box.innerHTML = '<div class="section-title">已加载插件（' + plugins.length + '）</div><div class="col gap6">' +
    plugins.map((p) => `<div class=\"list-item\" style=\"width:100%\">
      <div class=\"grow\" style=\"min-width:0\">
        <div style=\"font-size:13px;font-weight:600\" class=\"ellipsis\">${esc(p.name || p.id || '')} <span class=\"muted\" style=\"font-size:11px\">${esc(p.version || '')}</span></div>
        <div class=\"muted\" style=\"font-size:11px\" class=\"ellipsis\">${esc(p.description || p.id || '')}</div>
      </div>
      <span class=\"tag ${p.enabled === false ? 'tag-gray' : 'tag-green'}\">${p.enabled === false ? '已停用' : '启用'}</span>
    </div>`).join('') + '</div>';
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

/* ---------- 设置 ---------- */
async function renderSettings(box) {
  const s = await call('/api/settings.describe').catch(() => null);
  const ui = await call('/api/dsh-web-ui-settings/describe').catch(() => null);
  box.innerHTML = '<div class="section-title">DSH 设置（只读）</div>' +
    '<div class="card" style="padding:12px;font-size:12px;line-height:1.8;word-break:break-all">' + esc(JSON.stringify({ settings: s, ui }, null, 1)).replace(/\n/g, '<br>').slice(0, 6000) + '</div>' +
    '<div class="muted" style="font-size:12px;margin-top:10px">设置修改（settings.update）在后续版本开放；当前可在电脑 DSH Web 中修改。</div>';
}

export async function renderDshConsole(page, devId) {
  _devId = devId;
  shell(page);
}