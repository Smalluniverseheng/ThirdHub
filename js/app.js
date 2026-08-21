/* ===== ThirdHub app.js — 应用入口 / 路由 / 初始化 ===== */
export const APP_VERSION = '6.8';
window.__TH_CSS_V = APP_VERSION; /* v2.7：CSS 按需加载的版本戳 */

import { $, $$, icon, toast, loadCss } from './ui.js';
import { getSetting, setSetting, on, emit, openDB, kvGet, kvSet } from './store.js';
import { initCloud } from './supabase.js';
import { initAuth } from './auth.js';
import { initSync } from './engine/sync-service.js';
import { checkUpdate } from './update-checker.js';
import { BOARDS, PROFILE_BOARD, MAX_TABS, boardById } from './boards.js';
import { initDeviceAdapt, getDevice } from './device-adapt.js';

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
  /* v6.0：分端导航配置（手表/移动/桌面），回退旧 ui:tabs */
  const dev = getDevice();
  const key = dev === 'watch' ? 'nav:tabs-watch' : (dev === 'desktop' ? 'nav:tabs-desktop' : 'nav:tabs-mobile');
  let tabs = await kvGet(key, null);
  if (!Array.isArray(tabs)) tabs = await kvGet('ui:tabs', null);
  if (!Array.isArray(tabs)) tabs = null;
  tabs = (tabs || ['ai', 'search', 'read']).filter((id) => BOARDS.some((b) => b.id === id));
  /* v3.7：小说/漫画/有声合并为「阅读」板块——旧导航自动迁移（一次性） */
  const READ_GROUP = ['novel', 'comic', 'audio'];
  if (tabs.some((id) => READ_GROUP.includes(id))) {
    const first = tabs.findIndex((id) => READ_GROUP.includes(id));
    tabs = tabs.filter((id) => !READ_GROUP.includes(id));
    if (!tabs.includes('read')) tabs.splice(Math.min(first, tabs.length), 0, 'read');
    kvSet('ui:tabs', tabs).catch(() => {});
  }
  if (!tabs.length) tabs = ['ai'];
  return tabs;
}

function buildChrome(tabIds) {
  activeBoards = [...tabIds.map(boardById), PROFILE_BOARD];
  $('#pages').innerHTML = activeBoards.map((b) => `<section class="page" id="page-${b.id}"></section>`).join('');
  /* v4.8：导航栏重构 —— 板块装入可滚动容器 + 跟随指示器；「我的」固定底部；左下角折叠钮 */
  $('#tabbar').innerHTML = `
    <div class="tab-scroll" data-role="tabscroll">
      ${activeBoards.map((b) => `<button class="tab${b.id === 'profile' ? ' tab-pin' : ''}" data-tab="${b.id}"><span class="tab-ico" data-ico="${b.ico}"></span><span class="tab-label">${b.name}</span></button>`).join('')}
      <div id="tab-indicator"></div>
    </div>
    <button id="tab-collapse" title="折叠 / 展开导航栏"></button>`;
  $$('#tabbar .tab-ico').forEach((s) => { s.innerHTML = icon(s.dataset.ico); });
  $$('#tabbar .tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#tab-collapse').onclick = toggleSidebarCollapsed;
  initTabIndicator();
  initTabSorting(); /* v5.3：长按导航项可调整顺序（各端独立保存） */
  rendered.clear();
  currentTab = null;
}

