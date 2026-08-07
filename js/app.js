/* ===== ThirdHub app.js — 应用入口 / 路由 / 初始化 ===== */
export const APP_VERSION = '2.0';

import { $, $$, icon, toast } from './ui.js';
import { getSetting, setSetting, on, emit, openDB, kvGet, kvSet } from './store.js';
import { initCloud } from './supabase.js';
import { initAuth } from './auth.js';
import { initSync } from './engine/sync-service.js';
import { checkUpdate } from './update-checker.js';
import { BOARDS, PROFILE_BOARD, MAX_TABS, boardById } from './boards.js';

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

/* ---------- 板块（底部导航）管理 ----------
   每个板块独立：未启用的板块不下载、不渲染；
   启用后首次切换时才动态 import 对应模块。 */
let activeBoards = [];      // 当前启用的板块（含固定「我的」）
const moduleCache = {};     // 板块 id → 已加载的模块
const rendered = new Set();
let currentTab = null;

async function loadEnabledTabs() {
  let tabs = await kvGet('ui:tabs', null);
  if (!Array.isArray(tabs)) tabs = null;
  tabs = (tabs || ['ai']).filter((id) => BOARDS.some((b) => b.id === id)).slice(0, MAX_TABS);
  if (!tabs.length) tabs = ['ai'];
  return tabs;
}

