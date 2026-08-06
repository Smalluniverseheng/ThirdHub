/* ===== ThirdHub js/readers/comic-reader.js — 漫画阅读器（Gallery/滚动/手势/预加载） ===== */
import { $, $$, esc, icon, toast, actionSheet } from '../ui.js';
import { getSetting, setSetting } from '../store.js';
import { getChapterList, getChapterContent, saveProgress, getProgress } from '../engine/content-service.js';

const PRELOAD = 3;

export async function openComicReader({ source, item, startChapter = 0 }) {
  let chapters = [];
  let idx = startChapter;
  let images = [];
  let mode = await getSetting('comicMode');   // gallery | scroll
  let dir = await getSetting('comicDir');      // ltr | rtl

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

  async function loadChapter(i) {
    if (i < 0 || i >= chapters.length) return;
    idx = i;
    body.innerHTML = '<div class="loading-row" style="color:#888"><div class="spinner"></div>加载中…</div>';
    try {
      const content = await getChapterContent(source, chapters[idx].url);
      images = parseImages(content);
      currentPage = 0;
      render();
      $('.cr-page-hint', ov).textContent = `${idx + 1}/${chapters.length} 章`;
      saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: idx });
    } catch (e) {
      body.innerHTML = `<div class="empty" style="color:#888"><div class="empty-title">加载失败</div><div class="muted">${esc(e.message)}</div></div>`;
    }
  }

  function render() {
    if (!images.length) { body.innerHTML = '<div class="empty" style="color:#888"><div class="empty-title">本章无图片</div></div>'; return; }
    if (mode === 'scroll') renderScroll();
    else renderGallery();
  }

  function renderScroll() {
    body.className = 'cr-body cr-scroll';
    body.innerHTML = images.map((src, i) => `<img class="cr-img" data-i="${i}" ${i < PRELOAD ? `src="${esc(src)}"` : `data-src="${esc(src)}"`} loading="lazy">`).join('');
    // 懒加载
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
    $$('img[data-src]', body).forEach((img) => io.observe(img));
    $$('.cr-img', body).forEach((img) => io.observe(img));
  }

  function renderGallery() {
    body.className = 'cr-body cr-gallery';
    body.innerHTML = `
      <div class="cr-page-wrap">
        <img class="cr-page-img" src="${esc(images[currentPage])}">
        <div class="cr-tap left"></div>
        <div class="cr-tap center"></div>
        <div class="cr-tap right"></div>
      </div>`;
    updateHint();
    preloadAround(currentPage);
    const img = $('.cr-page-img', body);
    // 双击缩放
    let scale = 1;
    img.addEventListener('dblclick', () => {
      scale = scale > 1 ? 1 : 2;
      img.style.transform = `scale(${scale})`;
    });
    // 双指缩放
    let startDist = 0;
    body.ontouchmove = (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (startDist) {
          scale = Math.min(4, Math.max(1, scale * (d / startDist)));
          img.style.transform = `scale(${scale})`;
        }
        startDist = d;
      }
    };
    body.ontouchend = () => (startDist = 0);
    // 点击区域
    $('.cr-tap.left', body).onclick = () => flip(dir === 'rtl' ? 1 : -1);
    $('.cr-tap.right', body).onclick = () => flip(dir === 'rtl' ? -1 : 1);
    $('.cr-tap.center', body).onclick = () => ov.classList.toggle('ui-hidden');
  }

  function flip(delta) {
    const next = currentPage + delta;
    if (next < 0) { toast('已经是第一页'); return; }
    if (next >= images.length) {
      if (idx < chapters.length - 1) { toast('进入下一章'); loadChapter(idx + 1); }
      else toast('已经是最后一页');
      return;
    }
    currentPage = next;
    renderGallery();
  }

  function updateHint() {
    $('.cr-page-hint', ov).textContent = `第 ${currentPage + 1}/${images.length} 页 · ${idx + 1}/${chapters.length} 章`;
  }

  function preloadAround(p) {
    for (let i = p + 1; i <= Math.min(images.length - 1, p + PRELOAD); i++) { const im = new Image(); im.src = images[i]; }
    for (let i = p - 1; i >= Math.max(0, p - PRELOAD); i--) { const im = new Image(); im.src = images[i]; }
  }

  async function showModeSheet() {
    const v = await actionSheet('阅读设置', [
      { label: '翻页模式 · 左翻（国漫）', value: 'gallery-ltr', icon: mode === 'gallery' && dir === 'ltr' ? 'check' : undefined },
      { label: '翻页模式 · 右翻（日漫）', value: 'gallery-rtl', icon: mode === 'gallery' && dir === 'rtl' ? 'check' : undefined },
      { label: '连续滚动（条漫）', value: 'scroll', icon: mode === 'scroll' ? 'check' : undefined },
    ]);
    if (!v) return;
    if (v === 'scroll') { mode = 'scroll'; } else { mode = 'gallery'; dir = v === 'gallery-rtl' ? 'rtl' : 'ltr'; }
    await setSetting('comicMode', mode);
    await setSetting('comicDir', dir);
    render();
  }

  $('[data-a="back"]', ov).onclick = () => ov.remove();
  $('[data-a="mode"]', ov).onclick = showModeSheet;
  $('[data-a="prev"]', ov).onclick = () => loadChapter(idx - 1);
  $('[data-a="next"]', ov).onclick = () => loadChapter(idx + 1);

  // 滚动模式轻点显示/隐藏工具栏
  body.addEventListener('click', (e) => {
    if (mode === 'scroll' && e.target === body) ov.classList.toggle('ui-hidden');
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
