/* ===== ThirdHub backend/proxy-server.js — 本地图片中转代理（解决防盗链图源：JM/部分漫画 CDN） =====
   用法：node proxy-server.js [端口]   （默认 8700）
   手机等其它设备使用时：node proxy-server.js 8700 0.0.0.0，浏览器设置
   「自有代理/服务器」或 proxy.backend 填 http://<电脑局域网IP>:8700
   端点：GET /?url=<目标>&headers=<JSON>  （headers 可选，防盗链图源必须带）
   注意：仅限本机/局域网自用，请勿公网裸奔（无鉴权） */
'use strict';
const http = require('http');
const port = parseInt(process.argv[2] || '8700', 10);
const host = process.argv[3] || '127.0.0.1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  /* v0.2：Chrome 私有网络访问(PNA)豁免 —— HTTPS 页面(thirdhub.pages.dev)访问局域网 IP 必须 */
  'Access-Control-Allow-Private-Network': 'true',
};
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const u = new URL(req.url, 'http://x');
  const target = u.searchParams.get('url');
  if (!target) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, name: 'ThirdHub Local Proxy', port, endpoints: ['/?url=<target>&headers=<json>'] }));
    return;
  }
  const headers = {};
  try {
    const h = u.searchParams.get('headers');
    if (h) Object.assign(headers, JSON.parse(h));
  } catch (e) {}
  if (!headers['User-Agent']) headers['User-Agent'] = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36';
  try {
    const r = await fetch(target, { method: req.method, headers, redirect: 'follow' });
    const out = { status: r.status, 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', ...CORS };
    res.writeHead(r.status, out);
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(port, host, () => console.log('ThirdHub Local Proxy running at http://' + host + ':' + port));
