/* ===== ThirdHub js/readers/novel-reader.js — 小说阅读器（v1.5 全量重写） =====
   滚动 / 分页（CSS 多栏）· 6 主题 · 字体字重边距段距 · 亮度 / 全屏 / 信息栏
   点按翻页 · 音量键翻页 · 自动滚动 · 插图小说 · 朗读 · AI 辅助阅读 */
import { $, $$, el, esc, icon, toast, modal, actionSheet, loadCss } from '../ui.js';
import { getSetting, setSetting, kvGet, kvSet } from '../store.js';
import { getChapterList, getChapterContent, saveProgress, getProgress } from '../engine/content-service.js';
import { getEngine } from '../engine/source-engine.js';
import { speak, stopSpeak, pauseSpeak, resumeSpeak } from '../voice.js';
import { chat } from '../ai/ai-api.js';

const READER_THEMES = {
  day:   { bg: '#f7f3ea', text: '#3a3428', name: '白天' },
  night: { bg: '#14161f', text: '#b8bdc9', name: '夜间' },
  eye:   { bg: '#e4f0e2', text: '#2d3a2d', name: '护眼' },
  paper: { bg: '#efe6d5', text: '#4a3f30', name: '羊皮纸' },
  blue:  { bg: '#e8eef7', text: '#2c3a4e', name: '浅蓝' },
  green: { bg: '#e3ede4', text: '#24352a', name: '竹绿' },
};
const FONT_FAMILIES = {
  system: { name: '系统默认', css: '' },
  serif:  { name: '衬线', css: 'Georgia, "Noto Serif SC", "Songti SC", serif' },
  sans:   { name: '无衬线', css: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  kai:    { name: '楷体', css: '"Kaiti SC", KaiTi, STKaiti, serif' },
};
const FLIP_MODES = [
  { id: 'scroll', name: '滚动' },
  { id: 'slide', name: '左右滑动' },
  { id: 'cover', name: '覆盖' },
  { id: 'sim', name: '仿真' },
  { id: 'none', name: '无动画' },
];

export async function openNovelReader({ source, item, startChapter = 0 }) {
  await loadCss('css/novel-reader.css'); /* v2.7：样式按需加载 */
  const engine = getEngine(source);
  let chapters = [];
  let idx = startChapter;
  const S = {};
  for (const k of ['readerFont', 'readerFontSize', 'readerFontWeight', 'readerLineHeight', 'readerPadding',
    'readerParaGap', 'readerTextColor', 'readerBgColor', 'readerTheme', 'readerBrightness', 'readerFullscreen',
    'readerVolumeFlip', 'readerAutoScroll', 'readerIllust', 'readerTapFlip', 'readerInfoBar', 'readerFlip']) {
    S[k] = await getSetting(k);
  }

  const ov = document.createElement('div');
  ov.className = 'overlay nr-overlay';
  ov.innerHTML = `
    <div class="nr-top nr-ui">
      <button class="icon-btn" data-a="back">${icon('back')}</button>
      <div class="overlay-title ellipsis">${esc(item.title || item.name)}</div>
    </div>
    <div class="nr-body"></div>
    <div class="nr-tapzones" hidden>
      <div class="nr-tap left" data-tap="prev"></div>
      <div class="nr-tap center" data-tap="menu"></div>
      <div class="nr-tap right" data-tap="next"></div>
    </div>
    <div class="nr-info nr-ui" hidden>
      <span class="nr-info-title ellipsis"></span>
      <span class="nr-info-right"><span class="nr-info-time"></span><span class="nr-info-prog"></span></span>
    </div>
    <div class="nr-bottom nr-ui">
      <div class="nr-navrow">
        <button class="nr-nav" data-a="prev">上一章</button>
        <input type="range" class="nr-slider" data-role="chslider" min="0" max="0" step="1" value="0">
        <button class="nr-nav" data-a="next">下一章</button>
      </div>
      <div class="nr-iconrow">
        <button class="nr-ic" data-a="catalog">${icon('list')}<span>目录</span></button>
        <button class="nr-ic" data-a="night">${icon('moon')}<span>夜间</span></button>
        <button class="nr-ic" data-a="tts">${icon('mic')}<span>听书</span></button>
        <button class="nr-ic" data-a="settings">${icon('settings')}<span>设置</span></button>
      </div>
    </div>
    <div class="nr-catalog hidden"></div>`;
  $('#overlay-root').appendChild(ov);

  const body = $('.nr-body', ov);
  const catalogEl = $('.nr-catalog', ov);
  const tapzones = $('.nr-tapzones', ov);
  const infoBar = $('.nr-info', ov);
  let currentText = '';
  let currentPlain = '';
  let clockTimer = null;
  let autoTimer = null;

  /* ---------- 样式应用 ---------- */
  function applySettings() {
    const t = READER_THEMES[S.readerTheme] || READER_THEMES.night;
    const bg = S.readerBgColor || t.bg;
    const fg = S.readerTextColor || t.text;
    ov.style.background = bg;
    ov.style.filter = S.readerBrightness >= 0.99 ? '' : `brightness(${S.readerBrightness})`;
    body.style.color = fg;
    body.style.fontSize = S.readerFontSize + 'px';
    body.style.lineHeight = S.readerLineHeight;
    body.style.fontWeight = S.readerFontWeight;
    body.style.fontFamily = FONT_FAMILIES[S.readerFont] ? FONT_FAMILIES[S.readerFont].css : '';
    body.style.setProperty('--nr-pad', S.readerPadding + 'px');
    body.style.setProperty('--nr-gap', S.readerParaGap + 'em');
    $$('.nr-top, .nr-bottom, .nr-info', ov).forEach((h) => { h.style.background = bg; h.style.color = fg; });
    const paged = S.readerFlip !== 'scroll';
    body.classList.toggle('nr-paged', paged);
    body.classList.remove('nr-anim-slide', 'nr-anim-cover', 'nr-anim-sim', 'nr-anim-none');
    if (paged) body.classList.add('nr-anim-' + (S.readerFlip === 'none' ? 'none' : S.readerFlip));
    tapzones.hidden = !S.readerTapFlip;
    infoBar.hidden = !S.readerInfoBar;
    layoutPages();
    startClock();
    startAutoScroll();
  }

  /* ---------- 分页（CSS 多栏） ---------- */
  function layoutPages() {
    if (!body.classList.contains('nr-paged')) { body.style.columnWidth = ''; return; }
    const w = body.clientWidth;
    if (w > 0) body.style.columnWidth = w + 'px';
  }
  window.addEventListener('resize', layoutPages);

  function pageCount() {
    if (!body.classList.contains('nr-paged')) return 1;
    const w = body.clientWidth;
    return Math.max(1, Math.ceil(body.scrollWidth / w));
  }
  function curPage() {
    if (!body.classList.contains('nr-paged')) return 0;
    return Math.round(body.scrollLeft / body.clientWidth);
  }
  function goPage(p, anim = true) {
    const max = pageCount() - 1;
    if (p < 0) { loadChapter(idx - 1, 'end'); return; }
    if (p > max) { loadChapter(idx + 1); return; }
    const behavior = anim && S.readerFlip !== 'none' ? 'smooth' : 'auto';
    body.scrollTo({ left: p * body.clientWidth, behavior });
    updateInfo();
  }

  /* ---------- 章节加载 ----------
     v4.1：开始阅读即默认下载本章（正文写入本地缓存，断网也能看）；
     换章/退出时作废旧请求——结果回来也不再上屏、不再占用渲染 */
  let loadToken = 0;
  async function loadChapter(i, toEnd = false) {
    if (i < 0 || i >= chapters.length) { if (i >= chapters.length && chapters.length) toast('已经是最后一章了'); return; }
    idx = i;
    const tk = ++loadToken;
    body.innerHTML = '<div class="loading-row"><div class="spinner"></div>加载中…</div>';
    try {
      const c = chapters[idx];
      const content = await getChapterContent(source, c.url);
      if (tk !== loadToken) return; /* 已换章或已退出：丢弃这次下载结果 */
      currentText = typeof content === 'string' ? content : String(content);
      renderText(c.name || `第 ${idx + 1} 章`);
      saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: idx });
      requestAnimationFrame(() => {
        if (toEnd === 'end') body.scrollLeft = body.scrollWidth;
        else { body.scrollLeft = 0; body.scrollTop = 0; }
        updateInfo();
        if (ttsOn) speakCurrent(); /* 听书模式：新章节加载完自动接着读 */
      });
    } catch (e) {
      body.innerHTML = `<div class="empty"><div class="empty-title">加载失败</div><div class="muted">${esc(e.message)}</div><button class="btn btn-primary mt16" data-a="retry">重试</button></div>`;
      $('[data-a="retry"]', body).onclick = () => loadChapter(idx);
    }
  }

  function renderText(title) {
    const parts = [`<div class="nr-chapter-title">${esc(title)}</div>`];
    /* v3.3：v3.1 起书源正文保留 HTML（插图小说），检测后消毒直出；纯文本走原逻辑 */
    const isHtml = /<\s*(p|img|div|br|section|span)\b/i.test(currentText);
    if (isHtml) {
      const tmp = document.createElement('div');
      tmp.innerHTML = currentText;
      tmp.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta').forEach((n) => n.remove());
      tmp.querySelectorAll('*').forEach((n) => { [...n.attributes].forEach((a) => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }); });
      if (!S.readerIllust) tmp.querySelectorAll('img').forEach((n) => n.remove());
      else tmp.querySelectorAll('img').forEach((im) => { im.classList.add('nr-illust'); im.setAttribute('loading', 'lazy'); im.onerror = () => im.remove(); });
      parts.push('<div class="nr-rich">' + tmp.innerHTML + '</div>');
      currentPlain = (tmp.textContent || '').trim();
    } else {
      const paras = currentText.split(/\n+/).map((p) => p.trim()).filter(Boolean);
      for (const p of paras) {
        // 插图小说：正文中独立的图片链接 / markdown 图片
        const mdImg = p.match(/^!\[.*?\]\((https?:[^)]+)\)$/);
        const rawImg = p.match(/^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|webp|gif))(\?[^\s]*)?$/i);
        const url = mdImg ? mdImg[1] : rawImg ? rawImg[0] : null;
        if (url && S.readerIllust) {
          parts.push(`<img class="nr-illust" src="${esc(url)}" loading="lazy" onerror="this.remove()">`);
        } else if (url) {
          parts.push(`<p class="nr-p nr-illust-link muted">[插图已隐藏]</p>`);
        } else {
          parts.push(`<p class="nr-p">${esc(p)}</p>`);
        }
      }
      currentPlain = currentText;
    }
    body.innerHTML = parts.join('');
    const slider = $('[data-role="chslider"]', ov);
    if (slider) { slider.max = Math.max(0, chapters.length - 1); slider.value = idx; }
    layoutPages();
  }

  /* ---------- 信息栏 / 时钟 ---------- */
  function updateInfo() {
    if (infoBar.hidden) return;
    const c = chapters[idx];
    $('.nr-info-title', ov).textContent = c ? (c.name || `第 ${idx + 1} 章`) : '';
    const paged = body.classList.contains('nr-paged');
    $('.nr-info-prog', ov).textContent = paged ? ` ${curPage() + 1}/${pageCount()} 页` : '';
  }
  function startClock() {
    if (clockTimer) clearInterval(clockTimer);
    const tick = () => {
      const d = new Date();
      $('.nr-info-time', ov).textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    tick();
    clockTimer = setInterval(tick, 30000);
  }
  body.addEventListener('scroll', () => {
    if (body.classList.contains('nr-paged')) updateInfo();
  }, { passive: true });

  /* ---------- 点按翻页 ---------- */
  tapzones.addEventListener('click', (e) => {
    const t = e.target.closest('.nr-tap');
    if (!t) return;
    const act = t.dataset.tap;
    if (act === 'menu') { toggleUI(); return; }
    const dir = act === 'prev' ? -1 : 1;
    if (body.classList.contains('nr-paged')) goPage(curPage() + dir);
    else {
      if (dir < 0 && body.scrollTop <= 0) loadChapter(idx - 1);
      else if (dir > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 4) loadChapter(idx + 1);
      else body.scrollBy({ top: dir * body.clientHeight * 0.9, behavior: 'smooth' });
    }
  });
  function toggleUI() {
    $$('.nr-ui', ov).forEach((h) => h.classList.toggle('nr-ui-hidden'));
  }
  // 初始隐藏上下栏（沉浸阅读），点中央呼出
  $$('.nr-ui', ov).forEach((h) => h.classList.add('nr-ui-hidden'));

  /* ---------- 音量键 / 键盘翻页 ---------- */
  document.addEventListener('keydown', onKey);
  function onKey(e) {
    if (!document.contains(ov)) { document.removeEventListener('keydown', onKey); return; }
    if (!S.readerVolumeFlip) return;
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'VolumeUp'].includes(e.key)) { e.preventDefault(); flipKey(-1); }
    if (['ArrowRight', 'ArrowDown', 'PageDown', 'VolumeDown'].includes(e.key)) { e.preventDefault(); flipKey(1); }
  }
  function flipKey(dir) {
    if (body.classList.contains('nr-paged')) goPage(curPage() + dir);
    else body.scrollBy({ top: dir * body.clientHeight * 0.9, behavior: 'smooth' });
  }

  /* ---------- 自动滚动 ---------- */
  function startAutoScroll() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (!S.readerAutoScroll || S.readerFlip !== 'scroll') return;
    const step = () => {
      body.scrollTop += S.readerAutoScroll / 20;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) loadChapter(idx + 1);
    };
    autoTimer = setInterval(step, 50);
  }

  /* ---------- 目录 / 书签 ---------- */
  const bookId = item.id || (source.id + ':' + item.bookUrl);
  const BM_KEY = 'bm:' + bookId;
  const getBookmarks = async () => (await kvGet(BM_KEY, [])) || [];

  async function addBookmark() {
    const list = await getBookmarks();
    const c = chapters[idx];
    const page0 = body.classList.contains('nr-paged') ? curPage() : 0;
    if (list.some((b) => b.chapterIndex === idx && b.page === page0)) { toast('此处已有书签'); return; }
    list.push({ chapterIndex: idx, page: page0, name: (c && c.name) || ('第 ' + (idx + 1) + ' 章'), time: Date.now() });
    await kvSet(BM_KEY, list);
    toast('已添加书签：' + ((c && c.name) || ''));
  }

  function showCatalog() {
    catalogEl.classList.toggle('hidden');
    if (!catalogEl.classList.contains('hidden')) {
      catalogEl.style.background = S.readerBgColor || (READER_THEMES[S.readerTheme] || READER_THEMES.night).bg;
      catalogEl.style.color = S.readerTextColor || (READER_THEMES[S.readerTheme] || READER_THEMES.night).text;
      renderCatalogTab('toc');
    }
  }

  async function renderCatalogTab(which) {
    catalogEl.innerHTML = `<div class="nr-catalog-head">
        <div class="nr-cat-tabs">
          <button class="nr-cat-tab ${which === 'toc' ? 'on' : ''}" data-ct="toc">目录（${chapters.length}）</button>
          <button class="nr-cat-tab ${which === 'bm' ? 'on' : ''}" data-ct="bm">书签</button>
        </div>
      </div>
      <div data-role="cat-body"></div>`;
    $$('.nr-cat-tab', catalogEl).forEach((b) => { b.onclick = () => renderCatalogTab(b.dataset.ct); });
    const box = $('[data-role="cat-body"]', catalogEl);
    if (which === 'toc') {
      box.innerHTML = chapters.map((c, i) => `<button class="nr-catalog-item ${i === idx ? 'on' : ''}" data-i="${i}">${esc(c.name || '第 ' + (i + 1) + ' 章')}</button>`).join('');
      $$('.nr-catalog-item', box).forEach((b) => {
        b.onclick = () => { catalogEl.classList.add('hidden'); loadChapter(+b.dataset.i); };
      });
      const cur = $('.nr-catalog-item.on', box);
      cur && cur.scrollIntoView({ block: 'center' });
    } else {
      const list = (await getBookmarks()).slice().reverse();
      box.innerHTML = list.length ? list.map((b, i) => `
        <div class="nr-catalog-item nr-bm-item" data-bi="${list.length - 1 - i}">
          <button class="nr-bm-jump" data-bjump="${list.length - 1 - i}">
            <span>${esc(b.name)}</span>
            <span class="muted" style="font-size:11px">${new Date(b.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </button>
          <button class="nr-bm-del" data-bdel="${list.length - 1 - i}" title="删除">×</button>
        </div>`).join('') :
        '<div class="muted" style="padding:24px;text-align:center;font-size:13px">还没有书签<br>在阅读页面向下拉即可添加书签</div>';
      const raw = await getBookmarks();
      $$('[data-bjump]', box).forEach((b) => {
        b.onclick = async () => {
          const bm2 = raw[+b.dataset.bjump];
          if (!bm2) return;
          catalogEl.classList.add('hidden');
          await loadChapter(bm2.chapterIndex);
          if (bm2.page) requestAnimationFrame(() => goPage(bm2.page, false));
        };
      });
      $$('[data-bdel]', box).forEach((b) => {
        b.onclick = async () => {
          raw.splice(+b.dataset.bdel, 1);
          await kvSet(BM_KEY, raw);
          renderCatalogTab('bm');
          toast('已删除书签');
        };
      });
    }
  }

  /* v3.4：阅读页顶部下拉添加书签（番茄小说手势） */
  const pullTip = document.createElement('div');
  pullTip.className = 'nr-pulltip';
  pullTip.textContent = '↓ 松手添加书签';
  ov.appendChild(pullTip);
  let pullStartY = null, pullReady = false;
  body.addEventListener('touchstart', (e) => {
    pullStartY = body.scrollTop <= 2 ? e.touches[0].clientY : null;
    pullReady = false;
  }, { passive: true });
  body.addEventListener('touchmove', (e) => {
    if (pullStartY == null) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy > 70 && !pullReady) { pullReady = true; pullTip.classList.add('on'); }
    if (dy <= 70 && pullReady) { pullReady = false; pullTip.classList.remove('on'); }
  }, { passive: true });
  body.addEventListener('touchend', async () => {
    if (pullReady) await addBookmark();
    pullReady = false;
    pullTip.classList.remove('on');
    pullStartY = null;
  });

  /* ---------- 阅读设置 ---------- */
  function showSettings() {
    const chip = (k, list, cur, label) => `
      <div class="muted mb8">${label}</div>
      <div class="nr-chip-row mb16">${list.map(([v, name]) =>
        `<button class="ai-chip ${String(cur) === String(v) ? 'on' : ''}" data-k="${k}" data-v="${v}">${name}</button>`).join('')}</div>`;
    const range = (k, min, max, step, cur, label, unit = '') => `
      <div class="muted mb8">${label}：<span data-lab="${k}">${cur}</span>${unit}</div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}" data-range="${k}" style="width:100%;margin-bottom:14px">`;
    const toggle = (k, cur, label) => `
      <div class="nr-set-row"><span>${label}</span><button class="ai-toggle ${cur ? 'on' : ''}" data-tog="${k}"></button></div>`;

    const body2 = el(`<div class="nr-settings">
      <div class="muted mb8">背景主题</div>
      <div class="row gap8 mb16" style="flex-wrap:wrap">${Object.entries(READER_THEMES).map(([k, t]) => `
        <button class="nr-theme-dot ${S.readerTheme === k ? 'on' : ''}" data-theme="${k}" title="${t.name}"
          style="background:${t.bg};border-color:${S.readerTheme === k ? 'var(--primary)' : 'var(--border)'}"></button>`).join('')}
      </div>
      ${chip('readerFont', Object.entries(FONT_FAMILIES).map(([v, f]) => [v, f.name]), S.readerFont, '字体')}
      ${range('readerFontSize', 12, 32, 1, S.readerFontSize, '字号', 'px')}
      ${range('readerLineHeight', 1.2, 2.4, 0.1, S.readerLineHeight, '行距')}
      ${range('readerParaGap', 0, 2, 0.1, S.readerParaGap, '段距', 'em')}
      ${range('readerPadding', 4, 40, 2, S.readerPadding, '页边距', 'px')}
      ${chip('readerFontWeight', [[300, '细'], [400, '常规'], [600, '粗']], S.readerFontWeight, '字重')}
      ${chip('readerFlip', FLIP_MODES.map(f => [f.id, f.name]), S.readerFlip, '翻页方式')}
      ${range('readerBrightness', 0.3, 1, 0.05, S.readerBrightness, '亮度')}
      ${range('readerAutoScroll', 0, 200, 10, S.readerAutoScroll, '自动滚动', ' px/s')}
      ${toggle('readerTapFlip', S.readerTapFlip, '点按翻页（左右翻页 / 中间呼出菜单）')}
      ${toggle('readerVolumeFlip', S.readerVolumeFlip, '音量键翻页')}
      ${toggle('readerInfoBar', S.readerInfoBar, '底部信息栏（章节 / 时间 / 页码）')}
      ${toggle('readerIllust', S.readerIllust, '显示正文插图（插图小说）')}
      ${toggle('readerFullscreen', S.readerFullscreen, '全屏阅读')}
    </div>`);
    modal({ title: '阅读设置', body: body2 });

    $$('.nr-theme-dot', body2).forEach((b) => b.onclick = async () => {
      S.readerTheme = b.dataset.theme;
      await setSetting('readerTheme', S.readerTheme);
      applySettings();
      $$('.nr-theme-dot', body2).forEach((x) => {
        x.classList.toggle('on', x === b);
        x.style.borderColor = x === b ? 'var(--primary)' : 'var(--border)';
      });
    });
    $$('[data-k]', body2).forEach((b) => b.onclick = async () => {
      const k = b.dataset.k;
      S[k] = k === 'readerFontWeight' ? +b.dataset.v : b.dataset.v;
      await setSetting(k, S[k]);
      applySettings();
      $$(`[data-k="${k}"]`, body2).forEach((x) => x.classList.toggle('on', x === b));
    });
    $$('[data-range]', body2).forEach((r) => r.oninput = async () => {
      const k = r.dataset.range;
      S[k] = +r.value;
      $(`[data-lab="${k}"]`, body2).textContent = S[k];
      await setSetting(k, S[k]);
      applySettings();
    });
    $$('[data-tog]', body2).forEach((t) => t.onclick = async () => {
      const k = t.dataset.tog;
      S[k] = !S[k];
      t.classList.toggle('on', S[k]);
      await setSetting(k, S[k]);
      if (k === 'readerFullscreen') {
        try {
          if (S[k]) await ov.requestFullscreen();
          else if (document.fullscreenElement) await document.exitFullscreen();
        } catch (e) {}
      }
      applySettings();
    });
  }

  /* ---------- 绑定 ---------- */
  $('[data-a="back"]', ov).onclick = () => {
    loadToken++; /* v4.1：退出阅读即取消进行中的章节下载 */
    ttsOn = false;
    stopSpeak();
    if (clockTimer) clearInterval(clockTimer);
    if (autoTimer) clearInterval(autoTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    window.removeEventListener('resize', layoutPages);
    ov.remove();
  };
  $('[data-a="catalog"]', ov).onclick = showCatalog;
  $('[data-a="settings"]', ov).onclick = showSettings;
  $('[data-a="night"]', ov).onclick = async () => {
    S.readerTheme = S.readerTheme === 'night' ? 'day' : 'night';
    await setSetting('readerTheme', S.readerTheme);
    applySettings();
  };
  $('[data-role="chslider"]', ov).onchange = (e) => { const v = +e.target.value; if (v !== idx) loadChapter(v); };
  $('[data-a="prev"]', ov).onclick = () => loadChapter(idx - 1);
  $('[data-a="next"]', ov).onclick = () => loadChapter(idx + 1);
  /* ---------- v3.3/v3.4 听书：浮动控制条 + 语速 + 自动连读下一章 ---------- */
  let ttsOn = false;
  let ttsRate = 1;
  try { ttsRate = (await kvGet('tts:rate', 1)) || 1; } catch (e) {}
  const ttsBar = document.createElement('div');
  ttsBar.className = 'nr-ttsbar nr-ui nr-ui-hidden';
  ttsBar.innerHTML = `
    <button class="nr-tts-btn" data-t="pp">暂停</button>
    <div class="nr-tts-rates">${[0.75, 1, 1.25, 1.5, 2].map((r) => `<button class="nr-tts-rate ${r === ttsRate ? 'on' : ''}" data-r="${r}">${r}x</button>`).join('')}</div>
    <button class="nr-tts-btn" data-t="close">关闭</button>`;
  ov.appendChild(ttsBar);
  $$('.nr-tts-rate', ttsBar).forEach((b) => b.onclick = async () => {
    ttsRate = +b.dataset.r;
    await kvSet('tts:rate', ttsRate);
    $$('.nr-tts-rate', ttsBar).forEach((x) => x.classList.toggle('on', x === b));
    if (ttsOn) speakCurrent(); /* 立即以新语速重读本章 */
  });
  let ttsPaused = false;
  $('[data-t="pp"]', ttsBar).onclick = () => {
    ttsPaused = !ttsPaused;
    if (ttsPaused) pauseSpeak(); else resumeSpeak();
    $('[data-t="pp"]', ttsBar).textContent = ttsPaused ? '继续' : '暂停';
  };
  $('[data-t="close"]', ttsBar).onclick = () => stopTts();
  function speakCurrent() {
    if (!ttsOn) return;
    ttsPaused = false;
    $('[data-t="pp"]', ttsBar).textContent = '暂停';
    speak(currentPlain || currentText, {
      rate: ttsRate,
      onEnd: () => { if (ttsOn && idx < chapters.length - 1) loadChapter(idx + 1); },
    });
  }
  function stopTts() {
    ttsOn = false;
    stopSpeak();
    ttsBar.classList.add('nr-ui-hidden');
  }
  $('[data-a="tts"]', ov).onclick = () => {
    if (ttsOn) { stopTts(); toast('已停止朗读'); return; }
    ttsOn = true;
    ttsBar.classList.remove('nr-ui-hidden');
    speakCurrent();
    toast('开始朗读');
  };

  /* ---------- 选中文字 AI 辅助 ---------- */
  body.addEventListener('mouseup', async () => {
    const sel = window.getSelection().toString().trim();
    if (sel.length < 2 || sel.length > 500) return;
    const v = await actionSheet('AI 辅助阅读', [
      { label: '总结这段文字', value: 'sum', icon: 'sparkle' },
      { label: '翻译成中文', value: 'trans', icon: 'translate' },
      { label: '解释含义', value: 'explain', icon: 'info' },
    ]);
    if (!v) return;
    const prompts = { sum: '请简要总结：', trans: '请翻译成中文：', explain: '请解释这段文字的含义：' };
    toast('AI 处理中…');
    try {
      const model = await kvGet('ai:last-model', { providerId: 'deepseek', model: 'deepseek-chat' });
      const { text } = await chat({ ...model, messages: [{ role: 'user', content: prompts[v] + sel }] });
      modal({ title: 'AI 辅助', body: `<div style="font-size:14px;line-height:1.8">${esc(text)}</div>` });
    } catch (e) { toast(e.message, 'err'); }
  });

  /* ---------- 初始化 ---------- */
  applySettings();
  if (S.readerFullscreen) { try { await ov.requestFullscreen(); } catch (e) {} }
  try {
    chapters = await getChapterList(source, item.bookUrl);
  } catch (e) {
    body.innerHTML = `<div class="empty"><div class="empty-title">目录加载失败</div><div class="muted">${esc(e.message)}</div></div>`;
    return;
  }
  const prog = await getProgress(item.id || (source.id + ':' + item.bookUrl));
  loadChapter(prog && prog.chapterIndex != null ? prog.chapterIndex : startChapter);
}
