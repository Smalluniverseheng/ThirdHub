/* ===== ThirdHub js/modules/search.js — 全局搜索（v4.8） =====
   独立板块：一键搜书架（本地 IndexedDB）、AI 历史会话、已导入资源源（Web Worker 并发）；
   最近搜索本地留存（最多 20 条），Ctrl+K 全局唤起。 */
import { $, $$, el, esc, icon, toast, openOverlay } from '../ui.js';
import { db, kvGet, kvSet, on } from '../store.js';
import { searchAll } from '../engine/source-service.js';
import { openDetail } from './detail.js';

const HISTORY_KEY = 'search:history';
const MAX_HISTORY = 20;

async function getHistory() {
  try { return (await kvGet(HISTORY_KEY, [])) || []; } catch (e) { return []; }
}
async function pushHistory(kw) {
  const k = String(kw || '').trim();
  if (!k) return;
  const list = (await getHistory()).filter((x) => x !== k);
  list.unshift(k);
  await kvSet(HISTORY_KEY, list.slice(0, MAX_HISTORY));
}

/* ---------- 三类数据源 ---------- */
async function searchShelf(kw) {
  const k = kw.toLowerCase();
  const all = await db.all('shelf');
  return all.filter((it) =>
    (it.title || '').toLowerCase().includes(k) ||
    (it.author || '').toLowerCase().includes(k) ||
    (it.sourceName || '').toLowerCase().includes(k));
}

async function searchChats(kw) {
  const k = kw.toLowerCase();
  const all = await db.all('chats');
  return all.filter((s) => !s.deletedAt && (
    (s.title || '').toLowerCase().includes(k) ||
    (s.messages || []).some((m) => typeof m.content === 'string' && m.content.toLowerCase().includes(k))
  ));
}

/* 资源源搜索：带整体超时，每个源一返回就通过 onItem 增量上屏 */
function searchSources(kw, onItem) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  const p = searchAll(kw, {
    onProgress: (s, arr) => onItem && onItem(s, arr),
    signal: ctl.signal,
  }).finally(() => clearTimeout(timer));
  return { promise: p, abort: () => ctl.abort() };
}

