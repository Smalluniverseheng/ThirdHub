/* ===== ThirdHub js/email-code.js — 邮箱验证码（Worker 无状态签发） =====
   服务端为 Cloudflare Worker（backend/thirdhub-proxy.js）：
   POST /email/send   { email }                    → { ok, expiry, sig }
   POST /email/verify { email, code, expiry, sig } → { ok } */
import { kvGet } from './store.js';

const DEFAULT_API = 'https://thirdhub-proxy.1829487897.workers.dev';

async function apiBase() {
  return (await kvGet('email:api', '')) || DEFAULT_API;
}

export async function sendEmailCode(email) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch((await apiBase()) + '/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `发送失败（${r.status}）`);
    return j; // { ok, expiry, sig }
  } finally { clearTimeout(t); }
}

export async function verifyEmailCode(email, code, expiry, sig) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch((await apiBase()) + '/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, expiry, sig }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || '验证失败');
    return true;
  } finally { clearTimeout(t); }
}
