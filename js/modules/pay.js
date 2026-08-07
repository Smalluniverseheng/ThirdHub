/* ===== ThirdHub pay.js — 支付预接（支付宝 / 微信支付） =====
   v1.8 预接方案：用户下单 → 按管理员配置的收款码/账号转账（备注订单号）
   → 管理员后台确认收款 → 系统自动开通会员。
   数据结构与订单流已按官方网关标准设计（order_no / trade_no / pending→paid），
   后续接入支付宝/微信官方接口时只需替换 createOrder 与回调确认环节。 */
import { getSupabase, hasCloud } from '../supabase.js';
import { currentUser } from '../auth.js';
import { $, $$, el, esc, icon, modal, toast, fmtDate } from '../ui.js';

export async function getPayConfig() {
  if (!hasCloud()) return null;
  try {
    const { data, error } = await getSupabase().from('th_pay_config').select('value').eq('key', 'payment');
    if (error || !data || !data[0]) return null;
    return data[0].value;
  } catch (_) { return null; }
}

function genOrderNo() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return 'TH' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

/* 支付方式选择 → 创建订单 → 收款页 */
export async function showPayMethods(plan, cycle, onPaid) {
  const u = await currentUser();
  if (!u) { toast('请先登录'); return; }
  const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
  const cfg = await getPayConfig();
  const methods = [];
  if (cfg && cfg.alipay && cfg.alipay.enabled !== false) methods.push({ id: 'alipay', name: '支付宝' });
  if (cfg && cfg.wechat && cfg.wechat.enabled !== false) methods.push({ id: 'wechat', name: '微信支付' });
  if (!methods.length) methods.push({ id: 'alipay', name: '支付宝' }, { id: 'wechat', name: '微信支付' });

  const body = el(`<div>
    <div class="card" style="margin-bottom:12px;text-align:center">
      <div class="muted">开通 ${esc(plan.name)} · ${cycle === 'monthly' ? '月付' : '年付'}</div>
      <div style="font-size:26px;font-weight:800;color:var(--primary)">¥${Number(price).toFixed(2)}</div>
    </div>
    <div class="muted" style="margin-bottom:8px">选择支付方式</div>
    ${methods.map((m) => `
      <button class="list-item" style="width:100%;margin-bottom:8px" data-m="${m.id}">
        <span class="list-ico">${m.id === 'alipay' ? '💙' : '💚'}</span>
        <div class="grow" style="text-align:left;font-weight:600">${m.name}</div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`).join('')}
    <p class="muted" style="margin-top:6px">支付成功后会员自动开通（管理员确认收款后生效，一般 24 小时内）。</p>
  </div>`);
  const m = modal({
    title: '收银台', body,
    footer: '<button class="btn btn-block" data-a="c">取消</button>',
  });
  $('[data-a="c"]', m.mask).onclick = m.close;
  $$('[data-m]', body).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const order = await createOrder(plan, cycle, b.dataset.m, price);
    b.disabled = false;
    if (!order) { toast('下单失败，请检查网络或登录状态', 'err'); return; }
    m.close();
    showPayPage(order, cfg, onPaid);
  });
}

async function createOrder(plan, cycle, method, amount) {
  const u = await currentUser();
  if (!u || !hasCloud()) return null;
  const orderNo = genOrderNo();
  try {
    const { error } = await getSupabase().from('th_orders').insert({
      user_id: u.id,
      order_no: orderNo,
      plan: plan.level || plan.id,
      plan_name: plan.name,
      period: cycle,
      amount,
      pay_method: method,
      status: 'pending',
    });
    if (error) { console.warn('createOrder', error); return null; }
    return { order_no: orderNo, plan_name: plan.name, period: cycle, amount, pay_method: method, status: 'pending' };
  } catch (e) { console.warn('createOrder', e); return null; }
}

