/* ===== ThirdHub js/modules/applock.js — 应用锁（v1.7） =====
   两种解锁方式：6 位数字密码 / 九宫格图案
   开启后每次进入应用需先解锁；本机存储哈希，不上传云端 */
import { $, $$, el, esc, icon, toast, openOverlay, confirmDialog } from '../ui.js';
import { kvGet, kvSet, kvDel } from '../store.js';

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('th-lock:' + s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function lockConfig() {
  return { type: await kvGet('applock:type', null), hash: await kvGet('applock:hash', '') };
}

export async function verifyLock(secret) {
  const c = await lockConfig();
  if (!c.type) return true;
  return (await hash(secret)) === c.hash;
}

/* ================= 解锁界面（启动门禁） ================= */
export async function gateIfLocked() {
  const c = await lockConfig();
  if (!c.type) return;
  await new Promise((resolve) => {
    const mask = el(`<div class="applock-mask">
      <div class="applock-box">
        <div class="applock-logo">${icon('lock')}</div>
        <div style="font-size:17px;font-weight:800;margin-bottom:4px">ThirdHub 已锁定</div>
        <div class="muted mb16">${c.type === 'pin' ? '请输入 6 位数字密码' : '请绘制解锁图案'}</div>
        <div id="lk-body"></div>
      </div>
    </div>`);
    document.body.appendChild(mask);
    const done = () => { mask.remove(); resolve(); };
    const fail = () => toast('密码不正确，请重试', 'err');
    if (c.type === 'pin') buildPinPad($('#lk-body', mask), async (pin) => { if (await verifyLock(pin)) done(); else fail(); });
    else buildPatternPad($('#lk-body', mask), async (seq) => { if (await verifyLock(seq)) done(); else fail(); });
  });
}

/* 6 位数字键盘 */
function buildPinPad(box, onDone) {
  let pin = '';
  box.innerHTML = `
    <div class="lk-dots" id="lk-dots">${'<span class="lk-dot"></span>'.repeat(6)}</div>
    <div class="lk-pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => k === '' ? '<span></span>' : `<button class="lk-key" data-k="${k}">${k}</button>`).join('')}
    </div>`;
  const dots = $$('.lk-dot', box);
  const render = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
  $$('.lk-key', box).forEach((b) => b.onclick = () => {
    const k = b.dataset.k;
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += k;
    render();
    if (pin.length === 6) { const v = pin; pin = ''; setTimeout(render, 200); onDone(v); }
  });
}

/* 九宫格图案板（触屏 + 鼠标通用） */
function buildPatternPad(box, onDone, min = 4) {
  box.innerHTML = `<div class="lk-pattern" id="lk-pat">
    ${Array.from({ length: 9 }, (_, i) => `<span class="lk-pdot" data-i="${i}"><i></i></span>`).join('')}
    <svg class="lk-lines" viewBox="0 0 240 240"><polyline id="lk-line" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round"/></svg>
  </div>
  <div class="muted" style="text-align:center;margin-top:10px;font-size:12px">至少连接 ${min} 个点</div>`;
  const pad = $('#lk-pat', box);
  const line = $('#lk-line', box);
  const seq = [];
  let drawing = false;
  const center = (i) => {
    const d = $(`.lk-pdot[data-i="${i}"]`, pad);
    const r = d.getBoundingClientRect(), pr = pad.getBoundingClientRect();
    return [(r.left + r.width / 2 - pr.left) * 240 / pr.width, (r.top + r.height / 2 - pr.top) * 240 / pr.height];
  };
  const redraw = () => line.setAttribute('points', seq.map((i) => center(i).join(',')).join(' '));
  const hit = (x, y) => {
    const els = document.elementsFromPoint(x, y);
    const d = els.find((e2) => e2.classList && e2.classList.contains('lk-pdot'));
    return d ? +d.dataset.i : null;
  };
  const add = (i) => {
    if (i == null || seq.includes(i)) return;
    seq.push(i);
    $(`.lk-pdot[data-i="${i}"]`, pad).classList.add('on');
    redraw();
  };
  const pos = (e) => (e.touches && e.touches[0]) ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];
  const start = (e) => { drawing = true; seq.length = 0; $$('.lk-pdot', pad).forEach((d) => d.classList.remove('on')); redraw(); add(hit(...pos(e))); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; add(hit(...pos(e))); e.preventDefault(); };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (seq.length >= min) onDone(seq.join('-'));
    else { setTimeout(() => { seq.length = 0; $$('.lk-pdot', pad).forEach((d) => d.classList.remove('on')); redraw(); }, 300); }
  };
  pad.addEventListener('touchstart', start, { passive: false });
  pad.addEventListener('touchmove', move, { passive: false });
  pad.addEventListener('touchend', end);
  pad.addEventListener('mousedown', start);
  pad.addEventListener('mousemove', move);
  pad.addEventListener('mouseup', end);
  pad.addEventListener('mouseleave', end);
}