/* ---------- v4.8 导航栏交互：折叠持久化 + 移动端指示器跟随 ---------- */
function initTabIndicator() {
  const scroll = $('[data-role="tabscroll"]', $('#tabbar'));
  if (!scroll) return;
  const update = () => {
    const active = scroll.querySelector('.tab.on');
    if (!active) return;
    const ind = $('#tab-indicator');
    if (!ind) return;
    ind.style.transform = `translateX(${active.offsetLeft - scroll.scrollLeft}px)`;
    ind.style.width = `${active.offsetWidth}px`;
  };
  scroll.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  requestAnimationFrame(update);
}
function toggleSidebarCollapsed() {
  const collapsed = localStorage.getItem('sidebar:collapsed') === '1';
  const next = !collapsed;
  localStorage.setItem('sidebar:collapsed', next ? '1' : '0');
  applySidebarState();
}
function applySidebarState() {
  const collapsed = localStorage.getItem('sidebar:collapsed') === '1';
  const tb = $('#tabbar');
  if (!tb) return;
  tb.classList.toggle('collapsed', collapsed);
  const btn = $('#tab-collapse');
  if (btn) btn.innerHTML = collapsed ? icon('arrowR') : icon('back');
}
/* v5.3：长按导航项 → 排序面板（各端独立顺序，保存后重建导航） */
let _tabPressTimer = null;
function initTabSorting() {
  const scroll = $('[data-role="tabscroll"]', $('#tabbar'));
  if (!scroll) return;
  const cancel = () => { clearTimeout(_tabPressTimer); _tabPressTimer = null; };
  const press = (e) => {
    const tab = e.target.closest && e.target.closest('.tab');
    if (!tab || tab.dataset.tab === 'profile' || _tabPressTimer) return;
    _tabPressTimer = setTimeout(() => { _tabPressTimer = null; openTabSort(); }, 600);
  };
  scroll.addEventListener('touchstart', press, { passive: true });
  scroll.addEventListener('touchend', cancel, { passive: true });
  scroll.addEventListener('touchmove', cancel, { passive: true });
  scroll.addEventListener('mousedown', press);
  scroll.addEventListener('mouseup', cancel);
  scroll.addEventListener('mouseleave', cancel);
}
async function openTabSort() {
  const dev = getDevice();
  const key = dev === 'watch' ? 'nav:tabs-watch' : (dev === 'desktop' ? 'nav:tabs-desktop' : 'nav:tabs-mobile');
  let order = await kvGet(key, null);
  if (!Array.isArray(order) || !order.length) order = await kvGet('ui:tabs', ['ai', 'search', 'read']);
  order = [...order];
  const body = el('<div><div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">长按已结束：拖动下方按钮调整导航顺序（仅当前设备端生效），松手即保存。</div><div class="col gap8" data-role="rows"></div></div>');
  const rows = $('[data-role="rows"]', body);
  const render = () => {
    rows.innerHTML = order.map((id, i) => {
      const b = boardById(id);
      if (!b) return '';
      return `<div class="row gap8" style="align-items:center;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:9px 12px">
        <span class="list-ico">${icon(b.ico)}</span>
        <span class="grow" style="font-size:14px;font-weight:600">${b.name}</span>
        <button class="icon-btn" data-mv="-1" data-i="${i}" style="width:32px;height:32px" ${i === 0 ? 'disabled' : ''}>${icon('back')}</button>
        <button class="icon-btn" data-mv="1" data-i="${i}" style="width:32px;height:32px" ${i === order.length - 1 ? 'disabled' : ''}>${icon('arrowR')}</button>
      </div>`;
    }).join('');
    $$('[data-mv]', rows).forEach((btn) => btn.onclick = () => {
      const i = +btn.dataset.i, mv = +btn.dataset.mv;
      const j = i + mv;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      render();
    });
  };
  render();
  const m = modal({
    title: '导航顺序（' + ({ watch: '手表', desktop: '桌面', mobile: '移动' })[dev] + '端）', body,
    footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存顺序</button>',
  });
  $('[data-a="cancel"]', m.mask).onclick = m.close;
  $('[data-a="save"]', m.mask).onclick = async () => {
    await kvSet(key, order);
    m.close();
    const onTab = document.querySelector('#tabbar .tab.on');
    rebuildTabs(onTab ? onTab.dataset.tab : null);
    toast('导航顺序已保存', 'ok');
  };
}
export function refreshTabIndicator() {
  requestAnimationFrame(() => {
    const scroll = $('[data-role="tabscroll"]', $('#tabbar'));
    if (!scroll) return;
    const active = scroll.querySelector('.tab.on');
    const ind = $('#tab-indicator');
    if (active && ind) {
      ind.style.transform = `translateX(${active.offsetLeft - scroll.scrollLeft}px)`;
      ind.style.width = `${active.offsetWidth}px`;
    }
  });
}

