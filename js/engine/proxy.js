/* ===== ThirdHub js/engine/proxy.js — CORS 代理策略（三级回退） =====
   1. 后端代理（自建 Cloudflare Worker）→ 2. 公共 CORS 代理 → 3. 直接请求 */
import { kvGet, kvSet } from '../store.js';

const PUBLIC_PROXIES = [
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
];

export async function getBackendProxy() { return await kvGet('proxy:backend', 'https://thirdhub-proxy.1829487897.workers.dev/'); }
export async function setBackendProxy(url) { await kvSet('proxy:backend', (url || '').trim()); }

/* v1.9 模块代理链路：按通道尝试取回文本，成功返回，全部失败返回 null */
async function tryHop(hop, conf, url, headers) {
  try {
    if (hop === 'direct') {
      const r = await fetch(url, { headers });
      return r.ok ? await r.text() : null;
    }
    if (hop === 'custom') {
      if (!conf.url) return null;
      const base = conf.url.replace(/\/$/, '') + '/';
      const r = await fetch(base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url));
      return r.ok ? await r.text() : null;
    }
    if (hop === 'cloud') {
      const { currentUser, levelById } = await import('../auth.js');
      const u = await currentUser();
      const lv = levelById(u ? u.level : 'guest');
      if (!(u && lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now()))) return null;
      const backend = await getBackendProxy();
      if (!backend) return null;
      const r = await fetch(backend + (backend.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url));
      return r.ok ? await r.text() : null;
    }
  } catch (e) { return null; }
  return null;
}

export async function httpGet(url, headers = {}) {
  /* v1.9 模块代理（设置分级）：内容连接器可单独指定 自有代理 / 云端代理 / 自动优先级链路 */
  try {
    const confAll = await kvGet('proxy:mod', {});
    const conf = confAll.content;
    if (conf && conf.mode === 'auto') {
      const prio = await kvGet('proxy:prio', ['cloud', 'custom', 'direct']);
      for (const hop of prio) {
        const t = await tryHop(hop, conf, url, headers);
        if (t != null) return t;
      }
      // 自动链路全部失败 → 落到下方公共回退
    } else if (conf && (conf.mode === 'custom' || conf.mode === 'cloud')) {
      const t = await tryHop(conf.mode, conf, url, headers);
      if (t != null) return t;
      // 显式代理连接失败 → 自动弹回直连并提示
      try {
        confAll.content = { ...conf, mode: 'direct' };
        await kvSet('proxy:mod', confAll);
        const { toast } = await import('../ui.js');
        toast(conf.mode === 'custom' ? '自有代理连接失败，已自动切回直连' : '云端代理连接失败，已自动切回直连', 'err');
      } catch (e) {}
      const d = await tryHop('direct', conf, url, headers);
      if (d != null) return d;
      throw new Error('网络请求失败：自有代理与直连均不可用');
    } else if (conf && conf.mode === 'direct') {
      const r = await fetch(url, { headers });
      if (r.ok) return await r.text();
      throw new Error('直连失败');
    }
  } catch (e) { if (e && (e.message === '直连失败' || e.message.startsWith('网络请求失败'))) throw e; }
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
