/* ===== ThirdHub js/modules/bookshelf.js — 书架页（书架/历史/收藏/圈子） ===== */
import { $, $$, esc, icon, toast, actionSheet, confirmDialog, fmtDate } from '../ui.js';
import { db, kvGet, kvSet, on, emit } from '../store.js';
import { removeFromShelf, getProgress } from '../engine/content-service.js';
import { importLocalBook, deleteLocalBook } from '../engine/local-source.js';
import { pushRow } from '../engine/sync-service.js';
import { getSource } from '../engine/source-service.js';
import { openDetail } from './detail.js';

const TYPE_CHIPS = [
  { id: '', name: '全部' }, { id: 'novel', name: '小说' }, { id: 'comic', name: '漫画' },
  { id: 'video', name: '影视' }, { id: 'audio', name: '听书' }, { id: 'music', name: '音乐' },
];
const TABS = [
  { id: 'shelf', name: '书架', icon: 'books' },
  { id: 'history', name: '历史', icon: 'history' },
  { id: 'favorites', name: '收藏', icon: 'heart' },
  { id: 'circle', name: '圈子', icon: 'users' },
];

let activeTab = 'shelf';
let filterType = '';
let viewMode = 'grid';
let selectMode = false;
const selected = new Set();

export async function renderBookshelf(page) {
  viewMode = await kvGet('shelf:view', 'grid');
  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">书架</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="view" title="切换视图">${icon(viewMode === 'grid' ? 'list' : 'grid')}</button>
      <button class="icon-btn" data-a="more">${icon('more')}</button>
    </div>
    <div class="shelf-tabs">${TABS.map((t) => `<button class="shelf-tab ${t.id === activeTab ? 'on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('')}</div>
    <div class="chips" data-role="chips">${TYPE_CHIPS.map((c) => `<button class="chip ${c.id === filterType ? 'on' : ''}" data-t="${c.id}">${c.name}</button>`).join('')}</div>
    <div data-role="today"></div>
    <div data-role="content" style="padding:8px 16px"></div>
    <div class="shelf-edit-bar hidden" data-role="editbar">
      <button class="btn grow" data-a="sel-all">全选</button>
      <button class="btn grow" data-a="top">置顶</button>
      <button class="btn btn-danger grow" data-a="del">删除</button>
      <button class="btn grow" data-a="cancel">取消</button>
    </div>`;

  $$('.shelf-tab', page).forEach((b) => b.onclick = () => {
    activeTab = b.dataset.tab;
    $$('.shelf-tab', page).forEach((x) => x.classList.toggle('on', x === b));
    renderContent();
  });
  $$('.chip', page).forEach((c) => c.onclick = () => {
    filterType = c.dataset.t;
    $$('.chip', page).forEach((x) => x.classList.toggle('on', x === c));
    renderContent();
  });
  $('[data-a="view"]', page).onclick = async (e) => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    await kvSet('shelf:view', viewMode);
    e.currentTarget.innerHTML = icon(viewMode === 'grid' ? 'list' : 'grid');
    renderContent();
  };
  $('[data-a="more"]', page).onclick = async () => {
    const v = await actionSheet('书架管理', [
      { label: '导入本地书籍（TXT / EPUB）', value: 'import-local', icon: 'import' },
      { label: '多选编辑', value: 'select', icon: 'check' },
      { label: '清空历史记录', value: 'clear-history', icon: 'trash', danger: true },
    ]);
    if (v === 'import-local') importLocalFlow();
    if (v === 'select') enterSelectMode();
    if (v === 'clear-history') {
      if (await confirmDialog('清空历史', '确定清空所有历史记录吗？', '清空', true)) {
        await db.clear('history');
        renderContent();
        toast('已清空');
      }
    }
  };

  function importLocalFlow() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.epub,text/plain';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        toast('正在导入，请稍候…');
        const item = await importLocalBook(f);
        await db.put('shelf', item);
        pushRow('shelf', item);
        emit('shelf:changed');
        activeTab = 'shelf';
        toast('已导入《' + item.title + '》', 'ok');
      } catch (e) {
        toast('导入失败：' + e.message, 'err');
      }
    };
    input.click();
  }

  function enterSelectMode() {
    selectMode = true;
    selected.clear();
    $('[data-role="editbar"]', page).classList.remove('hidden');
    renderContent();
  }
  function exitSelectMode() {
    selectMode = false;
    selected.clear();
    $('[data-role="editbar"]', page).classList.add('hidden');
    renderContent();
  }
  $('[data-a="cancel"]', page).onclick = exitSelectMode;
  $('[data-a="sel-all"]', page).onclick = () => {
    $$('.shelf-item', page).forEach((item) => selected.add(item.dataset.id));
    renderContent();
  };
  $('[data-a="del"]', page).onclick = async () => {
    if (!selected.size) return toast('请先选择条目');
    if (!(await confirmDialog('删除', `确定删除 ${selected.size} 个条目吗？`, '删除', true))) return;
    const storeName = activeTab === 'history' ? 'history' : activeTab === 'favorites' ? 'favorites' : 'shelf';
    for (const id of selected) {
      await db.del(storeName, id);
      if (id.startsWith('local:')) deleteLocalBook(id.slice(6)).catch(() => {});
    }
    exitSelectMode();
    toast('已删除', 'ok');
  };
  $('[data-a="top"]', page).onclick = async () => {
    if (activeTab !== 'shelf' || !selected.size) return;
    for (const id of selected) {
      const row = await db.get('shelf', id);
      if (row) { row.top = !row.top; await db.put('shelf', row); }
    }
    exitSelectMode();
  };

  async function renderToday() {
    const box = $('[data-role="today"]', page);
    if (activeTab !== 'shelf') { box.innerHTML = ''; return; }
    const stats = await kvGet('stats:today', null);
    const today = new Date().toISOString().slice(0, 10);
    const s = stats && stats.date === today ? stats : { minutes: 0 };
    box.innerHTML = `
      <div class="today-card card" style="margin:10px 16px 4px">
        <span class="list-ico" style="background:rgba(59,91,253,.12);color:var(--primary)">${icon('headphone')}</span>
        <div class="grow"><div style="font-size:14px;font-weight:700">今日听读</div>
        <div class="muted">${s.minutes ? `今天已使用 ${s.minutes} 分钟` : '今天还没有阅读记录'}</div></div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </div>`;
  }

  async function renderContent() {
    renderToday();
    const box = $('[data-role="content"]', page);

    if (activeTab === 'circle') {
      box.innerHTML = `<div class="empty"><div class="empty-ico">${icon('users')}</div><div class="empty-title">圈子功能即将上线</div><div class="muted">与同好分享你的书单与片单</div></div>`;
      return;
    }

    const storeName = activeTab === 'history' ? 'history' : activeTab === 'favorites' ? 'favorites' : 'shelf';
    let items = await db.all(storeName);
    if (filterType) items = items.filter((x) => x.type === filterType);
    items.sort((a, b) => {
      if (storeName === 'shelf') return (b.top - a.top) || (b.addedAt - a.addedAt);
      return (b.lastAt || b.addedAt || 0) - (a.lastAt || a.addedAt || 0);
    });

    if (!items.length) {
      box.innerHTML = `<div class="empty">
        <div class="empty-ico">${icon(TABS.find((t) => t.id === activeTab).icon)}</div>
        <div class="empty-title">${activeTab === 'shelf' ? '书架空空如也' : activeTab === 'history' ? '暂无历史记录' : '暂无收藏'}</div>
        <div class="muted">${activeTab === 'shelf' ? '去「发现」页搜索收藏内容，或点右上角导入本地书籍' : ''}</div>
      </div>`;
      return;
    }

    if (viewMode === 'grid' && storeName === 'shelf') {
      /* v4.3：番茄小说风格宫格 —— 封面大卡 + 标题 + 阅读进度副标题 */
      const TYPE_TAG = { novel: '小说', comic: '漫画', video: '影视', audio: '听书', music: '音乐' };
      const progresses = await Promise.all(items.map((it) => getProgress(it.id).catch(() => null)));
      box.innerHTML = `<div class="shelf-grid">` + items.map((it, idx) => {
        const p = progresses[idx];
        let sub;
        if (p && (p.chapterIndex != null || p.chapterTitle)) {
          sub = '读至' + (p.chapterTitle ? `「${p.chapterTitle}」` : `第 ${(p.chapterIndex || 0) + 1} 章`);
        } else {
          sub = it.author || it.sourceName || '';
        }
        return `
        <button class="shelf-item shelf-grid-item ${selected.has(it.id) ? 'selected' : ''}" data-id="${esc(it.id)}">
          <div class="shelf-cover">${it.coverUrl ? `<img src="${esc(it.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon('book')}
            <span class="shelf-type-badge">${TYPE_TAG[it.type] || ''}</span>
            ${it.top ? '<span class="shelf-top-badge">顶</span>' : ''}${selectMode ? `<span class="sel-badge">${selected.has(it.id) ? '✓' : ''}</span>` : ''}</div>
          <div class="shelf-g-title">${esc(it.title)}</div>
          <div class="shelf-g-sub">${esc(sub)}</div>
        </button>`;
      }).join('') + '</div>';
    } else {
      box.innerHTML = items.map((it) => `
        <button class="shelf-item shelf-list-item card ${selected.has(it.id) ? 'selected' : ''}" data-id="${esc(it.id)}" style="margin-bottom:10px">
          <div class="shelf-cover sm">${it.coverUrl ? `<img src="${esc(it.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon('book')}</div>
          <div class="grow" style="text-align:left;min-width:0">
            <div class="ellipsis" style="font-weight:700;font-size:14.5px">${it.top ? '📌 ' : ''}${esc(it.title)}</div>
            <div class="muted ellipsis">${esc(it.sourceName || '')} · ${fmtDate(it.lastAt || it.addedAt)}</div>
          </div>
          ${selectMode ? `<span class="sel-badge inline">${selected.has(it.id) ? '✓' : ''}</span>` : `<span class="list-arrow">${icon('arrowR')}</span>`}
        </button>`).join('');
    }

    $$('.shelf-item', box).forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (selectMode) {
          selected.has(id) ? selected.delete(id) : selected.add(id);
          renderContent();
          return;
        }
        const it = items.find((x) => x.id === id);
        openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: { name: it.title, coverUrl: it.coverUrl, author: it.author } });
      };
      let pressTimer;
      b.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { if (!selectMode) enterSelectMode(); selected.add(b.dataset.id); renderContent(); }, 550); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(pressTimer));
      b.addEventListener('touchmove', () => clearTimeout(pressTimer));
      /* v5.3：桌面端右键菜单（多选 / 删除 / 置顶） */
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (selectMode) return;
        const id = b.dataset.id;
        const storeName = activeTab === 'history' ? 'history' : activeTab === 'favorites' ? 'favorites' : 'shelf';
        actionSheet('书架操作', [
          { label: '多选管理', value: 'select', icon: 'check' },
          { label: '删除此项', value: 'del', icon: 'trash' },
          ...(activeTab === 'shelf' ? [{ label: '置顶 / 取消置顶', value: 'top', icon: 'pin' }] : []),
        ]).then(async (v) => {
          if (v === 'select') { enterSelectMode(); selected.add(id); renderContent(); }
          else if (v === 'del') {
            if (!(await confirmDialog('删除', '确定删除这一项吗？', '删除', true))) return;
            await db.del(storeName, id);
            if (id.startsWith('local:')) deleteLocalBook(id.slice(6)).catch(() => {});
            renderContent(); toast('已删除', 'ok');
          }
          else if (v === 'top') {
            const row = await db.get('shelf', id);
            if (row) { row.top = !row.top; await db.put('shelf', row); renderContent(); }
          }
        });
      });
    });
  }

  await renderContent();
  on('shelf:changed', renderContent);
}
