/* ===== ThirdHub js/modules/explore.js — 图源发现页（v4.0） =====
   发现页内容完全由图源（Venera explore 定义）驱动，App 不预置任何内容。
   支持官方三种页面类型：multiPartPage（多分区）/ multiPageComicList（分页列表）/ mixed（混合），
   以及 viewMore 跳转（search:关键词 / category:名称@参数）。 */
import { $, $$, esc, icon, toast, openOverlay } from '../ui.js';
import { getExplore, getExplorePage, getViewMore } from '../engine/content-service.js';
import { openDetail } from './detail.js';

function cellHtml(c) {
  return `
    <button class="xpl-cell card-press" data-b="${esc(c.bookUrl)}">
      <div class="xpl-cover">${c.coverUrl ? `<img src="${esc(c.coverUrl)}" loading="lazy" onerror="this.remove()">` : icon('image')}</div>
      <div class="xpl-name">${esc(c.name || '未命名')}</div>
      ${c.author ? `<div class="muted ellipsis" style="font-size:10.5px">${esc(c.author)}</div>` : ''}
    </button>`;
}

export async function openExplore(source) {
  openOverlay({
    title: source.name + ' · 发现',
    build: async (body) => {
      body.innerHTML = '<div class="loading-row"><div class="spinner"></div>加载发现页…</div>';

      const pages = await getExplore(source);
      if (!pages.length) {
        body.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('compass') + '</div><div class="empty-title">该图源没有提供发现页</div></div>';
        return;
      }

      let cur = 0;
      function bindCells(scope) {
        $$('.xpl-cell', scope).forEach((b) => b.onclick = () => openDetail({ sourceId: source.id, bookUrl: b.dataset.b, seed: {} }));
        $$('[data-more]', scope).forEach((b) => b.onclick = () => openViewMore(source, b.dataset.more));
      }

      async function renderPage(idx) {
        cur = idx;
        body.innerHTML = `
          ${pages.length > 1 ? `<div class="xpl-tabs">${pages.map((p, i) => `<button class="chip ${i === idx ? 'on' : ''}" data-p="${i}">${esc(p.title)}</button>`).join('')}</div>` : ''}
          <div data-role="xpl-body"><div class="loading-row"><div class="spinner"></div>加载中…</div></div>`;
        $$('[data-p]', body).forEach((c) => c.onclick = () => renderPage(+c.dataset.p));
        const box = $('[data-role="xpl-body"]', body);
        try {
          const r = await getExplorePage(source, idx, null);
          renderResult(box, r, idx);
        } catch (e) {
          box.innerHTML = `<div class="empty"><div class="empty-title">加载失败</div><div class="muted">${esc(e.message)}</div></div>`;
        }
      }

      function renderResult(box, r, idx, append = false) {
        const partsHtml = (r.parts || []).map((p) => `
          <div class="xpl-part">
            <div class="xpl-part-head">
              <span class="xpl-part-title">${esc(p.title || '')}</span>
              ${p.viewMore ? `<button class="btn btn-sm" data-more="${esc(p.viewMore)}">查看更多 ›</button>` : ''}
            </div>
            <div class="xpl-grid">${(p.comics || []).map(cellHtml).join('')}</div>
          </div>`).join('');
        const listHtml = (r.comics && r.comics.length) ? `<div class="xpl-grid" style="padding-bottom:10px">${r.comics.map(cellHtml).join('')}</div>` : '';
        const moreHtml = (r.maxPage && (r._page || 1) < r.maxPage) ? '<button class="btn btn-block btn-sm" data-a="xpl-more" style="margin:0 18px 20px;width:auto">加载更多</button>' : '';
        if (append) {
          const more = $('[data-a="xpl-more"]', box);
          if (more) more.remove();
          box.insertAdjacentHTML('beforeend', partsHtml + listHtml + moreHtml);
        } else {
          box.innerHTML = (partsHtml + listHtml) || '<div class="empty"><div class="empty-title">这个分区暂时没有内容</div></div>';
          box.insertAdjacentHTML('beforeend', moreHtml);
        }
        bindCells(box);
        const moreBtn = $('[data-a="xpl-more"]', box);
        if (moreBtn) moreBtn.onclick = async () => {
          moreBtn.textContent = '加载中…';
          try {
            const next = await getExplorePage(source, idx, (r._page || 1) + 1);
            next._page = (r._page || 1) + 1;
            renderResult(box, next, idx, true);
          } catch (e) { moreBtn.textContent = '加载失败，点击重试'; }
        };
      }

      await renderPage(0);
    },
  });
}

/* viewMore 跳转：分类 / 搜索 结果列表 */
export function openViewMore(source, spec) {
  const title = String(spec).replace(/^(search|category):/, '').split('@')[0] || '更多';
  openOverlay({
    title,
    build: async (body) => {
      body.innerHTML = '<div class="loading-row"><div class="spinner"></div>加载中…</div>';
      let page = 1, maxPage = 0;
      async function load(append) {
        try {
          const r = await getViewMore(source, spec, page);
          maxPage = r.maxPage || 0;
          const html = `<div class="xpl-grid" style="padding-bottom:10px">${(r.comics || []).map(cellHtml).join('')}</div>`;
          if (append) {
            const ob = $('[data-a="vm-more"]', body);
            if (ob) ob.remove();
            body.insertAdjacentHTML('beforeend', html);
          } else {
            body.innerHTML = html || '<div class="empty"><div class="empty-title">暂无内容</div></div>';
          }
          if (maxPage && page < maxPage) {
            body.insertAdjacentHTML('beforeend', '<button class="btn btn-block btn-sm" data-a="vm-more" style="margin:0 18px 20px;width:auto">加载更多</button>');
            $('[data-a="vm-more"]', body).onclick = () => { page++; load(true); };
          }
          $$('.xpl-cell', body).forEach((b) => b.onclick = () => openDetail({ sourceId: source.id, bookUrl: b.dataset.b, seed: {} }));
        } catch (e) {
          if (!append) body.innerHTML = `<div class="empty"><div class="empty-title">加载失败</div><div class="muted">${esc(e.message)}</div></div>`;
          else toast('加载失败：' + e.message, 'err');
        }
      }
      await load(false);
    },
  });
}
