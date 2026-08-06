/* ===== ThirdHub js/engine/proxy.js — CORS 代理策略（三级回退） =====
   1. 后端代理（自建 Cloudflare Worker）→ 2. 公共 CORS 代理 → 3. 直接请求 */
import { kvGet, kvSet } from '../store.js';

const PUBLIC_PROXIES = [
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
];

export async function getBackendProxy() { return await kvGet('proxy:backend', ''); }
export async function setBackendProxy(url) { await kvSet('proxy:backend', (url || '').trim()); }

export async function httpGet(url, headers = {}) {
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
