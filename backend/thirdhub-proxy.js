/* ===== ThirdHub backend/thirdhub-proxy.js — Cloudflare Worker 通用代理 =====
   部署：wrangler deploy 或粘贴到 Cloudflare Dashboard Workers 编辑器
   用法：GET  https://your-worker.workers.dev/?url=<目标地址>
        POST https://your-worker.workers.dev/?url=<目标地址>  body: JSON {body, headers}
*/

const ALLOW_ALL = true; // 如需限制目标域名白名单，改为 false 并配置 ALLOWED_HOSTS
const ALLOWED_HOSTS = [];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ ok: true, name: 'ThirdHub Proxy', usage: '/?url=<target>' }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    let targetUrl;
    try { targetUrl = new URL(target); } catch (e) {
      return new Response('Invalid url', { status: 400, headers: CORS_HEADERS });
    }
    if (!ALLOW_ALL && !ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: CORS_HEADERS });
    }

    let body = null;
    const headers = {
      'User-Agent': request.headers.get('X-UA') || 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      'Accept': '*/*',
      'Referer': targetUrl.origin + '/',
    };

    if (request.method === 'POST') {
      try {
        const payload = await request.json();
        if (payload.headers) Object.assign(headers, payload.headers);
        body = payload.body || null;
      } catch (e) {
        body = await request.text().catch(() => null);
      }
    }

    try {
      const resp = await fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: 'follow',
      });
      const respHeaders = new Headers(CORS_HEADERS);
      const ct = resp.headers.get('content-type');
      if (ct) respHeaders.set('Content-Type', ct);
      return new Response(resp.body, { status: resp.status, headers: respHeaders });
    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 502, headers: CORS_HEADERS });
    }
  },
};
