/* ===== ThirdHub js/modules/recycle-bin.js — 回收站（v1.7） =====
   删除的会话先进入回收站：默认 15 天自动彻底清除（可选 7 / 15 / 30 天）
   支持恢复、提前彻底清除、清空回收站；启动时自动执行到期清理 */
import { $, $$, el, esc, icon, toast, openOverlay, confirmDialog, fmtDate } from '../ui.js';
import { db, kvGet, kvSet } from '../store.js';

const DAY = 86400000;

export async function recycleDays() { return await kvGet('recycle:days', 15); }
export async function setRecycleDays(d) { await kvSet('recycle:days', d); }

/* 把会话移入回收站（软删除） */
export async function trashChat(s) {
  s.deletedAt = Date.now();
  await db.put('chats', JSON.parse(JSON.stringify(s)));
}

/* 回收站列表（按删除时间倒序） */
export async function listRecycle() {
  const all = await db.all('chats');
  return all.filter((c) => c.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function restoreChat(id) {
  const all = await db.all('chats');
  const s = all.find((c) => c.id === id);
  if (!s) return;
  delete s.deletedAt;
  await db.put('chats', s);
}

export async function deleteForever(id) { await db.del('chats', id); }

/* 到期自动清理（启动时与打开回收站时调用） */
export async function purgeRecycle() {
  const days = await recycleDays();
  const limit = Date.now() - days * DAY;
  const items = await listRecycle();
  let n = 0;
  for (const c of items) {
    if (c.deletedAt < limit) { await db.del('chats', c.id); n++; }
  }
  return n;
}

/* 剩余天数 */
export function daysLeft(c, days) {
  return Math.max(0, Math.ceil(days - (Date.now() - c.deletedAt) / DAY));
}

/* ================= 回收站页面 ================= */
export async function showRecycleBin() {
  await purgeRecycle();
  openOverlay({
    title: '回收站',
    build: async (body) => {
      const days = await recycleDays();
      body.innerHTML = `
        <div class="set-wrap">
          <div class="muted" style="line-height:1.7;margin-bottom:12px">删除的会话会在这里保留一段时间，到期后自动彻底清除。彻底删除后无法恢复。</div>
          <div class="muted mb8">自动清除时间</div>
          <div class="nr-chip-row mb16" id="rb-days">
            ${[7, 15, 30].map((d) => `<button class="ai-chip ${d === days ? 'on' : ''}" data-d="${d}">${d} 天</button>`).join('')}
          </div>
          <div class="row gap8 mb16">
            <button class="btn btn-sm btn-danger grow" id="rb-empty" disabled>清空回收站</button>
          </div>
          <div class="col gap8" id="rb-list"></div>
        </div>`;

      $$('#rb-days .ai-chip', body).forEach((b) => b.onclick = async () => {
        await setRecycleDays(+b.dataset.d);
        $$('#rb-days .ai-chip', body).forEach((x) => x.classList.toggle('on', x === b));
        toast(`已设置为 ${b.dataset.d} 天后自动清除`, 'ok');
        renderList();
      });

      const listBox = $('#rb-list', body);
      const emptyBtn = $('#rb-empty', body);

      async function renderList() {
        const d = await recycleDays();
        const items = await listRecycle();
        emptyBtn.disabled = !items.length;
        if (!items.length) {
          listBox.innerHTML = `<div class="ai-drawer-empty" style="padding:40px 0">回收站是空的</div>`;
          return;
        }
        listBox.innerHTML = '';
        items.forEach((c) => {
          const left = daysLeft(c, d);
          const item = el(`<div class="list-item">
            <span class="list-ico">${icon('history')}</span>
            <div class="grow" style="min-width:0">
              <div style="font-size:14px;font-weight:600" class="ellipsis">${esc(c.title || '未命名会话')}</div>
              <div class="muted">删除于 ${fmtDate(c.deletedAt, true)} · ${left > 0 ? `${left} 天后自动清除` : '即将清除'}</div>
            </div>
            <button class="btn btn-sm" data-a="restore">恢复</button>
            <button class="btn btn-sm btn-danger" data-a="del">彻底删除</button>
          </div>`);
          $('[data-a="restore"]', item).onclick = async () => {
            await restoreChat(c.id);
            toast('已恢复到历史会话', 'ok');
            renderList();
          };
          $('[data-a="del"]', item).onclick = async () => {
            if (!(await confirmDialog('彻底删除该会话？', '删除后无法恢复', '彻底删除', true))) return;
            await deleteForever(c.id);
            toast('已彻底删除', 'ok');
            renderList();
          };
          listBox.appendChild(item);
        });
      }

      emptyBtn.onclick = async () => {
        if (!(await confirmDialog('清空回收站？', '回收站内的所有会话将被彻底删除，无法恢复', '清空', true))) return;
        const items = await listRecycle();
        for (const c of items) await deleteForever(c.id);
        toast('回收站已清空', 'ok');
        renderList();
      };

      renderList();
    },
  });
}