/* ================= 设置页（安全 → 应用锁） ================= */
export async function showAppLockSettings() {
  const c = await lockConfig();
  openOverlay({
    title: '应用锁',
    build: async (body) => {
      body.innerHTML = `<div class="set-wrap">
        <div class="muted" style="line-height:1.7;margin-bottom:14px">开启应用锁后，每次进入 ThirdHub 都需要先验证密码。密码仅保存在本机。</div>
        <div class="col gap8" id="lk-list"></div>
      </div>`;
      const list = $('#lk-list', body);
      const row = (name, desc, active, onClick) => {
        const b = el(`<button class="search-svc ${active ? 'sel' : ''}" style="width:100%">
          <span class="search-svc-radio">${active ? icon('check') : ''}</span>
          <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">${name}</div><div class="muted">${desc}</div></div>
        </button>`);
        b.onclick = onClick;
        list.appendChild(b);
      };
      row('关闭应用锁', '进入应用无需验证', !c.type, async () => {
        if (!c.type) return;
        await promptVerify(c, async () => {
          await kvDel('applock:type'); await kvDel('applock:hash');
          toast('应用锁已关闭', 'ok');
          showAppLockSettingsRefresh(body);
        });
      });
      row('数字密码', '6 位数字 PIN', c.type === 'pin', () => setupLock('pin', c, body));
      row('图案密码', '九宫格图案（至少连接 4 个点）', c.type === 'pattern', () => setupLock('pattern', c, body));
    },
  });
}
function showAppLockSettingsRefresh(body) {
  /* 简单刷新：关闭重开 */
  const mask = body.closest('.overlay');
  if (mask) { mask.remove(); showAppLockSettings(); }
}

/* 已设置时先验证旧密码 */
async function promptVerify(c, onOk) {
  if (!c.type) return onOk();
  const m = el(`<div id="pv-body"></div>`);
  const { modal } = await import('../ui.js');
  const ref = modal({ title: '验证当前密码', body: m });
  const ok = async () => { ref.close(); await onOk(); };
  if (c.type === 'pin') buildPinPad(m, async (pin) => { if (await verifyLock(pin)) ok(); else toast('密码不正确', 'err'); });
  else buildPatternPad(m, async (seq) => { if (await verifyLock(seq)) ok(); else toast('图案不正确', 'err'); });
}

/* 设置新密码（输入两遍确认） */
async function setupLock(type, c, body) {
  const doSetup = () => {
    openOverlay({
      title: type === 'pin' ? '设置数字密码' : '设置图案密码',
      build: (b2) => {
        b2.innerHTML = `<div class="set-wrap" style="display:flex;flex-direction:column;align-items:center">
          <div class="muted mb16" id="lk-step">第 1 步：输入新${type === 'pin' ? '密码' : '图案'}</div>
          <div id="lk-setup"></div>
        </div>`;
        let first = null;
        const handler = async (v) => {
          if (first == null) {
            first = v;
            $('#lk-step', b2).textContent = '第 2 步：再次输入以确认';
          } else if (v === first) {
            await kvSet('applock:type', type);
            await kvSet('applock:hash', await hash(v));
            toast('应用锁已开启', 'ok');
            const mask = b2.closest('.overlay');
            if (mask) mask.remove();
          } else {
            first = null;
            $('#lk-step', b2).textContent = '两次输入不一致，请重新设置';
            toast('两次输入不一致', 'err');
          }
        };
        if (type === 'pin') buildPinPad($('#lk-setup', b2), handler);
        else buildPatternPad($('#lk-setup', b2), handler);
      },
    });
  };
  if (c.type) await promptVerify(c, doSetup);
  else doSetup();
}
