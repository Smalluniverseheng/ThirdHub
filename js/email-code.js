/* ===== ThirdHub js/email-code.js — 邮箱验证码（Supabase Edge Function） =====
   服务端为 Supabase Edge Function「email-code」（163 SMTP 发信，验证码存库校验）：
   POST { action: 'send',   email }        → { ok }
   POST { action: 'verify', email, code }  → { ok }
   验证码 10 分钟有效；同一邮箱 59 秒内不可重复发送；连续错 5 次需重新发送。 */
const API = 'https://mxvxlgjzeboktufumxbp.supabase.co/functions/v1/email-code';

async function call(body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `请求失败（${r.status}），请稍后再试`);
    return j;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('网络超时，请检查网络后重试');
    if (e && /Failed to fetch|NetworkError/i.test(e.message || '')) throw new Error('网络连接失败，请检查网络后重试');
    throw e;
  } finally { clearTimeout(t); }
}

/* 发送验证码；成功返回 { ok:true }，失败抛出中文错误 */
export async function sendEmailCode(email) {
  return await call({ action: 'send', email }, 30000);
}

/* 校验验证码；成功返回 true，失败抛出中文错误 */
export async function verifyEmailCode(email, code) {
  await call({ action: 'verify', email, code }, 15000);
  return true;
}
