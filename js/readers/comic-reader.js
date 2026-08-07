/* ===== ThirdHub js/readers/comic-reader.js — 漫画阅读器（v1.5 全量重写） =====
   布局：单页 / 双页 / 条漫（上下滚动）· 方向：左翻（国漫）/ 右翻（日漫）
   适配：宽度 / 高度 / 原始 · 留白 · 亮度 · 切白边 · 预加载 · 双击/双指缩放 · 滑动翻页 */
import { $, $$, el, esc, icon, toast, modal } from '../ui.js';
import { getSetting, setSetting } from '../store.js';
import { getChapterList, getChapterContent, saveProgress, getProgress } from '../engine/content-service.js';

const LAYOUTS = [
  { id: 'paged', name: '单页 · 左翻（国漫）', dir: 'ltr' },
  { id: 'paged-rtl', name: '单页 · 右翻（日漫）', dir: 'rtl' },
  { id: 'double', name: '双页 · 左翻', dir: 'ltr' },
  { id: 'double-rtl', name: '双页 · 右翻（日漫）', dir: 'rtl' },
  { id: 'webtoon', name: '条漫 · 上下滚动', dir: 'ltr' },
];
const FITS = [
  { id: 'width', name: '适应宽度' },
  { id: 'height', name: '适应高度' },
  { id: 'original', name: '原始大小' },
];

