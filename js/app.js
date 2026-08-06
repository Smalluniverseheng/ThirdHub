/* ===== ThirdHub app.js — 应用入口 / 路由 / 初始化 ===== */
export const APP_VERSION = '1.1';

import { $, $$, icon, toast } from './ui.js';
import { getSetting, setSetting, on, emit, openDB } from './store.js';
import { initCloud } from './supabase.js';
import { initAuth } from './auth.js';
import { initSync } from './engine/sync-service.js';
import { checkUpdate } from './update-checker.js';
import { renderDiscover } from './modules/discover.js';
import { renderAIChat } from './modules/ai-chat.js';
import { renderBookshelf } from './modules/bookshelf.js';
import { renderCategory } from './modules/category.js';
import { renderProfile } from './modules/profile.js';

/* ---------- 主题 ---------- */
async function initTheme() {
  let theme = await getSetting('theme');
  applyTheme(theme);
  on('setting:theme', applyTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    if ((await getSetting('theme')) === 'auto') applyTheme('auto');
  });
}
function applyTheme(theme) {
  const real = theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.body.dataset.theme = real;
}

/* ---------- Tab 路由 ---------- */
const TABS = ['discover', 'ai', 'bookshelf', 'category', 'profile'];
const rendered = new Set();
let currentTab = null;

const RENDERERS = {
  discover: renderDiscover,
  ai: renderAIChat,
  bookshelf: renderBookshelf,
  category: renderCategory,
  profile: renderProfile,
};

export async function switchTab(tab, force = false) {
  if (!TABS.includes(tab)) tab = 'discover';
  if (tab === currentTab && !force) return;
  const fromIdx = TABS.indexOf(currentTab);
  const toIdx = TABS.indexOf(tab);
  $$('#tabbar .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.page').forEach((p) => p.classList.remove('active', 'slide-left'));
  const page = $('#page-' + tab);
  if (fromIdx > -1 && toIdx < fromIdx) page.classList.add('slide-left');
  if (!rendered.has(tab) || force) {
    page.innerHTML = '';
    await RENDERERS[tab](page);
    rendered.add(tab);
  }
  requestAnimationFrame(() => page.classList.add('active'));
  currentTab = tab;
  emit('tab:' + tab);
  try { history.replaceState(null, '', '#' + tab); } catch (e) {}
}

export function refreshTab(tab) {
  rendered.delete(tab);
  if (currentTab === tab) switchTab(tab, true);
}

/* ---------- 图标注入 ---------- */
function injectTabIcons() {
  $$('#tabbar .tab-ico').forEach((s) => {
    s.innerHTML = icon(s.dataset.ico);
  });
}

/* ---------- Service Worker ---------- */
function initSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          emit('sw:update-available', reg);
        }
      });
    });
  }).catch((e) => console.warn('SW 注册失败', e));
}

/* ---------- 启动 ---------- */
async function boot() {
  await openDB();
  injectTabIcons();
  await initTheme();
  initSW();
  try { await initCloud(); } catch (e) { console.warn('cloud 初始化失败', e); }
  try { await initAuth(); } catch (e) { console.warn('auth 初始化失败', e); }
  try { initSync(); } catch (e) { console.warn('sync 初始化失败', e); }

  $$('#tabbar .tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  const startTab = (location.hash || '').replace('#', '');
  await switchTab(TABS.includes(startTab) ? startTab : 'discover');

  setTimeout(() => checkUpdate().catch(() => {}), 3000);

  window.__THIRDHUB__ = { version: APP_VERSION, switchTab, refreshTab };
  console.log('%cThirdHub v' + APP_VERSION + ' · 第三方科技', 'color:#3b5bfd;font-weight:bold');
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = '<div style="padding:60px 24px;text-align:center;color:#888">应用初始化失败，请刷新重试<br><br><button onclick="location.reload()" style="padding:10px 24px;border-radius:10px;background:#3b5bfd;color:#fff;border:none">刷新</button></div>';
});
