/* ===== ThirdHub js/modules/approvals.js — 审批联动（v9.2）=====
   订阅 Agent 转发的 DSH Web 审批/提问事件（approval_event），
   全局悬浮卡片实时通知 + 手机远程批准/拒绝。
   协议：DSH Web mux SSE → Agent → WS approval_event → 本模块 → dshApprove(compute.js) */
import { el, esc, icon, toast } from '../ui.js';
import { onAgentMessage, dshApprove } from './compute.js';

const pending = new Map();   // rpcId -> {rpcId, frame, deviceId, ts}
const recent = [];           // 最近已处理 {frame, outcome, ts}（最多 30 条）
const listeners = new Set(); // 状态变化监听（DSH 工作台审批页刷新用）
let host = null;             // 悬浮卡片容器
let watcherOn = false;

function notify() { listeners.forEach((cb) => { try { cb(); } catch (e) {} }); }

export function getApprovalState() {
  return { pending: [...pending.values()], recent: [...recent] };
}
export function onApprovalChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

function vibe() { try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) {} }

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = el('<div id="approval-stack" style="position:fixed;left:10px;right:10px;bottom:86px;z-index:6000;display:flex;flex-direction:column;gap:10px;pointer-events:none"></div>');
  document.body.appendChild(host);
  return host;
}

function renderStack() {
  const h = ensureHost();
  const items = [...pending.values()].sort((a, b) => a.ts - b.ts);
  if (!items.length) { h.innerHTML = ''; return; }
  h.innerHTML = items.map((p) => {
    const f = p.frame;
    return f.type === 'question/requested' ? questionCard(p) : approvalCard(p);
  }).join('');
  wireActions(h);
}

function approvalCard(p) {
  const f = p.frame;
  const reason = esc(f.reason || '');
  const html = '<div class="card" style="padding:12px;border-left:3px solid #ff9f43;background:var(--card,#1c1f26);box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:auto">' +
    '<div class="row"><b style="font-size:13.5px">🔐 电脑端请求权限</b><div class="spacer"></div><span class="tag" style="background:rgba(255,159,67,.15);color:#ffb26b;border:none">待审批</span></div>' +
    '<div class="muted" style="font-size:12px;margin:6px 0;line-height:1.7;word-break:break-all">工具：<b>' + esc(f.toolName || '未知') + '</b>' + (reason ? '<br>说明：' + reason : '') + '</div>' +
    '<div class="row gap6" style="margin-top:8px">' +
    '<button class="btn btn-sm btn-primary" style="flex:1" data-apr="approve">✅ 允许一次</button>' +
    '<button class="btn btn-sm" style="flex:1;background:rgba(255,107,107,.12);color:#ff6b6b" data-apr="reject">⛔ 拒绝</button>' +
    '</div></div>';
  return html;
}

function questionCard(p) {
  const f = p.frame;
  const qs = (f.questions || []).map((q, qi) => {
    const opts = (q.options || []).map((o) =>
      '<button class="btn btn-sm" style="flex:1;text-align:left;justify-content:flex-start" data-qopt="' + qi + '" data-label="' + esc(o.label) + '">' + esc(o.label) + '</button>').join('');
    return '<div style="margin-top:10px">' +
      '<b style="font-size:13px">' + esc(q.question || '') + '</b>' + (q.header ? '<div class="muted" style="font-size:11px;margin-top:2px">' + esc(q.header) + '</div>' : '') +
      (opts ? '<div class="row gap6" style="flex-wrap:wrap;margin-top:6px" data-qgroup="' + qi + '" data-multi="' + (q.multiSelect ? '1' : '0') + '">' + opts + '</div>' : '') +
      '<input class="input" data-qcustom="' + qi + '" placeholder="或输入自定义回答…" style="margin-top:6px;font-size:12px">' +
      '</div>';
  }).join('');
  return '<div class="card" style="padding:12px;border-left:3px solid #3b5bfd;background:var(--card,#1c1f26);box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:auto">' +
    '<div class="row"><b style="font-size:13.5px">💬 电脑端提问</b><div class="spacer"></div><span class="tag" style="background:rgba(59,91,253,.15);color:#8fa3ff;border:none">待回答</span></div>' +
    '<div style="max-height:44vh;overflow:auto">' + qs + '</div>' +
    '<div class="row gap6" style="margin-top:10px">' +
    '<button class="btn btn-sm btn-primary" style="flex:1" data-apr="answer">📨 提交回答</button>' +
    '<button class="btn btn-sm" style="flex:1;background:rgba(255,107,107,.12);color:#ff6b6b" data-apr="cancel">取消提问</button>' +
    '</div></div>';
}