/* ---------- 渲染 ---------- */
export async function renderSearch(page) {
  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">搜索</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="hint" title="快捷键">${icon('key')}</button>
    </div>
    <div class="sch-wrap">
      <div class="sch-box">
        <span class="sch-ico">${icon('search')}</span>
        <input class="sch-input" data-role="kw" placeholder="搜索书架、AI 会话、全网资源…" autocomplete="off">
        <button class="sch-clear" data-role="clear" hidden>×</button>
      </div>
      <div class="sch-body" data-role="body"></div>
    </div>`;

  const input = $('[data-role="kw"]', page);
  const body = $('[data-role="body"]', page);
  const clearBtn = $('[data-role="clear"]', page);
  let timer = null;
  let running = null; // { aborter }

  /* 空态：最近搜索 */
  async function renderIdle() {
    const hist = await getHistory();
    body.innerHTML = `
      <div class="sch-empty">
        <div style="font-size:34px;margin-bottom:10px">🔍</div>
        搜索书架书籍、AI 历史会话与已导入源的资源<br>
        <span class="muted">桌面端按 Ctrl/Cmd + K 快速唤起</span>
      </div>
      ${hist.length ? `
        <div style="text-align:center">
          <span class="muted" style="font-size:12.5px">最近搜索</span>
          <button class="sch-clear-hist" data-a="clearhist">清除</button>
        </div>
        <div class="sch-history">
          ${hist.map((h) => `<button class="sch-h-chip" data-h="${esc(h)}">${esc(h)}</button>`).join('')}
        </div>` : ''}`;
    $$('[data-h]', body).forEach((b) => b.onclick = () => { input.value = b.dataset.h; runSearch(b.dataset.h); });
    const cl = $('[data-a="clearhist"]', body);
    if (cl) cl.onclick = async () => { await kvSet(HISTORY_KEY, []); renderIdle(); toast('已清除搜索历史'); };
  }

  function renderSections(shelf, chats, srcs) {
    const moreMap = {};
    const sec = (ico, title, items, renderRow, moreFn, tag) => {
      if (moreFn) moreMap[title] = moreFn;
      return `
      <div class="sch-sec" data-sec="${title}">
        <div class="sch-sec-head">${icon(ico)}<span>${title}</span><span class="muted" style="font-size:12px">${items.length}</span><span class="grow"></span>
        ${moreFn ? `<button class="sch-more" data-more="${title}">查看更多 ›</button>` : ''}
        </div>
        ${items.length ? items.slice(0, 5).map(renderRow).join('') : '<div class="muted" style="font-size:12.5px;padding:2px 2px 8px">无匹配</div>'}
      </div>`;
    };
    body.innerHTML = `
      ${shelf.length ? sec('books', '书架', shelf, shelfRow, () => moreOverlay('书架', shelf, shelfRow)) : ''}
      ${chats.length ? sec('robot', 'AI 历史会话', chats, chatRow, () => moreOverlay('AI 历史会话', chats, chatRow)) : ''}
      ${srcs.length ? sec('globe', '资源', srcs, srcRow, () => moreOverlay('资源', srcs, srcRow)) : ''}
      ${(!shelf.length && !chats.length && !srcs.length) ? '<div class="sch-empty">没有找到相关内容，换个关键词试试</div>' : ''}`;
    $$('[data-more]', body).forEach((b) => b.onclick = () => { const fn = moreMap[b.dataset.more]; fn && fn(); });
    bindRows(body);
  }

  function shelfRow(it) {
    return `<button class="sch-item" data-open="shelf" data-id="${esc(it.id)}">
      <span class="list-ico">${it.coverUrl ? `<img class="sch-thumb" src="${esc(it.coverUrl)}" onerror="this.remove()">` : icon('book')}</span>
      <span class="sch-item-main">
        <span class="sch-item-title">${esc(it.title)}</span>
        <span class="sch-item-sub">${esc(it.sourceName || '')} · ${esc(it.author || '')}</span>
      </span>
      <span class="sch-tag">${({ novel: '小说', comic: '漫画', video: '影视', audio: '有声', music: '音乐' })[it.type] || ''}</span>
    </button>`;
  }
  function chatRow(s) {
    const first = (s.messages || []).find((m) => typeof m.content === 'string' && m.content.trim());
    return `<button class="sch-item" data-open="chat" data-id="${esc(s.id)}">
      <span class="list-ico">${icon('robot')}</span>
      <span class="sch-item-main">
        <span class="sch-item-title">${esc(s.title || '未命名会话')}</span>
        <span class="sch-item-sub">${esc((first && first.content || '').slice(0, 40))}</span>
      </span>
      <span class="sch-tag">${(s.messages || []).length} 条</span>
    </button>`;
  }
  function srcRow(it) {
    return `<button class="sch-item" data-open="src" data-id="${esc(it.bookUrl)}" data-sid="${esc(it.sourceId)}">
      <span class="list-ico">${it.coverUrl ? `<img class="sch-thumb" src="${esc(it.coverUrl)}" onerror="this.remove()">` : icon('globe')}</span>
      <span class="sch-item-main">
        <span class="sch-item-title">${esc(it.name || it.title || '未命名')}</span>
        <span class="sch-item-sub">${esc(it.sourceName || '')} · ${esc(it.author || '')}</span>
      </span>
      <span class="sch-tag">${esc(it.type || '')}</span>
    </button>`;
  }

  function bindRows(scope) {
    $$('[data-open="shelf"]', scope).forEach((b) => b.onclick = async () => {
      const it = await db.get('shelf', b.dataset.id);
      if (it) openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: { name: it.title, coverUrl: it.coverUrl, author: it.author } });
    });
    $$('[data-open="chat"]', scope).forEach((b) => b.onclick = () => openChat(b.dataset.id));
    $$('[data-open="src"]', scope).forEach((b) => b.onclick = () => openDetail({ sourceId: b.dataset.sid, bookUrl: b.dataset.id, seed: {} }));
  }

  /* 查看更多：全量列表 overlay */
  function moreOverlay(title, items, rowFn) {
    openOverlay({
      title,
      build: (bodyEl) => {
        bodyEl.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
        const wrap = el(`<div style="padding:14px 16px 28px">${items.map(rowFn).join('') || '<div class="muted" style="text-align:center;padding:30px">暂无更多</div>'}</div>`);
        bodyEl.innerHTML = '';
        bodyEl.appendChild(wrap);
        bindRows(wrap);
      },
    });
  }

  /* 打开 AI 会话：切到 AI 板块并载入 */
  async function openChat(id) {
    const { switchTab } = await import('../app.js');
    await switchTab('ai');
    const pageEl = document.getElementById('page-ai');
    const mod = await import('./ai-chat.js');
    await mod.openChatById(id, pageEl);
  }

  async function runSearch(kw) {
    const k = String(kw || '').trim();
    if (!k) { renderIdle(); return; }
    if (running) { try { running.abort(); } catch (e) {} }
    clearBtn.hidden = false;
    body.innerHTML = '<div class="sch-spin-row"><div class="spinner"></div> 搜索中…</div>';
    const [shelf, chats] = await Promise.all([searchShelf(k), searchChats(k)]);
    let srcs = [];
    const srcCtl = searchSources(k, (s, arr) => {
      /* 每个源一返回就增量上屏（资源区随到随显） */
      srcs = srcs.concat(arr);
      renderSections(shelf, chats, srcs);
    });
    running = srcCtl;
    try {
      srcs = await srcCtl.promise;
      renderSections(shelf, chats, srcs);
      if (shelf.length || chats.length || srcs.length) pushHistory(k);
    } catch (e) {
      renderSections(shelf, chats, srcs);
    }
  }

  /* 事件绑定 */
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); runSearch(input.value); } });
  clearBtn.onclick = () => { input.value = ''; clearBtn.hidden = true; runSearch(''); input.focus(); };
  $('[data-a="hint"]', page).onclick = () => toast('桌面端按 Ctrl/Cmd + K 快速唤起全局搜索');
  on('search:focus', () => { setTimeout(() => { input.focus(); input.select(); }, 120); });

  renderIdle();
  setTimeout(() => { input.focus(); }, 150);
}
