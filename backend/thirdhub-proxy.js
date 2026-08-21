/* ===== ThirdHub backend/thirdhub-proxy.js — Cloudflare Worker =====
   功能：
   1. 通用代理：GET/POST /?url=<目标地址>
   2. 邮箱验证码（无状态，HMAC 签名，不落库）：
      POST /email/send   { email }                    → { ok, expiry, sig }
      POST /email/verify { email, code, expiry, sig } → { ok }
   部署：wrangler deploy 或粘贴到 Cloudflare Dashboard Workers 编辑器
*/

import { connect } from 'cloudflare:sockets';

const ALLOW_ALL = true;
const ALLOWED_HOSTS = [];

/* ---- 邮箱验证码配置（163 SMTP） ---- */
const SMTP_HOST = 'smtp.163.com';
const SMTP_PORT = 465;
const SMTP_USER = 'dipucai728937@163.com';
const SMTP_PASS = 'ZEx6fxMsnbyDfnQd';          // SMTP 授权码
const MAIL_FROM = 'dipucai728937@163.com';
const CODE_SECRET = 'th-email-code::' + SMTP_PASS; // HMAC 密钥（派生，不落库）
const CODE_TTL_MS = 10 * 60 * 1000;                 // 验证码 10 分钟有效

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/* ---------- HMAC 签名 ---------- */
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- SMTP（163 SSL 465） ---------- */
async function sendMail163(to, subject, text) {
  const sock = connect({ hostname: SMTP_HOST, port: SMTP_PORT }, { secureTransport: 'on' });
  const writer = sock.writable.getWriter();
  const reader = sock.readable.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buf = '';

  const readLine = async () => {
    for (;;) {
      const i = buf.indexOf('\n');
      if (i >= 0) { const line = buf.slice(0, i + 1); buf = buf.slice(i + 1); return line.trim(); }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP 连接被关闭');
      buf += dec.decode(value, { stream: true });
    }
  };
  // 读取一个完整响应（处理多行 "250-..." 续行）
  const readReply = async () => {
    let code = '';
    for (;;) {
      const line = await readLine();
      const m = line.match(/^(\d{3})([ -])/);
      if (!m) continue;
      code = m[1];
      if (m[2] === ' ') break;
    }
    return code;
  };
  const cmd = async (c, expect) => {
    await writer.write(enc.encode(c + '\r\n'));
    const code = await readReply();
    if (expect && code !== expect) throw new Error(`SMTP ${c.split(' ')[0]} 失败（${code}）`);
    return code;
  };

  try {
    const greet = await readReply();
    if (greet !== '220') throw new Error('SMTP 握手失败（' + greet + '）');
    await cmd('EHLO thirdhub.app', '250');
    await cmd('AUTH LOGIN', '334');
    await cmd(btoa(SMTP_USER), '334');
    await cmd(btoa(SMTP_PASS), '235');
    await cmd(`MAIL FROM:<${MAIL_FROM}>`, '250');
    await cmd(`RCPT TO:<${to}>`, '250');
    await cmd('DATA', '354');
    const headers = [
      `From: ThirdHub <${MAIL_FROM}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      btoa(unescape(encodeURIComponent(text))).replace(/.{76}/g, '$&\r\n'),
      '.',
    ].join('\r\n');
    await writer.write(enc.encode(headers + '\r\n'));
    const done = await readReply();
    if (done !== '250') throw new Error('邮件发送被拒（' + done + '）');
    await cmd('QUIT').catch(() => {});
  } finally {
    try { writer.releaseLock(); reader.releaseLock(); sock.close(); } catch (e) {}
  }
}

/* ---------- 验证码端点 ---------- */
async function handleEmailSend(request) {
  const { email } = await request.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: '邮箱格式不正确' }, 400);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  const expiry = Date.now() + CODE_TTL_MS;
  const sig = await hmac(CODE_SECRET, `${email.toLowerCase()}|${code}|${expiry}`);
  await sendMail163(
    email,
    'ThirdHub 注册验证码',
    `【ThirdHub】你的注册验证码是：${code}\n\n10 分钟内有效。若非本人操作请忽略本邮件。`,
  );
  return json({ ok: true, expiry, sig });
}

async function handleEmailVerify(request) {
  const { email, code, expiry, sig } = await request.json().catch(() => ({}));
  if (!email || !code || !expiry || !sig) return json({ ok: false, error: '参数不完整' }, 400);
  if (Date.now() > +expiry) return json({ ok: false, error: '验证码已过期，请重新发送' }, 400);
  const expect = await hmac(CODE_SECRET, `${String(email).toLowerCase()}|${code}|${expiry}`);
  if (expect !== sig) return json({ ok: false, error: '验证码错误' }, 400);
  return json({ ok: true });
}

/* ---------- 通用代理 ---------- */
async function handleProxy(request) {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('url');
  if (!target) {
    return json({ ok: true, name: 'ThirdHub Proxy', endpoints: ['/?url=<target>', '/email/send', '/email/verify'] });
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
    const resp = await fetch(target, { method: request.method, headers, body, redirect: 'follow' });
    const respHeaders = new Headers(CORS_HEADERS);
    const ct = resp.headers.get('content-type');
    if (ct) respHeaders.set('Content-Type', ct);
    return new Response(resp.body, { status: resp.status, headers: respHeaders });
  } catch (e) {
    return new Response('Proxy error: ' + e.message, { status: 502, headers: CORS_HEADERS });
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const path = new URL(request.url).pathname;
    try {
      if (path === '/email/send' && request.method === 'POST') return await handleEmailSend(request);
      if (path === '/email/verify' && request.method === 'POST') return await handleEmailVerify(request);
      return await handleProxy(request);
    } catch (e) {
      return json({ ok: false, error: e.message || '服务器错误' }, 500);
    }
  },
};