export async function openComicReader({ source, item, startChapter = 0 }) {
  let chapters = [];
  let idx = startChapter;
  let images = [];
  let layout = await getSetting('comicLayout');   // paged | webtoon | double
  let dir = await getSetting('comicDir');          // ltr | rtl
  let fit = await getSetting('comicFit');
  let gap = await getSetting('comicGap');
  let brightness = await getSetting('comicBrightness');
  let crop = await getSetting('comicCropBorder');
  let preloadN = await getSetting('comicPreload');
  // 旧键兼容：comicMode = gallery → paged
  const legacyMode = await getSetting('comicMode');
  if (legacyMode === 'scroll' && layout === 'paged') layout = 'webtoon';

  const ov = document.createElement('div');
  ov.className = 'overlay cr-overlay';
  ov.innerHTML = `
    <div class="cr-top cr-ui">
      <button class="icon-btn" data-a="back">${icon('back')}</button>
      <div class="overlay-title ellipsis" style="color:#fff">${esc(item.title || item.name)}</div>
      <button class="icon-btn" data-a="mode">${icon('settings')}</button>
    </div>
    <div class="cr-body"></div>
    <div class="cr-bottom cr-ui">
      <button class="nr-nav" data-a="prev">上一章</button>
      <div class="cr-page-hint"></div>
      <button class="nr-nav" data-a="next">下一章</button>
    </div>`;
  document.getElementById('overlay-root').appendChild(ov);

  const body = $('.cr-body', ov);
  let currentPage = 0;

  function parseImages(content) {
    if (Array.isArray(content)) return content;
    try {
      const j = JSON.parse(content);
      if (Array.isArray(j)) return j;
      if (j.images) return j.images;
    } catch (e) {}
    return String(content).split('\n').map((s) => s.trim()).filter((s) => /^https?:/.test(s));
  }

  async function persistLayout() {
    await setSetting('comicLayout', layout);
    await setSetting('comicDir', dir);
    await setSetting('comicMode', layout === 'webtoon' ? 'scroll' : 'gallery');
  }

  function pageSize() { return layout === 'double' ? 2 : 1; }

  async function loadChapter(i, toEnd = false) {
    if (i < 0 || i >= chapters.length) { if (i >= chapters.length && chapters.length) toast('已经是最后一章了'); return; }
    idx = i;
    body.innerHTML = '<div class="loading-row" style="color:#888"><div class="spinner"></div>加载中…</div>';
    try {
      const content = await getChapterContent(source, chapters[idx].url);
      images = parseImages(content);
      currentPage = toEnd ? Math.max(0, images.length - pageSize()) : 0;
      render();
      saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: idx });
    } catch (e) {
      body.innerHTML = `<div class="empty" style="color:#888"><div class="empty-title">加载失败</div><div class="muted">${esc(e.message)}</div><button class="btn btn-primary mt16" data-a="retry">重试</button></div>`;
      $('[data-a="retry"]', body).onclick = () => loadChapter(idx);
    }
  }

  function applyBodyStyle() {
    body.style.filter = brightness >= 0.99 ? '' : `brightness(${brightness})`;
    body.classList.toggle('cr-nogap', !gap);
    body.dataset.fit = fit;
    body.classList.toggle('cr-crop', crop);
  }

  function render() {
    applyBodyStyle();
    if (!images.length) { body.innerHTML = '<div class="empty" style="color:#888"><div class="empty-title">本章无图片</div></div>'; return; }
    if (layout === 'webtoon') renderScroll();
    else renderPaged();
  }

  /* ---------- 条漫（上下滚动） ---------- */
  function renderScroll() {
    body.className = 'cr-body cr-scroll' + (gap ? '' : ' cr-nogap');
    applyBodyStyle();
    body.innerHTML = images.map((src, i) =>
      `<img class="cr-img" data-i="${i}" ${i < preloadN ? `src="${esc(src)}"` : `data-src="${esc(src)}"`} loading="lazy">`).join('');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const img = en.target;
          if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
          currentPage = +img.dataset.i;
          updateHint();
          io.unobserve(img);
          preloadAround(currentPage);
        }
      });
    }, { root: body, rootMargin: '400px' });
    $$('.cr-img', body).forEach((img) => io.observe(img));
    $('.cr-page-hint', ov).textContent = `${idx + 1}/${chapters.length} 章`;
  }

  /* ---------- 单页 / 双页 ---------- */
  function renderPaged() {
    const sz = pageSize();
    body.className = 'cr-body cr-gallery' + (sz === 2 ? ' cr-double' : '');
    applyBodyStyle();
    // 双页 + 日漫：页序倒转（右→左阅读）
    let pair = images.slice(currentPage, currentPage + sz);
    if (sz === 2 && dir === 'rtl') pair = pair.reverse();
    body.innerHTML = `
      <div class="cr-page-wrap">
        ${pair.map((src) => `<img class="cr-page-img" src="${esc(src)}">`).join('')}
        <div class="cr-tap left"></div>
        <div class="cr-tap center"></div>
        <div class="cr-tap right"></div>
      </div>`;
    updateHint();
    preloadAround(currentPage);
    const wrap = $('.cr-page-wrap', body);
    const imgs = $$('.cr-page-img', wrap);

    /* 双击缩放 */
    let scale = 1;
    imgs.forEach((img) => img.addEventListener('dblclick', () => {
      scale = scale > 1 ? 1 : 2;
      imgs.forEach((im) => { im.style.transform = `scale(${scale})`; });
    }));
    /* 双指缩放 */
    let startDist = 0;
    body.ontouchmove = (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (startDist) {
          scale = Math.min(4, Math.max(1, scale * (d / startDist)));
          imgs.forEach((im) => { im.style.transform = `scale(${scale})`; });
        }
        startDist = d;
      }
    };
    /* 滑动翻页 */
    let sx = 0, sy = 0, swiping = false;
    body.ontouchstart = (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
    };
    body.ontouchend = (e) => {
      startDist = 0;
      if (!swiping) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && scale <= 1) {
        flip((dx < 0 ? 1 : -1) * (dir === 'rtl' ? -1 : 1));
      }
    };
    /* 点按区域 */
    $('.cr-tap.left', body).onclick = () => flip(dir === 'rtl' ? 1 : -1);
    $('.cr-tap.right', body).onclick = () => flip(dir === 'rtl' ? -1 : 1);
    $('.cr-tap.center', body).onclick = () => ov.classList.toggle('ui-hidden');
  }

  function flip(delta) {
    const sz = pageSize();
    const next = currentPage + delta * sz;
    if (next < 0) {
      if (idx > 0) { toast('进入上一章'); loadChapter(idx - 1, true); }
      else toast('已经是第一页');
      return;
    }
    if (next >= images.length) {
      if (idx < chapters.length - 1) { toast('进入下一章'); loadChapter(idx + 1); }
      else toast('已经是最后一页');
      return;
    }
    currentPage = next;
    renderPaged();
  }

  function updateHint() {
    const sz = pageSize();
    const pageTxt = sz === 2 ? `第 ${currentPage + 1}-${Math.min(currentPage + sz, images.length)}/${images.length} 页` : `第 ${currentPage + 1}/${images.length} 页`;
    $('.cr-page-hint', ov).textContent = `${pageTxt} · ${idx + 1}/${chapters.length} 章`;
  }

  function preloadAround(p) {
    for (let i = p + 1; i <= Math.min(images.length - 1, p + preloadN); i++) { const im = new Image(); im.src = images[i]; }
    for (let i = p - 1; i >= Math.max(0, p - preloadN); i--) { const im = new Image(); im.src = images[i]; }
  }

  /* ---------- 设置 ---------- */
  function curLayoutKey() { return layout + (layout === 'webtoon' ? '' : '-' + dir); }
  function showSettings() {
    const body2 = el(`<div class="nr-settings">
      <div class="muted mb8">阅读布局</div>
      <div class="nr-chip-row mb16" style="flex-direction:column;align-items:stretch">
        ${LAYOUTS.map((l) => `<button class="ai-chip ${curLayoutKey() === l.id || (l.id === 'paged' && layout === 'paged' && dir === 'ltr') || (l.id === 'paged-rtl' && layout === 'paged' && dir === 'rtl') || (l.id === 'double' && layout === 'double' && dir === 'ltr') || (l.id === 'double-rtl' && layout === 'double' && dir === 'rtl') || (l.id === 'webtoon' && layout === 'webtoon') ? 'on' : ''}" data-lay="${l.id}">${l.name}</button>`).join('')}
      </div>
      <div class="muted mb8">图片适配</div>
      <div class="nr-chip-row mb16">${FITS.map((f) => `<button class="ai-chip ${fit === f.id ? 'on' : ''}" data-fit="${f.id}">${f.name}</button>`).join('')}</div>
      <div class="muted mb8">亮度：<span data-lab="b">${brightness}</span></div>
      <input type="range" min="0.3" max="1" step="0.05" value="${brightness}" data-range="b" style="width:100%;margin-bottom:14px">
      <div class="muted mb8">预加载页数：<span data-lab="p">${preloadN}</span></div>
      <input type="range" min="1" max="8" step="1" value="${preloadN}" data-range="p" style="width:100%;margin-bottom:14px">
      <div class="nr-set-row"><span>页间留白</span><button class="ai-toggle ${gap ? 'on' : ''}" data-tog="gap"></button></div>
      <div class="nr-set-row"><span>切除白边</span><button class="ai-toggle ${crop ? 'on' : ''}" data-tog="crop"></button></div>
    </div>`);
    modal({ title: '漫画设置', body: body2 });

    $$('[data-lay]', body2).forEach((b) => b.onclick = async () => {
      const l = LAYOUTS.find((x) => x.id === b.dataset.lay);
      if (l.id === 'webtoon') { layout = 'webtoon'; }
      else if (l.id.startsWith('double')) { layout = 'double'; dir = l.dir; }
      else { layout = 'paged'; dir = l.dir; }
      await persistLayout();
      $$('[data-lay]', body2).forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
    $$('[data-fit]', body2).forEach((b) => b.onclick = async () => {
      fit = b.dataset.fit;
      await setSetting('comicFit', fit);
      $$('[data-fit]', body2).forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
    $('[data-range="b"]', body2).oninput = async (e) => {
      brightness = +e.target.value;
      $('[data-lab="b"]', body2).textContent = brightness;
      await setSetting('comicBrightness', brightness);
      applyBodyStyle();
    };
    $('[data-range="p"]', body2).oninput = async (e) => {
      preloadN = +e.target.value;
      $('[data-lab="p"]', body2).textContent = preloadN;
      await setSetting('comicPreload', preloadN);
    };
    $('[data-tog="gap"]', body2).onclick = async (e) => {
      gap = !gap;
      e.currentTarget.classList.toggle('on', gap);
      await setSetting('comicGap', gap);
      render();
    };
    $('[data-tog="crop"]', body2).onclick = async (e) => {
      crop = !crop;
      e.currentTarget.classList.toggle('on', crop);
      await setSetting('comicCropBorder', crop);
      render();
    };
  }

  $('[data-a="back"]', ov).onclick = () => ov.remove();
  $('[data-a="mode"]', ov).onclick = showSettings;
  $('[data-a="prev"]', ov).onclick = () => loadChapter(idx - 1);
  $('[data-a="next"]', ov).onclick = () => loadChapter(idx + 1);

  body.addEventListener('click', (e) => {
    if (layout === 'webtoon' && e.target === body) ov.classList.toggle('ui-hidden');
  });

  try {
    chapters = await getChapterList(source, item.bookUrl);
  } catch (e) {
    body.innerHTML = `<div class="empty" style="color:#888"><div class="empty-title">目录加载失败</div><div class="muted">${esc(e.message)}</div></div>`;
    return;
  }
  const prog = await getProgress(item.id || (source.id + ':' + item.bookUrl));
  await loadChapter(prog && prog.chapterIndex != null ? prog.chapterIndex : startChapter);
}