/* v2.0：慢网/弱网加固 —— 板块模块加载带超时与自动重试，避免请求挂起导致永久转圈 */
function timedImport(spec, ms = 15000) {
  return withTimeout(import(spec), ms, spec);
}

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

let switchSeq = 0; /* v6.1：切换令牌 —— 快速连点时旧渲染结果作废，杜绝页面重叠 */
export async function switchTab(tab, force = false) {
  if (!activeBoards.some((b) => b.id === tab)) tab = activeBoards[0] ? activeBoards[0].id : 'ai';
  if (tab === currentTab && !force) return;
  const seq = ++switchSeq;
  $$('#tabbar .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.page').forEach((p) => p.classList.remove('active'));
  const page = $('#page-' + tab);
  if (!rendered.has(tab) || force) {
    page.innerHTML = '<div class="loading-row" style="margin-top:60px"><div class="spinner"></div></div>';
    const board = boardById(tab);
    try {
      /* v2.7：板块样式按需加载（首次切换时才下载对应 CSS） */
      if (board.css) await Promise.all(board.css.map(loadCss));
      const render = await getRenderer(board);
      if (seq !== switchSeq) return; /* v6.1：期间用户已切走，丢弃本次渲染 */
      page.innerHTML = '';
      await render(page);
      if (seq !== switchSeq) return;
      rendered.add(tab);
    } catch (e) {
      if (seq !== switchSeq) return;
      /* v4.3：带上板块名与真实错误信息，避免日志只剩 {} */
      console.error(`板块加载失败[${board.id}/${board.name}]`, e && e.message ? `${e.name || 'Error'}: ${e.message}` : e, e && e.stack ? '\n' + e.stack : '');
      page.innerHTML = `<div style="padding:80px 24px;text-align:center;color:var(--tx-3,#888)">
        <div style="font-size:15px;margin-bottom:16px">「${board.name}」加载失败，请检查网络后重试</div>
        <button class="btn btn-primary" data-retry type="button" style="padding:10px 28px">重新加载</button>
      </div>`;
      const btn = page.querySelector('[data-retry]');
      if (btn) btn.onclick = () => { rendered.delete(tab); delete moduleCache[tab]; switchTab(tab, true); };
      return;
    }
  }
  if (seq !== switchSeq) return;
  requestAnimationFrame(() => { if (seq === switchSeq) page.classList.add('active'); });
  currentTab = tab;
  emit('tab:' + tab);
  refreshTabIndicator();
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
const isWatchScreen = () => getDevice() === 'watch';
const isMobileScreen = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !isWatchScreen();
export async function applyNavPos() {
  const key = isWatchScreen() ? 'navWatch' : isMobileScreen() ? 'navMobile' : 'navDesktop';
  const pos = await getSetting(key);
  document.body.dataset.navpos = pos || 'bottom';
  applySidebarState(); /* v4.8：恢复侧栏折叠持久化状态 */
  refreshTabIndicator();
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
/* v4.2：屏幕形态变化（折叠展开/旋转/缩放窗口）后重判导航模式 */
on('th:device', applyNavPos);

/* v4.8：全局搜索快捷键 Ctrl/Cmd + K */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    switchTab('search').then(() => emit('search:focus')).catch(() => {});
  }
});

