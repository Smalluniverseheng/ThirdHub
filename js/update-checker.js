/* ===== ThirdHub update-checker.js — 系统更新推送检查 ===== */
import { APP_VERSION } from './app.js';
import { kvGet, kvSet } from './store.js';
import { modal, icon, toast } from './ui.js';

/* 远程版本信息来源优先级：
   1. 云端 Supabase app_updates 表（管理后台推送）
   2. 站点根目录 version.json（部署时更新） */

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export async function checkUpdate(manual = false) {
  /* 安卓 WebView 壳：更新交给原生更新器（后台下载 APK，完成后提示安装） */
  try {
    if (window.ThirdHubNative && window.ThirdHubNative.isNative && window.ThirdHubNative.isNative()) {
      window.ThirdHubNative.checkAppUpdate(!!manual);
      return;
    }
  } catch (e) {}
  let info = null;
  // 1. 云端
  try {
    const { getSupabase, hasCloud } = await import('./supabase.js');
    if (hasCloud()) {
      const { data } = await getSupabase().from('th_app_updates')
        .select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) info = { version: data.version, type: data.type, title: data.title, content: data.content, downloadUrl: data.download_url };
    }
  } catch (e) {}
  // 2. version.json
  if (!info) {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) info = await r.json();
    } catch (e) {}
  }
  if (!info || !info.version) { if (manual) toast('当前已是最新版本'); return; }

  if (cmpVer(info.version, APP_VERSION) <= 0) { if (manual) toast('当前已是最新版本'); return; }

  // 可选更新且用户已跳过该版本
  const skipped = await kvGet('update:skip', '');
  if (info.type !== 'force' && skipped === info.version && !manual) return;

  showUpdateDialog(info);
}

function showUpdateDialog(info) {
  const force = info.type === 'force';
  const m = modal({
    title: info.title || `ThirdHub v${info.version} 更新`,
    center: true,
    body: `
      <div class="row gap8 mb8">
        <span class="tag tag-blue">v${APP_VERSION} → v${info.version}</span>
        ${force ? '<span class="tag tag-red">强制更新</span>' : '<span class="tag tag-green">可选更新</span>'}
      </div>
      <div style="font-size:14px;line-height:1.8;color:var(--text-secondary);white-space:pre-wrap">${(info.content || '').replace(/</g, '&lt;')}</div>`,
    footer: `
      ${force ? '' : '<button class="btn grow" data-a="later">稍后更新</button>'}
      <button class="btn btn-primary grow" data-a="now">${icon('download')} 立即更新</button>`,
    onClose: () => {},
  });
  const later = m.mask.querySelector('[data-a="later"]');
  if (later) later.onclick = async () => { await kvSet('update:skip', info.version); m.close(); };
  m.mask.querySelector('[data-a="now"]').onclick = async () => {
    // PWA：清缓存 + 刷新拉取新版本
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach((r) => r.update());
      }
    } catch (e) {}
    toast('正在更新…');
    setTimeout(() => location.reload(true), 600);
  };
  if (force) {
    // 强制更新不允许关闭
    m.mask.querySelector('.modal-close').style.display = 'none';
    m.mask.addEventListener('click', (e) => { if (e.target === m.mask) e.stopPropagation(); }, true);
  }
}
