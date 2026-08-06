/* ===== ThirdHub js/ui.js — Toast / Modal / 覆盖层 / 工具函数 ===== */
import { icon } from './icons.js';
export { icon } from './icons.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function fmtBytes(n) {
  if (!n || n <= 0) return '0 B';
  if (n === Infinity) return '无限';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n >= 100 ? 0 : 1) + ' ' + u[i];
}
export function fmtDate(ts, withTime = false) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------- Toast ---------- */
export function toast(msg, type = '') {
  const root = $('#toast-root');
  const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  root.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2200);
}

/* ---------- Modal ---------- */
export function modal({ title = '', body = '', footer = '', center = false, onClose = null }) {
  const root = $('#modal-root');
  const mask = el(`
    <div class="modal-mask ${center ? 'center' : ''}">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">${esc(title)}</div>
          <button class="modal-close">${icon('close')}</button>
        </div>
        <div class="modal-body"></div>
        ${footer ? `<div class="modal-foot"></div>` : ''}
      </div>
    </div>`);
  const bodyEl = $('.modal-body', mask);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  if (footer) {
    const f = $('.modal-foot', mask);
    if (typeof footer === 'string') f.innerHTML = footer; else f.appendChild(footer);
  }
  const close = () => { mask.remove(); onClose && onClose(); };
  $('.modal-close', mask).onclick = close;
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  root.appendChild(mask);
  return { mask, bodyEl, close };
}

export function confirmDialog(title, text, okText = '确定', danger = false) {
  return new Promise((resolve) => {
    const m = modal({
      title, center: true,
      body: `<p style="color:var(--text-secondary);font-size:14px;line-height:1.7">${esc(text)}</p>`,
      footer: `<button class="btn grow" data-a="no">取消</button><button class="btn grow ${danger ? 'btn-danger' : 'btn-primary'}" data-a="ok">${esc(okText)}</button>`,
      onClose: () => resolve(false),
    });
    $('[data-a="no"]', m.mask).onclick = () => { m.close(); };
    $('[data-a="ok"]', m.mask).onclick = () => { resolve(true); m.mask.remove(); };
  });
}

export function actionSheet(title, actions) {
  return new Promise((resolve) => {
    const wrap = el(`<div class="col gap8"></div>`);
    actions.forEach((a) => {
      const b = el(`<button class="btn btn-block ${a.danger ? 'btn-danger' : ''}" style="justify-content:flex-start;padding:14px 16px">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`);
      b.onclick = () => { resolve(a.value); m.mask.remove(); };
      wrap.appendChild(b);
    });
    const m = modal({ title, body: wrap, onClose: () => resolve(null) });
  });
}

/* ---------- 全屏覆盖层 ---------- */
export function openOverlay({ title = '', build, onClose = null, headExtra = '' }) {
  const root = $('#overlay-root');
  const ov = el(`
    <div class="overlay">
      <div class="overlay-head">
        <button class="icon-btn ov-back">${icon('back')}</button>
        <div class="overlay-title ellipsis">${esc(title)}</div>
        ${headExtra}
      </div>
      <div class="overlay-body"></div>
    </div>`);
  const body = $('.overlay-body', ov);
  const close = () => {
    ov.classList.add('closing');
    setTimeout(() => ov.remove(), 220);
    onClose && onClose();
  };
  $('.ov-back', ov).onclick = close;
  root.appendChild(ov);
  build && build(body, close);
  return { ov, body, close, setTitle: (t) => { $('.overlay-title', ov).textContent = t; } };
}

/* ---------- 表单行 ---------- */
export function formRow(label, inputHtml) {
  return `<div style="margin-bottom:14px">
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px">${esc(label)}</div>
    ${inputHtml}
  </div>`;
}
