/* ===== ThirdHub js/modules/board-media.js — 娱乐板块通用页（小说/漫画/音乐/有声/视频） =====
   每个板块独立渲染：搜索（限定本类型）+ 我的书架 + 本类连接器 */
import { $, $$, esc, icon, toast, debounce } from '../ui.js';
import { db, on } from '../store.js';
import { listSources, searchAll, sourceType } from '../engine/source-service.js';
import { openDetail } from './detail.js';

export async function renderMediaBoard(page, type) {
  const t = sourceType(type) || { id: type, name: type, icon: 'folder' };
  const NAME = { novel: '小说', comic: '漫画', music: '音乐', audio: '有声', video: '视频' }[type] || t.name;

  page.innerHTML = `
    <div class="page-head"><div class="page-title">${NAME}</div>
      <div class="spacer"></div>
      ${type === 'novel' || type === 'comic' ? `<button class="icon-btn" data-a="modset" title="${type === 'novel' ? '阅读设置' : '漫画设置'}">${icon('settings')}</button>` : ''}
    </div>
    <div class="discover-search">
      <div class="search-box">
        ${icon('search')}
        <input placeholder="搜索${NAME}…" data-role="kw">
        <button class="btn btn-primary btn-sm" data-a="go">搜索</button>
      </div>
    </div>
    <div data-role="results"></div>
    <div data-role="home"></div>`;

  /* v1.7 设置分级：阅读设置归入小说模块，漫画设置归入漫画模块 */
  const modsetBtn = $('[data-a="modset"]', page);
  if (modsetBtn) modsetBtn.onclick = async () => {
    const ms = await import('./mod-settings.js');
    if (type === 'novel') ms.showNovelSettings();
    else ms.showComicSettings();
  };

  const homeEl = $('[data-role="home"]', page);
  const resultsEl = $('[data-role="results"]', page);

  async function renderHome() {
    const sources = (await listSources(type)).filter((s) => s.enabled);
    const shelf = (await db.all('shelf')).filter((x) => x.type === type)
      .sort((a, b) => (b.top - a.top) || (b.addedAt - a.addedAt));
    let html = '';

    if (shelf.length) {
      html += `<div class="discover-section">
        <div class="section-head">${icon('books')}<span>我的书架</span><span class="muted">${shelf.length}</span></div>
        <div class="result-grid">${shelf.map((it) => `
          <button class="content-card card-press" data-shelf="${esc(it.id)}">
            <div class="content-cover">${it.coverUrl ? `<img src="${esc(it.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(t.icon)}</div>
            <div class="content-name ellipsis">${esc(it.title)}</div>
            <div class="content-sub ellipsis">${esc(it.sourceName || '')}</div>
          </button>`).join('')}
        </div>
      </div>`;
    }

    if (sources.length) {
      html += `<div class="discover-section">
        <div class="section-head">${icon('plug')}<span>${NAME}连接器</span><span class="muted">${sources.length} 个</span></div>
        <div class="source-cards">${sources.map((s) => `
          <button class="source-card card card-press" data-src="${esc(s.id)}">
            <span class="list-ico">${icon(t.icon)}</span>
            <span class="ellipsis" style="font-size:13px;font-weight:600">${esc(s.name)}</span>
            <span class="muted">v${esc(s.version || '1.0')}</span>
          </button>`).join('')}
        </div>
      </div>`;
    }

    if (!html) {
      html = `<div class="empty" style="margin-top:44px">
        <div class="empty-ico">${icon(t.icon)}</div>
        <div class="empty-title">还没有${NAME}连接器</div>
        <div class="muted" style="max-width:280px;line-height:1.8">ThirdHub 不预置任何内容源。<br>请到「我的 → 连接器管理」导入你自己的连接器，导入后即可在这里搜索和浏览${NAME}。</div>
      </div>`;
    }
    homeEl.innerHTML = html;

    $$('[data-shelf]', homeEl).forEach((b) => b.onclick = async () => {
      const it = shelf.find((x) => x.id === b.dataset.shelf);
      if (it) openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: it });
    });
    $$('[data-src]', homeEl).forEach((b) => b.onclick = () => {
      $('[data-role="kw"]', page).focus();
      toast('输入关键词即可搜索该连接器');
    });
  }
  await renderHome();
  on('sources:changed', renderHome);

  /* v2.8：搜索分页 —— 书源首页通常只有一二十条，点「加载更多」取下一页 */
  let searchState = { kw: '', page: 1, results: [], loading: false, done: false };

  function renderResults() {
    const { kw, results } = searchState;
    resultsEl.innerHTML = `<div class="muted" style="padding:4px 18px 10px">找到 ${results.length} 条结果</div>
      <div class="discover-section"><div class="result-list">
        ${results.map((r, i) => `
          <button class="result-item card-press" data-i="${i}">
            <div class="result-cover">${r.coverUrl ? `<img src="${esc(r.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(t.icon)}</div>
            <div class="result-info">
              <div class="result-name ellipsis">${esc(r.name || '未命名')}</div>
              <div class="result-sub ellipsis">${esc([r.author, r.kind].filter(Boolean).join(' · ') || r.sourceName || '')}</div>
              ${r.intro ? `<div class="result-intro">${esc(r.intro)}</div>` : ''}
              <div class="result-tags"><span class="result-src">${esc(r.sourceName || '')}</span>${r.type ? `<span class="result-type">${esc(r.type === 'novel' ? '小说' : r.type === 'comic' ? '漫画' : r.type)}</span>` : ''}</div>
            </div>
          </button>`).join('')}
      </div></div>
      ${searchState.done ? '' : '<div style="padding:6px 18px 26px"><button class="btn grow" data-a="more">加载更多</button></div>'}`;
    $$('.result-item', resultsEl).forEach((b) => {
      b.onclick = () => {
        const r = searchState.results[+b.dataset.i];
        openDetail({ sourceId: r.sourceId, bookUrl: r.bookUrl, seed: r });
      };
    });
    const moreBtn = $('[data-a="more"]', resultsEl);
    if (moreBtn) moreBtn.onclick = () => doSearch(searchState.kw, searchState.page + 1);
  }

  async function doSearch(kw, page = 1) {
    if (searchState.loading) return;
    searchState.loading = true;
    homeEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
    if (page === 1) {
      searchState = { kw, page: 1, results: [], loading: true, done: false };
      resultsEl.innerHTML = '<div class="loading-row"><div class="spinner"></div>正在并发搜索所有' + NAME + '连接器…</div>';
    } else {
      const moreBtn = $('[data-a="more"]', resultsEl);
      if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '加载中…'; }
    }
    let batch = [];
    try {
      batch = await searchAll(kw, { types: [type], page });
    } catch (e) { batch = []; }
    /* 去重（同一书源同一本书分页重复返回时） */
    const seen = new Set(searchState.results.map((r) => r.sourceId + '|' + r.bookUrl));
    const fresh = batch.filter((r) => !seen.has(r.sourceId + '|' + r.bookUrl));
    searchState.results = searchState.results.concat(fresh);
    searchState.page = page;
    searchState.loading = false;
    searchState.done = fresh.length === 0;
    if (!searchState.results.length) {
      resultsEl.innerHTML = `<div class="empty"><div class="empty-ico">${icon('search')}</div><div class="empty-title">没有找到「${esc(kw)}」</div><div class="muted">试试其他关键词，或先导入更多${NAME}连接器</div></div>`;
      return;
    }
    renderResults();
  }

  const kwInput = $('[data-role="kw"]', page);
  $('[data-a="go"]', page).onclick = () => { const kw = kwInput.value.trim(); if (kw) doSearch(kw); };
  kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const kw = kwInput.value.trim(); if (kw) doSearch(kw); } });
  kwInput.addEventListener('input', debounce(() => {
    if (!kwInput.value.trim()) { resultsEl.classList.add('hidden'); homeEl.classList.remove('hidden'); }
  }, 300));
}
