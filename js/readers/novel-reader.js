/* ===== ThirdHub js/readers/novel-reader.js — 小说阅读器 ===== */
import { $, $$, el, esc, icon, toast, modal } from '../ui.js';
import { getSetting, setSetting, kvGet, kvSet } from '../store.js';
import { getChapterList, getChapterContent, saveProgress, getProgress } from '../engine/content-service.js';
import { getEngine } from '../engine/source-engine.js';
import { speak, stopSpeak } from '../voice.js';
import { chat } from '../ai/ai-api.js';

const READER_THEMES = {
  day:   { bg: '#f7f3ea', text: '#3a3428', name: '白天' },
  night: { bg: '#14161f', text: '#b8bdc9', name: '夜间' },
  eye:   { bg: '#e4f0e2', text: '#2d3a2d', name: '护眼' },
  paper: { bg: '#efe6d5', text: '#4a3f30', name: '羊皮纸' },
};

export async function openNovelReader({ source, item, startChapter = 0 }) {
  const engine = getEngine(source);
  let chapters = [];
  let idx = startChapter;
  let settings = {
    fontSize: await getSetting('readerFontSize'),
    lineHeight: await getSetting('readerLineHeight'),
    theme: await getSetting('readerTheme'),
    flip: await getSetting('readerFlip'),
  };

  const ov = document.createElement('div');
  ov.className = 'overlay nr-overlay';
  ov.innerHTML = `
    <div class="nr-top">
      <button class="icon-btn" data-a="back">${icon('back')}</button>
      <div class="overlay-title ellipsis">${esc(item.title || item.name)}</div>
      <button class="icon-btn" data-a="tts" title="朗读">${icon('mic')}</button>
      <button class="icon-btn" data-a="catalog" title="目录">${icon('list')}</button>
      <button class="icon-btn" data-a="settings" title="设置">${icon('settings')}</button>
    </div>
    <div class="nr-body"></div>
    <div class="nr-bottom">
      <button class="nr-nav" data-a="prev">上一章</button>
      <div class="nr-progress muted"></div>
      <button class="nr-nav" data-a="next">下一章</button>
    </div>
    <div class="nr-catalog hidden"></div>`;
  $('#overlay-root').appendChild(ov);

  const body = $('.nr-body', ov);
  const catalogEl = $('.nr-catalog', ov);
  let currentText = '';

  function applySettings() {
    const t = READER_THEMES[settings.theme] || READER_THEMES.night;
    ov.style.background = t.bg;
    body.style.color = t.text;
    body.style.fontSize = settings.fontSize + 'px';
    body.style.lineHeight = settings.lineHeight;
    $$('.nr-top, .nr-bottom', ov).forEach((h) => { h.style.background = t.bg; h.style.color = t.text; });
  }

  async function loadChapter(i, keepScroll = false) {
    if (i < 0 || i >= chapters.length) return;
    idx = i;
    body.innerHTML = '<div class="loading-row"><div class="spinner"></div>加载中…</div>';
    try {
      const c = chapters[idx];
      const content = await getChapterContent(source, c.url);
      currentText = typeof content === 'string' ? content : String(content);
      renderText(c.name || `第 ${idx + 1} 章`);
      $('.nr-progress', ov).textContent = `${idx + 1} / ${chapters.length}`;
      saveProgress(item.id || (source.id + ':' + item.bookUrl), { chapterIndex: idx });
      if (!keepScroll) body.scrollTop = 0;
    } catch (e) {
      body.innerHTML = `<div class="empty"><div class="empty-title">加载失败</div><div class="muted">${esc(e.message)}</div><button class="btn btn-primary mt16" data-a="retry">重试</button></div>`;
      $('[data-a="retry"]', body).onclick = () => loadChapter(idx);
    }
  }

  function renderText(title) {
    const paras = currentText.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    body.innerHTML = `<div class="nr-chapter-title">${esc(title)}</div>` +
      paras.map((p) => `<p class="nr-p">${esc(p)}</p>`).join('');
  }

  function showCatalog() {
    catalogEl.classList.toggle('hidden');
    if (!catalogEl.classList.contains('hidden')) {
      catalogEl.innerHTML = `<div class="nr-catalog-head">目录（${chapters.length} 章）</div>` +
        chapters.map((c, i) => `<button class="nr-catalog-item ${i === idx ? 'on' : ''}" data-i="${i}">${esc(c.name || '第 ' + (i + 1) + ' 章')}</button>`).join('');
      $$('.nr-catalog-item', catalogEl).forEach((b) => {
        b.onclick = () => { catalogEl.classList.add('hidden'); loadChapter(+b.dataset.i); };
      });
      const cur = $('.nr-catalog-item.on', catalogEl);
      cur && cur.scrollIntoView({ block: 'center' });
    }
  }

  function showSettings() {
    const body2 = el(`<div>
      <div class="muted mb8">背景</div>
      <div class="row gap8 mb16">${Object.entries(READER_THEMES).map(([k, t]) => `
        <button class="nr-theme-dot ${settings.theme === k ? 'on' : ''}" data-theme="${k}" style="background:${t.bg};border-color:${settings.theme === k ? 'var(--primary)' : 'var(--border)'}"></button>`).join('')}
      </div>
      <div class="muted mb8">字号：<span data-v="fs">${settings.fontSize}</span>px</div>
      <input type="range" min="12" max="32" value="${settings.fontSize}" data-s="fontSize" style="width:100%">
      <div class="muted mb8 mt16">行距：<span data-v="lh">${settings.lineHeight}</span></div>
      <input type="range" min="1.2" max="2" step="0.1" value="${settings.lineHeight}" data-s="lineHeight" style="width:100%">
    </div>`);
    modal({ title: '阅读设置', body: body2 });
    $$('.nr-theme-dot', body2).forEach((b) => b.onclick = async () => {
      settings.theme = b.dataset.theme;
      await setSetting('readerTheme', settings.theme);
      applySettings();
      $$('.nr-theme-dot', body2).forEach((x) => { x.classList.toggle('on', x === b); x.style.borderColor = x === b ? 'var(--primary)' : 'var(--border)'; });
    });
    $('[data-s="fontSize"]', body2).oninput = async (e) => {
      settings.fontSize = +e.target.value;
      $('[data-v="fs"]', body2).textContent = settings.fontSize;
      await setSetting('readerFontSize', settings.fontSize);
      applySettings();
    };
    $('[data-s="lineHeight"]', body2).oninput = async (e) => {
      settings.lineHeight = +e.target.value;
      $('[data-v="lh"]', body2).textContent = settings.lineHeight;
      await setSetting('readerLineHeight', settings.lineHeight);
      applySettings();
    };
  }

  $('[data-a="back"]', ov).onclick = () => { stopSpeak(); ov.remove(); };
  $('[data-a="catalog"]', ov).onclick = showCatalog;
  $('[data-a="settings"]', ov).onclick = showSettings;
  $('[data-a="prev"]', ov).onclick = () => loadChapter(idx - 1);
  $('[data-a="next"]', ov).onclick = () => loadChapter(idx + 1);
  let ttsOn = false;
  $('[data-a="tts"]', ov).onclick = () => {
    ttsOn = !ttsOn;
    if (ttsOn) { speak(currentText); toast('开始朗读'); } else stopSpeak();
  };

  // 选中文字 AI 辅助
  body.addEventListener('mouseup', async () => {
    const sel = window.getSelection().toString().trim();
    if (sel.length < 2 || sel.length > 500) return;
    const v = await import('../ui.js').then((m) => m.actionSheet('AI 辅助阅读', [
      { label: '总结这段文字', value: 'sum', icon: 'sparkle' },
      { label: '翻译成中文', value: 'trans', icon: 'translate' },
      { label: '解释含义', value: 'explain', icon: 'info' },
    ]));
    if (!v) return;
    const prompts = { sum: '请简要总结：', trans: '请翻译成中文：', explain: '请解释这段文字的含义：' };
    toast('AI 处理中…');
    try {
      const model = await kvGet('ai:last-model', { providerId: 'deepseek', model: 'deepseek-chat' });
      const { text } = await chat({ ...model, messages: [{ role: 'user', content: prompts[v] + sel }] });
      modal({ title: 'AI 辅助', body: `<div style="font-size:14px;line-height:1.8">${esc(text)}</div>` });
    } catch (e) { toast(e.message, 'err'); }
  });

  // 初始化
  applySettings();
  try {
    chapters = await getChapterList(source, item.bookUrl);
  } catch (e) {
    body.innerHTML = `<div class="empty"><div class="empty-title">目录加载失败</div><div class="muted">${esc(e.message)}</div></div>`;
    return;
  }
  const prog = await getProgress(item.id || (source.id + ':' + item.bookUrl));
  loadChapter(prog && prog.chapterIndex != null ? prog.chapterIndex : startChapter);
}
