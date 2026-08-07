/* ===== ThirdHub js/modules/discover.js — 发现页 ===== */
import { $, $$, esc, icon, toast, debounce } from '../ui.js';
import { listSources, searchAll, SOURCE_TYPES } from '../engine/source-service.js';
import { openDetail } from './detail.js';
import { on } from '../store.js';

export async function renderDiscover(page) {
  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">发现</div>
    </div>
    <div class="discover-search">
      <div class="search-box">
        ${icon('search')}
        <input placeholder="搜索书名、作者、影片、音频…" data-role="kw">
        <button class="btn btn-primary btn-sm" data-a="go">搜索</button>
      </div>
      <div class="chips" data-role="type-chips">
        <button class="chip on" data-t="">全部</button>
        ${SOURCE_TYPES.map((t) => `<button class="chip" data-t="${t.id}">${t.name}</button>`).join('')}
      </div>
    </div>
    <div data-role="results"></div>
    <div data-role="home"></div>`;

  const homeEl = $('[data-role="home"]', page);
  const resultsEl = $('[data-role="results"]', page);

  async function renderHome() {
    const sources = (await listSources()).filter((s) => s.enabled);
    if (!sources.length) {
      homeEl.innerHTML = `
        <div class="empty" style="margin-top:48px">
          <div class="empty-ico">${icon('compass')}</div>
          <div class="empty-title">还没有内容连接器</div>
          <div class="muted" style="max-width:280px;line-height:1.8">ThirdHub 不预置任何内容源。<br>请到「分类 → 源管理」导入你自己的连接器配置（.js / TVbox JSON），导入后即可在这里搜索和浏览内容。</div>
        </div>`;
      return;
    }
    const byType = {};
    sources.forEach((s) => { (byType[s.type] = byType[s.type] || []).push(s); });
    homeEl.innerHTML = Object.entries(byType).map(([type, list]) => {
      const t = SOURCE_TYPES.find((x) => x.id === type);
      return `
        <div class="discover-section">
          <div class="section-head">${icon(t ? t.icon : 'folder')}<span>${t ? t.name : type}</span><span class="muted">${list.length} 个连接器</span></div>
          <div class="source-cards">
            ${list.map((s) => `
              <button class="source-card card card-press" data-src="${s.id}">
                <span class="list-ico">${icon(t ? t.icon : 'folder')}</span>
                <span class="ellipsis" style="font-size:13px;font-weight:600">${esc(s.name)}</span>
                <span class="muted">v${esc(s.version || '1.0')}</span>
              </button>`).join('')}
          </div>
        </div>`;
    }).join('');
    $$('.source-card', homeEl).forEach((b) => b.onclick = () => {
      // 点击连接器卡片 → 聚焦搜索
      $('[data-role="kw"]', page).focus();
      toast('输入关键词即可搜索「' + b.textContent.trim().split('\n')[0] + '」');
    });
  }
  await renderHome();
  on('sources:changed', renderHome);

  $$('.chip', page).forEach((c) => c.onclick = () => {
    $$('.chip', page).forEach((x) => x.classList.toggle('on', x === c));
    const kw = $('[data-role="kw"]', page).value.trim();
    if (kw) doSearch(kw);
  });

  async function doSearch(kw) {
    const type = $('.chip.on', page).dataset.t;
    homeEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<div class="loading-row"><div class="spinner"></div>正在并发搜索所有连接器…</div>';
    const results = await searchAll(kw, { types: type ? [type] : null });
    if (!results.length) {
      resultsEl.innerHTML = `<div class="empty"><div class="empty-ico">${icon('search')}</div><div class="empty-title">没有找到「${esc(kw)}」</div><div class="muted">试试其他关键词，或先导入更多连接器</div></div>`;
      return;
    }
    // 按类型分组
    const groups = {};
    results.forEach((r) => { (groups[r.type] = groups[r.type] || []).push(r); });
    resultsEl.innerHTML = `<div class="muted" style="padding:4px 18px 10px">找到 ${results.length} 条结果</div>` +
      Object.entries(groups).map(([type, list]) => {
        const t = SOURCE_TYPES.find((x) => x.id === type);
        return `
        <div class="discover-section">
          <div class="section-head">${icon(t ? t.icon : 'folder')}<span>${t ? t.name : type}</span><span class="muted">${list.length}</span></div>
          <div class="result-grid">
            ${list.map((r, i) => `
              <button class="content-card card-press" data-g="${type}" data-i="${i}">
                <div class="content-cover">${r.coverUrl ? `<img src="${esc(r.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon(t ? t.icon : 'folder')}</div>
                <div class="content-name ellipsis">${esc(r.name || '未命名')}</div>
                <div class="content-sub ellipsis">${esc(r.author || r.sourceName || '')}</div>
              </button>`).join('')}
          </div>
        </div>`;
      }).join('');
    $$('.content-card', resultsEl).forEach((b) => {
      b.onclick = () => {
        const r = groups[b.dataset.g][+b.dataset.i];
        openDetail({ sourceId: r.sourceId, bookUrl: r.bookUrl, seed: r });
      };
    });
  }

  const kwInput = $('[data-role="kw"]', page);
  $('[data-a="go"]', page).onclick = () => { const kw = kwInput.value.trim(); if (kw) doSearch(kw); };
  kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const kw = kwInput.value.trim(); if (kw) doSearch(kw); } });
  kwInput.addEventListener('input', debounce(() => {
    if (!kwInput.value.trim()) { resultsEl.classList.add('hidden'); homeEl.classList.remove('hidden'); }
  }, 300));
}