/* 收款页：展示收款码 + 订单号 */
export function showPayPage(order, cfg, onPaid) {
  const mc = cfg && cfg[order.pay_method] || {};
  const methodName = order.pay_method === 'alipay' ? '支付宝' : '微信支付';
  const body = el(`<div>
    <div class="card" style="margin-bottom:12px;text-align:center">
      <div class="muted">请使用${methodName}转账</div>
      <div style="font-size:26px;font-weight:800;color:var(--primary)">¥${Number(order.amount).toFixed(2)}</div>
    </div>
    ${mc.qr ? `<div style="text-align:center;margin-bottom:12px"><img src="${esc(mc.qr)}" style="max-width:220px;width:70%;border-radius:12px;border:1px solid var(--border)" alt="收款码"></div>` : ''}
    ${mc.account ? `<div class="card" style="margin-bottom:12px">
      <div class="muted">收款账号</div>
      <div class="row gap8" style="align-items:center">
        <b style="flex:1;font-size:15px;word-break:break-all">${esc(mc.account)}</b>
        <button class="btn btn-sm" data-a="copy-acc">复制</button>
      </div>
    </div>` : ''}
    <div class="card" style="margin-bottom:12px">
      <div class="muted">订单号（转账时请备注）</div>
      <div class="row gap8" style="align-items:center">
        <b style="flex:1;font-family:monospace;font-size:14px;word-break:break-all">${esc(order.order_no)}</b>
        <button class="btn btn-sm" data-a="copy-no">复制</button>
      </div>
    </div>
    ${mc.note ? `<p class="muted" style="margin-bottom:8px">📌 ${esc(mc.note)}</p>` : ''}
    ${cfg && cfg.tip ? `<p class="muted" style="margin-bottom:8px">${esc(cfg.tip)}</p>` : ''}
    <div data-v="st" class="muted" style="text-align:center;margin-top:6px">订单状态：待支付</div>
  </div>`);
  const m = modal({
    title: methodName + '支付', body,
    footer: '<button class="btn grow" data-a="c">稍后支付</button><button class="btn btn-primary grow" data-a="done">我已完成支付</button>',
  });
  const copy = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); btn.textContent = '已复制'; setTimeout(() => (btn.textContent = '复制'), 1500); }
    catch (_) { toast('复制失败，请长按选择复制'); }
  };
  const accBtn = $('[data-a="copy-acc"]', body);
  if (accBtn) accBtn.onclick = () => copy(mc.account || '', accBtn);
  $('[data-a="copy-no"]', body).onclick = () => copy(order.order_no, $('[data-a="copy-no"]', body));
  $('[data-a="c"]', m.mask).onclick = m.close;
  $('[data-a="done"]', m.mask).onclick = async () => {
    const st = await refreshOrderStatus(order.order_no);
    if (st === 'paid') {
      toast('支付已确认，会员已开通', 'ok');
      m.close();
      onPaid && onPaid();
    } else {
      $('[data-v="st"]', body).innerHTML = '订单状态：<b style="color:#fbbf24">等待管理员确认收款</b>（确认后自动开通，可在会员中心查看）';
      toast('已记录，确认收款后自动开通', 'ok');
    }
  };
}

export async function refreshOrderStatus(orderNo) {
  if (!hasCloud()) return 'pending';
  try {
    const { data } = await getSupabase().from('th_orders').select('status').eq('order_no', orderNo);
    return data && data[0] ? data[0].status : 'pending';
  } catch (_) { return 'pending'; }
}

/* 我的订单 */
export async function showMyOrders() {
  const u = await currentUser();
  if (!u) { toast('请先登录'); return; }
  const { openOverlay } = await import('../ui.js');
  openOverlay({
    title: '我的订单',
    build: async (body) => {
      body.innerHTML = '<p class="muted">加载中…</p>';
      let orders = [];
      try {
        const { data } = await getSupabase().from('th_orders').select('*').eq('user_id', u.id).order('created_at', { ascending: false });
        orders = data || [];
      } catch (_) {}
      if (!orders.length) { body.innerHTML = '<div class="empty"><div class="empty-title">还没有订单</div></div>'; return; }
      const sName = { pending: '待确认', paid: '已开通', cancelled: '已取消' };
      const sColor = { pending: '#fbbf24', paid: '#34d399', cancelled: '#9aa3b2' };
      const mName = { alipay: '支付宝', wechat: '微信' };
      body.innerHTML = orders.map((o) => `
        <div class="card" style="margin-bottom:10px">
          <div class="row gap8" style="align-items:center">
            <b style="flex:1;font-size:14px">${esc(o.plan_name || o.plan)} · ${o.period === 'yearly' ? '年付' : '月付'}</b>
            <span class="tag" style="background:${sColor[o.status]}22;color:${sColor[o.status]}">${sName[o.status] || o.status}</span>
          </div>
          <div class="muted" style="margin-top:4px">¥${Number(o.amount || 0).toFixed(2)} · ${mName[o.pay_method] || o.pay_method || '-'} · ${fmtDate(new Date(o.created_at).getTime(), true)}</div>
          <div class="muted ellipsis" style="margin-top:2px;font-family:monospace;font-size:11px">${esc(o.order_no)}</div>
        </div>`).join('');
    },
  });
}