function resolveCard(p, outcomeText, type) {
  pending.delete(p.rpcId);
  recent.unshift({ frame: p.frame, outcome: outcomeText, ts: Date.now() });
  if (recent.length > 30) recent.pop();
  notify();
  renderStack();
  toast(type === 'ok' ? '已处理：' + outcomeText : outcomeText, type);
}

function wireActions(h) {
  const items = () => [...pending.values()].sort((a, b) => a.ts - b.ts);
  h.querySelectorAll('[data-apr]').forEach((b) => {
    b.onclick = async () => {
      const cardEl = b.closest('.card');
      const idx = [...h.children].indexOf(cardEl);
      const p = items()[idx];
      if (!p) return;
      const action = b.dataset.apr;
      b.disabled = true;
      try {
        const f = p.frame;
        if (action === 'approve' || action === 'reject') {
          const r = await dshApprove(p.deviceId, { action, rpcId: p.rpcId, sessionId: f.sessionId || '', approvalId: f.approvalId || '' });
          if (r && r.accepted) resolveCard(p, action === 'approve' ? '已允许一次' : '已拒绝', 'ok');
          else { b.disabled = false; toast('审批未受理：' + ((r && r.reason) || '未知原因'), 'err'); }
        } else if (action === 'answer') {
          const answers = [];
          h.querySelectorAll('[data-qgroup]').forEach((g) => {
            const qi = g.dataset.qgroup;
            const labels = [...g.querySelectorAll('[data-qopt].on')].map((x) => x.dataset.label);
            const input = h.querySelector('[data-qcustom="' + qi + '"]');
            const custom = (input && input.value || '').trim();
            const qid = (f.questions && f.questions[qi] && f.questions[qi].id) || '';
            const ans = { id: String(qid), selected: labels };
            if (custom) ans.custom = custom;
            answers.push(ans);
          });
          const r = await dshApprove(p.deviceId, { action: 'answer', rpcId: p.rpcId, sessionId: f.sessionId || '', answers });
          if (r && r.accepted) resolveCard(p, '已回答', 'ok');
          else { b.disabled = false; toast('回答未受理：' + ((r && r.reason) || '未知原因'), 'err'); }
        } else if (action === 'cancel') {
          const r = await dshApprove(p.deviceId, { action: 'cancel', rpcId: p.rpcId, sessionId: f.sessionId || '' });
          if (r && r.accepted) resolveCard(p, '已取消提问', 'ok');
          else { b.disabled = false; toast('取消失败：' + ((r && r.reason) || '未知原因'), 'err'); }
        }
      } catch (e) {
        b.disabled = false;
        toast('操作失败：' + (e.message || String(e)), 'err');
      }
    };
  });
  /* 选项点击切换（单选/多选） */
  h.querySelectorAll('[data-qopt]').forEach((o) => {
    o.onclick = () => {
      const g = o.closest('[data-qgroup]');
      const multi = g.dataset.multi === '1';
      if (multi) { o.classList.toggle('on'); o.classList.toggle('btn-primary', o.classList.contains('on')); }
      else {
        g.querySelectorAll('[data-qopt]').forEach((x) => { x.classList.remove('on', 'btn-primary'); });
        o.classList.add('on', 'btn-primary');
      }
    };
  });
}

function handleEvent(msg, deviceId) {
  if (msg.type !== 'approval_event') return;
  const f = (msg.payload && msg.payload.frame) || {};
  const rpcId = String((msg.payload && msg.payload.rpcId) || '');
  if (f.type === 'approval/requested' || f.type === 'question/requested') {
    pending.set(rpcId, { rpcId, frame: f, deviceId, ts: Date.now() });
    notify(); renderStack();
    vibe();
    toast(f.type === 'approval/requested' ? '🔐 电脑端请求权限：' + (f.toolName || '工具') : '💬 电脑端发来提问', 'info');
  } else if (f.type === 'approval/resolved') {
    pending.delete(rpcId);
    const text = ({ 'allowed-once': '已允许一次', rejected: '已拒绝', cancelled: '已取消', unavailable: '已失效' })[f.outcome] || f.outcome;
    recent.unshift({ frame: f, outcome: text, ts: Date.now() });
    if (recent.length > 30) recent.pop();
    notify(); renderStack();
    if (f.outcome === 'rejected') toast('审批已被拒绝', 'err');
  } else if (f.type === 'question/resolved') {
    pending.delete(rpcId);
    recent.unshift({ frame: f, outcome: f.outcome === 'answered' ? '已回答' : '已取消', ts: Date.now() });
    if (recent.length > 30) recent.pop();
    notify(); renderStack();
  }
}

export function initApprovalWatcher() {
  if (watcherOn) return;
  watcherOn = true;
  onAgentMessage(handleEvent);
  console.log('[approvals] 审批联动监听已启动');
}