function buildChrome(tabIds) {
  activeBoards = [...tabIds.map(boardById), PROFILE_BOARD];
  $('#pages').innerHTML = activeBoards.map((b) => `<section class="page" id="page-${b.id}"></section>`).join('');
  $('#tabbar').innerHTML = activeBoards.map((b) =>
    `<button class="tab" data-tab="${b.id}"><span class="tab-ico" data-ico="${b.ico}"></span><span class="tab-label">${b.name}</span></button>`).join('');
  $$('#tabbar .tab-ico').forEach((s) => { s.innerHTML = icon(s.dataset.ico); });
  $$('#tabbar .tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  rendered.clear();
  currentTab = null;
}

/* v2.0：慢网/弱网加固 —— 板块模块加载带超时与自动重试，避免请求挂起导致永久转圈 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error((label || '模块') + '加载超时')), ms)),
  ]);
}

async function loadBoardModule(board, attempt = 0) {
  try {
    return await withTimeout(board.load(), 20000, board.name);
  } catch (e) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1200));
      return loadBoardModule(board, attempt + 1);
    }
    throw e;
  }
}

async function getRenderer(board) {
  if (!moduleCache[board.id]) moduleCache[board.id] = await loadBoardModule(board);
  const mod = moduleCache[board.id];
  return (page) => mod[board.fn](page, board.arg);
}

export async function switchTab(tab, force = false) {
  if (!activeBoards.some((b) => b.id === tab)) tab = activeBoards[0] ? activeBoards[0].id : 'ai';
  if (tab === currentTab && !force) return;
  $$('#tabbar .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.page').forEach((p) => p.classList.remove('active'));
  const page = $('#page-' + tab);
  if (!rendered.has(tab) || force) {
    page.innerHTML = '<div class="loading-row" style="margin-top:60px"><div class="spinner"></div></div>';
    const board = boardById(tab);
    try {
      const render = await getRenderer(board);
      page.innerHTML = '';
      await render(page);
      rendered.add(tab);
    } catch (e) {
      console.error('板块加载失败', e);
      page.innerHTML = `<div style="padding:80px 24px;text-align:center;color:var(--tx-3,#888)">
        <div style="font-size:15px;margin-bottom:16px">「${board.name}」加载失败，请检查网络后重试</div>
        <button class="btn btn-primary" data-retry type="button" style="padding:10px 28px">重新加载</button>
      </div>`;
      const btn = page.querySelector('[data-retry]');
      if (btn) btn.onclick = () => { rendered.delete(tab); delete moduleCache[tab]; switchTab(tab, true); };
      return;
    }
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

/* 导航栏板块变更后重建（「我的 → 导航栏管理」调用） */
export async function rebuildTabs(preferTab = null) {
  const tabs = await loadEnabledTabs();
  buildChrome(tabs);
  await applyNavPos();
  await switchTab(preferTab && tabs.includes(preferTab) ? preferTab : tabs[0], true);
}

/* ---------- 多端导航位置（桌面 / 移动 / 手表 · 个性化设置） ---------- */
const isWatchScreen = () => screen.width < 380 && 'ontouchstart' in window;
const isMobileScreen = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !isWatchScreen();
export async function applyNavPos() {
  const key = isWatchScreen() ? 'navWatch' : isMobileScreen() ? 'navMobile' : 'navDesktop';
  const pos = await getSetting(key);
  document.body.dataset.navpos = pos || 'bottom';
  // 桌面端「可折叠」：底部悬浮折叠钮
  $('#tab-fold-handle')?.remove();
  if (pos === 'fold' && !isMobileScreen() && !isWatchScreen()) {
    const h = document.createElement('button');
    h.id = 'tab-fold-handle';
    h.title = '折叠 / 展开导航栏';
    h.innerHTML = icon('menu');
    h.onclick = () => document.body.classList.toggle('nav-folded');
    document.body.appendChild(h);
  } else {
    document.body.classList.remove('nav-folded');
  }
}
window.addEventListener('th:navpos', applyNavPos);

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
  await initTheme();
  initSW();

  /* v1.7：设备日志钩子（尽早安装，捕获启动期错误） */
  try { const { installLogHooks } = await import('./modules/devlog.js'); installLogHooks(); } catch (e) {}

  /* v1.7：开屏动画（非首访且未关闭时展示，不阻塞启动） */
  try { const { maybeSplash } = await import('./modules/splash.js'); maybeSplash(); } catch (e) {}

  /* v1.9：先载入本地缓存的云端定价（离线也可用上次价格估算） */
  try { const { initPricing } = await import('./ai/ai-pricing.js'); await initPricing(); } catch (e) {}

  /* 云端初始化不阻塞启动：慢网环境下最多等 6 秒，其余时间后台继续 */
  const cloudReady = (async () => {
    try { await initCloud(); } catch (e) { console.warn('cloud 初始化失败', e); }
    try { await initAuth(); } catch (e) { console.warn('auth 初始化失败', e); }
    try { initSync(); } catch (e) { console.warn('sync 初始化失败', e); }
    /* v1.7：进入浏览器即拉取最新设置（多设备一致）；登记本设备 */
    try { const { initSettingsSync } = await import('./modules/settings-sync.js'); await initSettingsSync(); } catch (e) { console.warn('设置同步失败', e); }
    try { const { registerDevice } = await import('./modules/devices.js'); await registerDevice(); } catch (e) {}
    try { const { pullKeysFromCloud } = await import('./modules/keyvault.js'); await pullKeysFromCloud(); } catch (e) {}
    try { const { initSourceSync } = await import('./engine/source-sync.js'); await initSourceSync(); } catch (e) {}
    /* v1.9：云端模型定价 / 排行榜（管理员后台可维护） */
    try { const { syncCloudPrices } = await import('./ai/ai-pricing.js'); await syncCloudPrices(); } catch (e) {}
    try { const { syncCloudRankings } = await import('./ai/ai-rankings.js'); await syncCloudRankings(); } catch (e) {}
  })();
  await Promise.race([cloudReady, new Promise((r) => setTimeout(r, 6000))]);

  /* v1.7：回收站到期自动清理 */
  try { const { purgeRecycle } = await import('./modules/recycle-bin.js'); await purgeRecycle(); } catch (e) {}

  /* v1.7：应用锁门禁（开启后需先解锁才能进入） */
  try { const { gateIfLocked } = await import('./modules/applock.js'); await gateIfLocked(); } catch (e) {}

  /* 自动检查更新（可在「我的 → 全局设置 → 自动检查更新」中关闭） */
  try {
    if (await kvGet('update:auto', true)) {
      setTimeout(() => checkUpdate(false), 3500);
    }
  } catch (e) {}

  /* 首次进入：介绍 → 登录（可跳过）→ 新用户使用目的 */
  const { maybeOnboard } = await import('./modules/onboarding.js');
  await maybeOnboard();

  const tabs = await loadEnabledTabs();
  buildChrome(tabs);
  await applyNavPos();

  const startTab = (location.hash || '').replace('#', '');
  await switchTab(tabs.includes(startTab) || startTab === 'profile' ? startTab : tabs[0]);

  setTimeout(() => checkUpdate().catch(() => {}), 3000);

  window.__THIRDHUB__ = { version: APP_VERSION, switchTab, refreshTab, rebuildTabs };
  window.__TH_READY = true;  /* v2.0：安卓 WebView 看门狗据此判定线上版启动成功 */
  console.log('%cThirdHub v' + APP_VERSION + ' · 第三方科技', 'color:#3b5bfd;font-weight:bold');
}

/* app.js 会被 index.html(?v=x.y) 与 profile.js/update-checker.js(无参数) 以两个不同 URL 各加载一次，
   必须防止 boot() 重复执行（否则引导层、监听器都会翻倍） */
if (!window.__TH_BOOTED__) {
  window.__TH_BOOTED__ = true;
  boot().catch((e) => {
    console.error(e);
    document.body.innerHTML = '<div style="padding:60px 24px;text-align:center;color:#888">应用初始化失败，请刷新重试<br><br><button onclick="location.reload()" style="padding:10px 24px;border-radius:10px;background:#3b5bfd;color:#fff;border:none">刷新</button></div>';
  });
}