/* ---------- Service Worker ---------- */
function initSW() {
  if (!('serviceWorker' in navigator)) return;
  /* v2.0：安卓 App 内不注册 SW —— App 已由原生层用内置包直答（更快更稳），
     旧 SW 缓存只会带来脏缓存风险；浏览器端保持 PWA 能力不变 */
  try { if (window.ThirdHubNative && window.ThirdHubNative.isNative && window.ThirdHubNative.isNative()) return; } catch (e) {}
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
  initDeviceAdapt(); /* v4.2：多端屏幕自适应，尽早打标 data-device */
  await openDB();
  await initTheme();
  initSW();

  /* v1.7：设备日志钩子（尽早安装，捕获启动期错误） */
  try { const { installLogHooks } = await timedImport('./modules/devlog.js'); installLogHooks(); } catch (e) {}

  /* v1.7：开屏动画（非首访且未关闭时展示，不阻塞启动） */
  try { const { maybeSplash } = await timedImport('./modules/splash.js'); maybeSplash(); } catch (e) {}

  /* v1.7：应用锁门禁（开启后需先解锁才能进入，本地判定、快速） */
  try { const { gateIfLocked } = await timedImport('./modules/applock.js'); await gateIfLocked(); } catch (e) {}

  /* v4.9：引导页前先初始化云端 —— 引导页登录表单依赖 hasCloud() 判断，
     原顺序在首屏后才 initCloud，导致新用户登录页永远显示「云端未配置」 */
  try { await initCloud(); } catch (e) { console.warn('cloud 初始化失败', e); }

  /* 首次进入：介绍 → 登录（可跳过）→ 新用户使用目的 */
  const { maybeOnboard } = await timedImport('./modules/onboarding.js');
  await maybeOnboard();

  /* v2.7：先渲染首屏板块，云端/定价/回收站等全部移到首屏之后的空闲任务，
     做到「用到哪个模块才加载哪个模块」，不再启动时一口气全部加载 */
  const tabs = await loadEnabledTabs();
  buildChrome(tabs);
  await applyNavPos();
  const startTab = (location.hash || '').replace('#', '');
  await switchTab(tabs.includes(startTab) || startTab === 'profile' ? startTab : tabs[0]);

  /* 首屏之后的后台任务（不阻塞交互；登录态本地有缓存，云端就绪后自动同步） */
  setTimeout(async () => {
    try { const { initPricing } = await timedImport('./ai/ai-pricing.js'); await initPricing(); } catch (e) {}
    try { const okc = await initCloud(); if (!okc) setTimeout(() => initCloud().catch(() => {}), 4000); } catch (e) { console.warn('cloud 初始化失败', e); setTimeout(() => initCloud().catch(() => {}), 4000); }
    try { await initAuth(); } catch (e) { console.warn('auth 初始化失败', e); }
    try { initSync(); } catch (e) { console.warn('sync 初始化失败', e); }
    try { const { initSettingsSync } = await timedImport('./modules/settings-sync.js'); await initSettingsSync(); } catch (e) { console.warn('设置同步失败', e); }
    try { const { registerDevice } = await timedImport('./modules/devices.js'); await registerDevice(); } catch (e) {}
    try { const { pullKeysFromCloud } = await timedImport('./modules/keyvault.js'); await pullKeysFromCloud(); } catch (e) {}
    try { const { upgradeLegacySources } = await timedImport('./engine/source-service.js'); await upgradeLegacySources(); } catch (e) {}
    try { const { initSourceSync } = await timedImport('./engine/source-sync.js'); await initSourceSync(); } catch (e) {}
    try { const { syncCloudPrices } = await timedImport('./ai/ai-pricing.js'); await syncCloudPrices(); } catch (e) {}
    try { const { syncCloudRankings } = await timedImport('./ai/ai-rankings.js'); await syncCloudRankings(); } catch (e) {}
    try { const { purgeRecycle } = await timedImport('./modules/recycle-bin.js'); await purgeRecycle(); } catch (e) {}
  }, 60);

  /* 自动检查更新（可在「我的 → 全局设置 → 自动检查更新」中关闭） */
  try {
    if (await kvGet('update:auto', true)) {
      setTimeout(() => checkUpdate(false), 3500);
    }
  } catch (e) {}

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
