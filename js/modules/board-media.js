/* ===== ThirdHub js/modules/board-media.js — 娱乐板块通用页（小说/漫画/音乐/有声/视频） =====
   每个板块独立渲染：搜索（限定本类型）+ 我的书架 + 本类连接器
   v3.7：新增 read 综合板块——小说/漫画/有声合并：同一书架，搜索时类型多选筛选 */
import { $, $$, esc, icon, toast, debounce } from '../ui.js';
import { db, on, kvGet, kvSet } from '../store.js';
import { listSources, searchAll, sourceType } from '../engine/source-service.js';
import { openDetail } from './detail.js';

const TYPE_NAMES = { novel: '小说', comic: '漫画', music: '音乐', audio: '有声', video: '视频' };
const READ_TYPES = ['novel', 'comic', 'audio'];

export async function renderMediaBoard(page, type) {
  const t = sourceType(type) || { id: type, name: type, icon: 'folder' };
  const isRead = type === 'read';
  /* v3.7：综合阅读板块覆盖的类型集合 */
  const TYPES = isRead ? READ_TYPES : [type];
  const NAME = isRead ? '阅读' : (TYPE_NAMES[type] || t.name);
  const typeName = (tid) => TYPE_NAMES[tid] || tid;
  const typeIcon = (tid) => (sourceType(tid) || {}).icon || 'folder';

  page.innerHTML = `
    <div class="page-head"><div class="page-title">${NAME}</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="search-open" title="搜索">${icon('search')}</button>
      ${isRead || type === 'novel' || type === 'comic' ? `<button class="icon-btn" data-a="modset" title="设置">${icon('settings')}</button>` : ''}
    </div>
    <div class="discover-search" data-role="searchbar" hidden>
      <div class="search-box">
        ${icon('search')}
        <input placeholder="搜索${NAME}…" data-role="kw">
        <button class="btn btn-primary btn-sm" data-a="go">搜索</button>
        <button class="btn btn-sm" data-a="search-close">取消</button>
      </div>
      ${isRead ? `<div class="nr-chip-row" style="padding:8px 14px 2px" data-role="typefilter"></div>` : ''}
      <div data-role="scope" hidden style="padding:8px 14px 0"></div>
    </div>
    <div data-role="srclist" hidden></div>
    <div data-role="results"></div>
    <div class="bm-subtabs" data-role="subtabs">
      <button class="bm-subtab" data-st="discover">发现</button>
      <button class="bm-subtab on" data-st="shelf">书架</button>
    </div>
    <div data-role="discover" hidden></div>
    <div data-role="home"></div>`;

  /* v3.2：默认书架视图，搜索收起在右上角放大镜后面 */
  const searchbar = $('[data-role="searchbar"]', page);
  const srclist = $('[data-role="srclist"]', page);
  $('[data-a="search-open"]', page).onclick = () => {
    searchbar.hidden = false;
    srclist.hidden = false;
    $('[data-role="kw"]', page).focus();
    page.scrollTop = 0;
  };
  $('[data-a="search-close"]', page).onclick = () => {
    searchScope = null; renderScope();
    searchbar.hidden = true;
    srclist.hidden = true;
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    homeEl.classList.toggle('hidden', curSub === 'discover'); /* v4.3：回到当前子页 */
    abortSearch();
    searchState = { kw: '', page: 1, results: [], loading: false, done: false, searching: false, ctrl: null, token: searchState.token || 0 };
  };

  /* v1.7 设置分级：阅读设置归入小说模块，漫画设置归入漫画模块；v3.7 综合板块二选一 */
  const modsetBtn = $('[data-a="modset"]', page);
  if (modsetBtn) modsetBtn.onclick = async () => {
    const ms = await import('./mod-settings.js');
    if (type === 'novel') return ms.showNovelSettings();
    if (type === 'comic') return ms.showComicSettings();
    const { actionSheet } = await import('../ui.js');
    const v = await actionSheet('设置', [
      { label: '小说阅读设置', value: 'novel', icon: 'book' },
      { label: '漫画阅读设置', value: 'comic', icon: 'comic' },
    ]);
    if (v === 'novel') ms.showNovelSettings();
    if (v === 'comic') ms.showComicSettings();
  };

  /* v3.7：搜索类型多选筛选（仅综合板块），默认全选，选择结果记忆 */
  let selTypes = new Set(TYPES);
  if (isRead) {
    try {
      const saved = await kvGet('read:types', null);
      if (Array.isArray(saved) && saved.length) selTypes = new Set(saved.filter((x) => READ_TYPES.includes(x)));
    } catch (e) {}
    const tf = $('[data-role="typefilter"]', page);
    const renderTf = () => {
      tf.innerHTML = READ_TYPES.map((tid) =>
        `<button class="ai-chip ${selTypes.has(tid) ? 'on' : ''}" data-tf="${tid}">${typeName(tid)}</button>`).join('');
      $$('[data-tf]', tf).forEach((b) => b.onclick = () => {
        const tid = b.dataset.tf;
        if (selTypes.has(tid)) { if (selTypes.size === 1) return toast('至少保留一个类型'); selTypes.delete(tid); }
        else selTypes.add(tid);
        kvSet('read:types', [...selTypes]);
        renderTf();
        renderHome(); /* v3.8：类型筛选同时过滤下方连接器列表 */
        const kw = $('[data-role="kw"]', page).value.trim();
        if (kw) doSearch(kw);
      });
    };
    renderTf();
  }

  const homeEl = $('[data-role="home"]', page);
  const resultsEl = $('[data-role="results"]', page);

  async function renderHome() {
    /* v3.8：综合板块里连接器列表跟随类型筛选（点「漫画」就只剩漫画源） */
    const sources = (await listSources()).filter((s) =>
      s.enabled && TYPES.includes(s.type) && (!isRead || selTypes.has(s.type)));
    const shelf = (await db.all('shelf')).filter((x) => TYPES.includes(x.type))
      .sort((a, b) => (b.top - a.top) || (b.addedAt - a.addedAt));
    let html = '';

    /* v3.5：平时只显示书架；连接器列表挪进搜索视图（点放大镜后显示在搜索框下方） */
    if (shelf.length) {
      html += `<div class="discover-section">
        <div class="result-grid">${shelf.map((it) => `
          <button class="content-card card-press" data-shelf="${esc(it.id)}">
            <div class="content-cover">${it.coverUrl ? `<img src="${esc(it.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(typeIcon(it.type))}</div>
            <div class="content-name ellipsis">${esc(it.title)}</div>
            <div class="content-sub ellipsis">${isRead ? `<span class="result-type" style="margin-right:4px">${esc(typeName(it.type))}</span>` : ''}${esc(it.sourceName || '')}</div>
          </button>`).join('')}
        </div>
      </div>`;
    }

    if (!html) {
      html = `<div class="empty" style="margin-top:44px">
        <div class="empty-ico">${icon(t.icon)}</div>
        <div class="empty-title">书架还是空的</div>
        <div class="muted" style="max-width:280px;line-height:1.8">点右上角放大镜搜索${NAME}，加入书架后就会出现在这里。<br>还没有连接器？到「我的 → 连接器管理」导入。</div>
      </div>`;
    }
    homeEl.innerHTML = html;

    /* 连接器列表渲染到搜索视图 + v4.3「发现」子页 */
    const srcHtml = sources.length ? `<div class="discover-section">
      <div class="section-head">${icon('plug')}<span>${NAME}连接器</span><span class="muted">${sources.length} 个</span></div>
      <div class="source-cards">${sources.map((s) => `
        <button class="source-card card card-press" data-src="${esc(s.id)}">
          <span class="list-ico">${icon(typeIcon(s.type))}</span>
          <span class="ellipsis" style="font-size:13px;font-weight:600">${esc(s.name)}</span>
          <span class="muted">${isRead ? esc(typeName(s.type)) + ' · ' : ''}v${esc(s.version || '1.0')}</span>
        </button>`).join('')}
      </div>
    </div>` : `<div class="muted" style="padding:10px 18px;font-size:12.5px">还没有${NAME}连接器，到「我的 → 连接器管理」导入后就能搜索了。</div>`;
    const srcBox = $('[data-role="srclist"]', page);
    const discoverBox = $('[data-role="discover"]', page);
    if (srcBox) srcBox.innerHTML = srcHtml;
    if (discoverBox) discoverBox.innerHTML = sources.length
      ? `<div class="muted" style="padding:12px 18px 0;font-size:12.5px;line-height:1.7">点连接器进入对应内容源${isRead ? '（漫画源可选择进入它的发现页浏览推荐）' : ''}。</div>` + srcHtml
      : `<div class="empty" style="margin-top:44px"><div class="empty-ico">${icon('compass')}</div><div class="empty-title">还没有连接器</div><div class="muted" style="max-width:280px;line-height:1.8">到「分类 → 源管理」或「官方仓库」导入连接器后，就能在这里浏览各源的内容。</div></div>`;
    [srcBox, discoverBox].filter(Boolean).forEach((boxEl) => {
      $$('[data-src]', boxEl).forEach((b) => b.onclick = async () => {
        /* v3.8：点连接器卡片 → 进入该源内部，搜索只走这一个源 */
        const s = sources.find((x) => x.id === b.dataset.src);
        if (!s) return;
        /* v4.0：图源自带发现页时，让用户选择进发现页还是源内搜索 */
        if (s.type === 'comic') {
          try {
            const { getExplore } = await import('../engine/content-service.js');
            const pages = await getExplore(s);
            if (pages.length) {
              const { actionSheet } = await import('../ui.js');
              const v = await actionSheet(s.name, [
                { label: '发现页（浏览图源推荐内容）', value: 'explore', icon: 'compass' },
                { label: '源内搜索', value: 'search', icon: 'search' },
              ]);
              if (v === 'explore') {
                const { openExplore } = await import('./explore.js');
                openExplore(s);
                return;
              }
              if (v !== 'search') return;
            }
          } catch (e) {}
        }
        setSearchScope(s);
        $('[data-role="kw"]', page).focus();
      });
    });

    $$('[data-shelf]', homeEl).forEach((b) => b.onclick = async () => {
      const it = shelf.find((x) => x.id === b.dataset.shelf);
      if (it) openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: it });
    });
  }
  /* v4.3：发现 / 书架 子页签（默认书架） */
  const subHome = homeEl, subDiscover = $('[data-role="discover"]', page);
  let curSub = 'shelf';
  $$('.bm-subtab', page).forEach((b) => b.onclick = () => {
    curSub = b.dataset.st;
    $$('.bm-subtab', page).forEach((x) => x.classList.toggle('on', x === b));
    const showDiscover = curSub === 'discover';
    subDiscover.hidden = !showDiscover;
    subHome.classList.toggle('hidden', showDiscover);
  });

  await renderHome();
  on('sources:changed', renderHome);

  /* v3.8：单源搜索模式——点连接器卡片后，搜索只走该源 */
  let searchScope = null;
  function renderScope() {
    const box = $('[data-role="scope"]', page);
    if (!box) return;
    if (!searchScope) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<span class="ai-chip on" style="display:inline-flex;align-items:center;gap:6px">
      ${icon(typeIcon(searchScope.type))} 仅搜索「${esc(searchScope.name)}」
      <span data-a="scope-clear" style="cursor:pointer;opacity:.7;padding-left:2px">✕</span>
    </span>`;
    $('[data-a="scope-clear"]', box).onclick = (e) => { e.stopPropagation(); setSearchScope(null); };
  }
  function setSearchScope(s) {
    searchScope = s;
    renderScope();
    if (s) toast(`已进入「${s.name}」，搜索只走这个源`);
    const kw = $('[data-role="kw"]', page).value.trim();
    if (kw) doSearch(kw);
  }

  /* v2.8：搜索分页 —— 书源首页通常只有一二十条，点「加载更多」取下一页
     v4.1：流式搜索——每个源一返回就立刻上屏（搜一本蹦一本），不等全部源；
     点击某本书时中止后台搜索，把带宽优先让给这本书的详情加载 */
  let searchState = { kw: '', page: 1, results: [], loading: false, done: false, searching: false, ctrl: null, token: 0 };

  function abortSearch() {
    if (searchState.ctrl) { try { searchState.ctrl.abort(); } catch (e) {} searchState.ctrl = null; }
    searchState.searching = false;
  }

  function renderResults() {
    const { kw, results, searching } = searchState;
    resultsEl.innerHTML = `<div class="muted" style="padding:4px 18px 10px">找到 ${results.length} 条结果${searching ? '，<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:-2px"></span> 搜索中…' : ''}</div>
      <div class="discover-section"><div class="result-list">
        ${results.map((r, i) => `
          <button class="result-item card-press" data-i="${i}">
            <div class="result-cover">${r.coverUrl ? `<img src="${esc(r.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(typeIcon(r.type || TYPES[0]))}</div>
            <div class="result-info">
              <div class="result-name ellipsis">${esc(r.name || '未命名')}</div>
              <div class="result-sub ellipsis">${esc([r.author, r.kind].filter(Boolean).join(' · ') || r.sourceName || '')}</div>
              ${r.intro ? `<div class="result-intro">${esc(r.intro)}</div>` : ''}
              <div class="result-tags"><span class="result-src">${esc(r.sourceName || '')}</span>${r.type ? `<span class="result-type">${esc(typeName(r.type))}</span>` : ''}</div>
            </div>
          </button>`).join('')}
      </div></div>
      ${searchState.done || searchState.searching ? '' : '<div style="padding:6px 18px 26px"><button class="btn grow" data-a="more">加载更多</button></div>'}`;
    $$('.result-item', resultsEl).forEach((b) => {
      b.onclick = () => {
        const r = searchState.results[+b.dataset.i];
        abortSearch(); /* 优先这本书：停掉后台搜索，详情全速加载 */
        openDetail({ sourceId: r.sourceId, bookUrl: r.bookUrl, seed: r });
      };
    });
    const moreBtn = $('[data-a="more"]', resultsEl);
    if (moreBtn) moreBtn.onclick = () => doSearch(searchState.kw, searchState.page + 1);
  }

  async function doSearch(kw, page = 1) {
    if (searchState.loading) return;
    abortSearch();
    const token = ++searchState.token;
    searchState.loading = true;
    srclist.hidden = true;
    homeEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
    if (page === 1) {
      searchState = { kw, page: 1, results: [], loading: true, done: false, searching: true, ctrl: null, token };
      resultsEl.innerHTML = '<div class="loading-row"><div class="spinner"></div>' +
        (searchScope ? `正在搜索「${esc(searchScope.name)}」…` : `正在并发搜索所有${NAME}连接器…`) + '</div>';
    } else {
      const moreBtn = $('[data-a="more"]', resultsEl);
      if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = '加载中…'; }
    }
    const seen = new Set(searchState.results.map((r) => r.sourceId + '|' + r.bookUrl));
    const ctrl = new AbortController();
    searchState.ctrl = ctrl;
    /* 流式：源每返回一批就立刻合并去重上屏 */
    const onProgress = (s, items, err) => {
      if (token !== searchState.token) return; /* 新一轮搜索已开始，丢弃旧结果 */
      if (err || !items || !items.length) return;
      const fresh = items.filter((r) => !seen.has(r.sourceId + '|' + r.bookUrl));
      if (!fresh.length) return;
      fresh.forEach((r) => seen.add(r.sourceId + '|' + r.bookUrl));
      searchState.results = searchState.results.concat(fresh);
      renderResults();
    };
    try {
      await searchAll(kw, { types: isRead ? [...selTypes] : TYPES, page, only: searchScope ? searchScope.id : null, onProgress, signal: ctrl.signal });
    } catch (e) {}
    if (token !== searchState.token) return;
    searchState.page = page;
    searchState.loading = false;
    searchState.searching = false;
    searchState.ctrl = null;
    if (!searchState.results.length) {
      searchState.done = true;
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
