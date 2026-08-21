/* ===== ThirdHub js/modules/board-media.js — 娱乐板块通用页（小说/漫画/音乐/有声/视频） =====
   每个板块独立渲染：搜索（限定本类型）+ 我的书架 + 本类连接器
   v3.7：新增 read 综合板块——小说/漫画/有声合并：同一书架，搜索时类型多选筛选 */
import { $, $$, esc, icon, toast, debounce, fmtDate } from '../ui.js';
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
  /* v5.7：进入板块即恢复云端对应类型连接器（按需安装） */
  try { const { restorePendingSources } = await import('../engine/source-sync.js'); await restorePendingSources(TYPES); } catch (e) {}
  const NAME = isRead ? '阅读' : (TYPE_NAMES[type] || t.name);
  /* v4.6：第二页签按内容类型命名——阅读类叫书架，视频叫片单，音乐叫歌单 */
  const SHELF_NAMES = { read: '书架', novel: '书架', comic: '书架', audio: '书架', video: '片单', music: '歌单' };
  const SHELF_NAME = SHELF_NAMES[type] || '书架';
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
    <div data-role="home">
      <div class="bm-subtabs" data-role="subtabs">
        <button class="bm-subtab" data-st="discover">发现</button>
        <button class="bm-subtab on" data-st="shelf">${SHELF_NAME}</button>
        <button class="bm-subtab" data-st="history">历史</button>
        <button class="bm-subtab" data-st="fav">收藏</button>
      </div>
      <div data-role="sub-body"></div>
    </div>`;

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
    homeEl.classList.remove('hidden');
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
  const subBody = $('[data-role="sub-body"]', page);
  const resultsEl = $('[data-role="results"]', page);
  let curSub = 'shelf';      /* v4.5：发现/书架/历史/收藏 四子页签，默认书架 */
  let discSrc = 'all';       /* 发现页当前选中的连接器 */

  /* 点连接器卡片：漫画源有发现页时让用户选，否则直接进源内搜索 */
  async function enterSource(s, preferExplore) {
    if (!s) return;
    if (s.type === 'comic' && !preferExplore) {
      try {
        const { getExplore } = await import('../engine/content-service.js');
        const pages = await getExplore(s);
        if (pages.length) {
          const { actionSheet } = await import('../ui.js');
          const v = await actionSheet(s.name, [
            { label: '发现页（浏览图源推荐内容）', value: 'explore', icon: 'compass' },
            { label: '源内搜索', value: 'search', icon: 'search' },
          ]);
          if (v === 'explore') preferExplore = true;
          else if (v !== 'search') return;
        }
      } catch (e) {}
    }
    if (preferExplore) {
      const { openExplore } = await import('./explore.js');
      openExplore(s);
      return;
    }
    setSearchScope(s);
    $('[data-a="search-open"]', page).click();
    $('[data-role="kw"]', page).focus();
  }

  function bindCards(scope, items) {
    $$('[data-shelf]', scope).forEach((b) => b.onclick = () => {
      const it = items.find((x) => x.id === b.dataset.shelf);
      if (it) openDetail({ sourceId: it.sourceId, bookUrl: it.bookUrl, seed: it });
    });
  }

  /* 发现页：按连接器细分切换，选中某个源就加载它的推荐内容 */
  async function renderDiscover(sources) {
    if (!sources.length) {
      subBody.innerHTML = `<div class="empty" style="margin-top:44px"><div class="empty-ico">${icon('compass')}</div><div class="empty-title">还没有连接器</div><div class="muted" style="max-width:280px;line-height:1.8">到「分类 → 源管理」或「官方仓库」导入连接器后，就能在这里浏览各源的内容。</div></div>`;
      return;
    }
    if (discSrc !== 'all' && !sources.some((s) => s.id === discSrc)) discSrc = 'all';
    subBody.innerHTML = `
      <div class="nr-chip-row" style="padding:6px 16px 10px" data-role="disc-chips">
        <button class="ai-chip ${discSrc === 'all' ? 'on' : ''}" data-ds="all">全部</button>
        ${sources.map((s) => `<button class="ai-chip ${discSrc === s.id ? 'on' : ''}" data-ds="${esc(s.id)}">${esc(s.name)}</button>`).join('')}
      </div>
      <div data-role="disc-body"></div>`;
    $$('[data-ds]', subBody).forEach((c) => c.onclick = () => { discSrc = c.dataset.ds; renderDiscover(sources); });
    const box = $('[data-role="disc-body"]', subBody);

    if (discSrc === 'all') {
      box.innerHTML = `<div class="discover-section">
        <div class="section-head">${icon('plug')}<span>${NAME}连接器</span><span class="muted">${sources.length} 个</span></div>
        <div class="source-cards">${sources.map((s) => `
          <button class="source-card card card-press" data-src="${esc(s.id)}">
            <span class="list-ico">${icon(typeIcon(s.type))}</span>
            <span class="ellipsis" style="font-size:13px;font-weight:600">${esc(s.name)}</span>
            <span class="muted">${isRead ? esc(typeName(s.type)) + ' · ' : ''}v${esc(s.version || '1.0')}</span>
          </button>`).join('')}
        </div>
        <div class="muted" style="padding:8px 18px 0;font-size:12.5px;line-height:1.7">点上方连接器名字可只看该源的推荐内容；点卡片进入该源。</div>
      </div>`;
      $$('[data-src]', box).forEach((b) => b.onclick = () => enterSource(sources.find((x) => x.id === b.dataset.src)));
      return;
    }

    /* 单源视图：优先加载图源的发现页内容，没有则提示进源内搜索 */
    const s = sources.find((x) => x.id === discSrc);
    box.innerHTML = '<div class="loading-row" style="margin-top:40px"><div class="spinner"></div></div>';
    try {
      const { getExplore, getExplorePage } = await import('../engine/content-service.js');
      const pages = await getExplore(s);
      if (!pages.length) throw new Error('no-explore');
      const r = await getExplorePage(s, 0, null);
      const cells = [];
      (r.parts || []).forEach((p) => (p.comics || []).forEach((c) => cells.push(c)));
      if (r.comics) cells.push(...r.comics);
      const seen = new Set();
      const uniq = cells.filter((c) => c && c.bookUrl && !seen.has(c.bookUrl) && seen.add(c.bookUrl)).slice(0, 60);
      box.innerHTML = `
        <div class="muted" style="padding:4px 18px 8px;font-size:12.5px">来自「${esc(s.name)}」的推荐${pages.length > 1 ? ' · 更多分区点右上角进入完整发现页' : ''}</div>
        <div class="result-grid" style="padding:0 16px">${uniq.map((c) => `
          <button class="content-card card-press" data-b="${esc(c.bookUrl)}">
            <div class="content-cover">${c.coverUrl ? `<img src="${esc(c.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(typeIcon(s.type))}</div>
            <div class="content-name ellipsis">${esc(c.name || '未命名')}</div>
            <div class="content-sub ellipsis">${esc(c.author || s.name)}</div>
          </button>`).join('')}</div>
        <div style="padding:14px 16px"><button class="btn grow" data-a="disc-more">进入「${esc(s.name)}」完整发现页</button></div>`;
      $$('[data-b]', box).forEach((b) => b.onclick = () => openDetail({ sourceId: s.id, bookUrl: b.dataset.b, seed: {} }));
      $('[data-a="disc-more"]', box).onclick = () => enterSource(s, true);
    } catch (e) {
      box.innerHTML = `<div class="empty" style="margin-top:36px">
        <div class="empty-ico">${icon(typeIcon(s.type))}</div>
        <div class="empty-title">「${esc(s.name)}」没有提供推荐页</div>
        <div class="muted" style="line-height:1.8">这个源只支持搜索，点下方按钮进入源内搜索</div>
        <div style="margin-top:14px"><button class="btn btn-primary" data-a="disc-search">搜索「${esc(s.name)}」的内容</button></div>
      </div>`;
      $('[data-a="disc-search"]', box).onclick = () => enterSource(s, false);
    }
  }

  async function renderHome() {
    /* v3.8：综合板块里连接器列表跟随类型筛选（点「漫画」就只剩漫画源） */
    const sources = (await listSources()).filter((s) =>
      s.enabled && TYPES.includes(s.type) && (!isRead || selTypes.has(s.type)));

    /* 连接器列表渲染到搜索视图（点放大镜后显示在搜索框下方） */
    const srcBox = $('[data-role="srclist"]', page);
    if (srcBox) {
      srcBox.innerHTML = sources.length ? `<div class="discover-section">
        <div class="section-head">${icon('plug')}<span>${NAME}连接器</span><span class="muted">${sources.length} 个</span></div>
        <div class="source-cards">${sources.map((s) => `
          <button class="source-card card card-press" data-src="${esc(s.id)}">
            <span class="list-ico">${icon(typeIcon(s.type))}</span>
            <span class="ellipsis" style="font-size:13px;font-weight:600">${esc(s.name)}</span>
            <span class="muted">${isRead ? esc(typeName(s.type)) + ' · ' : ''}v${esc(s.version || '1.0')}</span>
          </button>`).join('')}
        </div>
      </div>` : `<div class="muted" style="padding:10px 18px;font-size:12.5px">还没有${NAME}连接器，到「我的 → 连接器管理」导入后就能搜索了。</div>`;
      $$('[data-src]', srcBox).forEach((b) => b.onclick = () => enterSource(sources.find((x) => x.id === b.dataset.src)));
    }

    /* v4.5：四个子页签各有真实内容 */
    if (curSub === 'discover') { await renderDiscover(sources); return; }

    if (curSub === 'history' || curSub === 'fav') {
      const storeName = curSub === 'history' ? 'history' : 'favorites';
      const items = (await db.all(storeName)).filter((x) => TYPES.includes(x.type))
        .sort((a, b) => (b.lastAt || b.addedAt || 0) - (a.lastAt || a.addedAt || 0));
      if (!items.length) {
        subBody.innerHTML = `<div class="empty" style="margin-top:44px"><div class="empty-ico">${icon(curSub === 'history' ? 'history' : 'heart')}</div><div class="empty-title">${curSub === 'history' ? '暂无阅读历史' : '暂无收藏'}</div></div>`;
        return;
      }
      subBody.innerHTML = `<div style="padding:4px 16px">` + items.map((it) => `
        <button class="shelf-item shelf-list-item card" data-shelf="${esc(it.id)}" style="margin-bottom:10px">
          <div class="shelf-cover sm">${it.coverUrl ? `<img src="${esc(it.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(typeIcon(it.type))}</div>
          <div class="grow" style="text-align:left;min-width:0">
            <div class="ellipsis" style="font-weight:700;font-size:14.5px">${esc(it.title)}</div>
            <div class="muted ellipsis">${isRead ? esc(typeName(it.type)) + ' · ' : ''}${esc(it.sourceName || '')} · ${fmtDate(it.lastAt || it.addedAt)}</div>
          </div>
          <span class="list-arrow">${icon('arrowR')}</span>
        </button>`).join('') + '</div>';
      bindCards(subBody, items);
      return;
    }

    /* 书架（默认） */
    const shelf = (await db.all('shelf')).filter((x) => TYPES.includes(x.type))
      .sort((a, b) => (b.top - a.top) || (b.addedAt - a.addedAt));
    if (shelf.length) {
      subBody.innerHTML = `<div class="discover-section">
        <div class="result-grid">${shelf.map((it) => `
          <button class="content-card card-press" data-shelf="${esc(it.id)}">
            <div class="content-cover">${it.coverUrl ? `<img src="${esc(it.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(typeIcon(it.type))}</div>
            <div class="content-name ellipsis">${esc(it.title)}</div>
            <div class="content-sub ellipsis">${isRead ? `<span class="result-type" style="margin-right:4px">${esc(typeName(it.type))}</span>` : ''}${esc(it.sourceName || '')}</div>
          </button>`).join('')}
        </div>
      </div>`;
      bindCards(subBody, shelf);
    } else {
      subBody.innerHTML = `<div class="empty" style="margin-top:44px">
        <div class="empty-ico">${icon(t.icon)}</div>
        <div class="empty-title">${SHELF_NAME}还是空的</div>
        <div class="muted" style="max-width:280px;line-height:1.8">点右上角放大镜搜索${NAME}，加入${SHELF_NAME}后就会出现在这里。<br>还没有连接器？到「发现」页或「分类 → 源管理」导入。</div>
      </div>`;
    }
  }
  $$('.bm-subtab', page).forEach((b) => b.onclick = () => {
    curSub = b.dataset.st;
    $$('.bm-subtab', page).forEach((x) => x.classList.toggle('on', x === b));
    renderHome();
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
