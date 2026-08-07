/* ===== ThirdHub js/engine/proxy.js — CORS 代理策略（三级回退） =====
   1. 后端代理（自建 Cloudflare Worker）→ 2. 公共 CORS 代理 → 3. 直接请求 */
import { kvGet, kvSet } from '../store.js';

const PUBLIC_PROXIES = [
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
];

export async function getBackendProxy() { return await kvGet('proxy:backend', 'https://thirdhub-proxy.1829487897.workers.dev/'); }
export async function setBackendProxy(url) { await kvSet('proxy:backend', (url || '').trim()); }

export async function httpGet(url, headers = {}) {
  /* v1.7 模块代理（设置分级）：内容连接器可单独指定 自有代理 / 云端代理 */
  try {
    const conf = (await kvGet('proxy:mod', {})).content;
    if (conf && conf.mode === 'custom' && conf.url) {
      const base = conf.url.replace(/\/$/, '') + '/';
      const r = await fetch(base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url));
      if (r.ok) return await r.text();
    }
    if (conf && conf.mode === 'cloud') {
      const { currentUser, levelById } = await import('../auth.js');
      const u = await currentUser();
      const lv = levelById(u ? u.level : 'guest');
      if (u && lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now())) {
        const backend = await getBackendProxy();
        const r = await fetch(backend + (backend.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url));
        if (r.ok) return await r.text();
      }
    }
    if (conf && conf.mode === 'direct') {
      const r = await fetch(url, { headers });
      if (r.ok) return await r.text();
      throw new Error('直连失败');
    }
  } catch (e) { if (e && e.message === '直连失败') throw e; }
  const backend = await getBackendProxy();
  // 1. 后端代理
  if (backend) {
    try {
      const r = await fetch(backend + (backend.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url));
      if (r.ok) return await r.text();
    } catch (e) {}
  }
  // 2. 直接请求
  try {
    const r = await fetch(url, { headers });
    if (r.ok) return await r.text();
  } catch (e) {}
  // 3. 公共代理
  for (const wrap of PUBLIC_PROXIES) {
    try {
      const r = await fetch(wrap(url));
      if (r.ok) return await r.text();
    } catch (e) {}
  }
  throw new Error('网络请求失败');
}
