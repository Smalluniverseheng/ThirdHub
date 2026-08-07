/* ===== ThirdHub _worker.js — Cloudflare Pages 高级模式 Worker =====
   职责：
   1. /api/v1/health            云端后端健康检查（携带登录令牌时返回会员状态）
   2. /api/v1/chat/completions  云端会员后端：SSE 流式对话（与本地后端同一 Wire Protocol）
   3. 其余路径                   回退到静态资产（env.ASSETS）

   会员判定（与前端 js/auth.js 一致）：付费等级 planet/star/galaxy/universe 且未过期。
   安全说明：SUPABASE_ANON 为公开匿名 Key（前端代码中本就可见）；
   用户的厂商 API Key 仅随单次请求转发到对应厂商接口，本 Worker 不保存、不记录。 */

const SUPABASE_URL = 'https://mxvxlgjzeboktufumxbp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODM5OTcsImV4cCI6MjA5OTk1OTk5N30.QjSLfYAFhwX72YSeAcbTN5O2_PDLaNcv76HhdGJsqpo';

const MEMBER_LEVELS = ['planet', 'star', 'galaxy', 'universe'];
const VERSION = '0.1.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

/* ---------- 会员鉴权：Supabase JWT → th_profiles 等级 ---------- */
async function checkAuth(request, { requireMember = true } = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, error: '请先登录 ThirdHub 账号', needLogin: true };

  let user;
  try {
    const uresp = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token },
    });
    if (!uresp.ok) return { ok: false, status: 401, error: '登录状态已过期，请重新登录', needLogin: true };
    user = await uresp.json();
  } catch (e) {
    return { ok: false, status: 502, error: '账号服务暂时不可用，请稍后重试' };
  }

  let level = 'satellite';
  let expireAt = null;
  try {
    const presp = await fetch(
      SUPABASE_URL + '/rest/v1/th_profiles?id=eq.' + encodeURIComponent(user.id) + '&select=level,expire_at',
      { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token } },
    );
    if (presp.ok) {
      const rows = await presp.json();
      if (rows && rows[0]) {
        level = rows[0].level || 'satellite';
        expireAt = rows[0].expire_at || null;
      }
    }
  } catch (e) { /* 读不到等级按非会员处理 */ }

  const member = MEMBER_LEVELS.includes(level) && (!expireAt || new Date(expireAt).getTime() > Date.now());
  if (requireMember && !member) {
    return { ok: false, status: 402, error: '云端后端是会员功能，开通会员后即可使用', needMember: true, level, member: false, user };
  }
  return { ok: true, user, level, member };
}

/* ---------- 上游 LLM（OpenAI 兼容 / Anthropic 流式） ---------- */
const PROVIDER_BASES = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  aliyun: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  perplexity: 'https://api.perplexity.ai',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
  xiaomi: 'https://api.xiaomimimo.com/v1',
};

function resolveBase(provider, bodyBase) {
  // 云端安全：仅允许 https 覆盖地址
  if (bodyBase && /^https:\/\//i.test(bodyBase)) return bodyBase.replace(/\/+$/, '');
  return PROVIDER_BASES[provider] || PROVIDER_BASES.openai;
}

async function* sseLines(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function* chatOpenAI({ base, key, model, messages, temperature, top_p, max_tokens, reasoning_effort }) {
  const body = { model, messages, stream: true };
  if (temperature != null) body.temperature = temperature;
  if (top_p != null) body.top_p = top_p;
  if (max_tokens != null) body.max_tokens = max_tokens;
  if (reasoning_effort != null) body.reasoning_effort = reasoning_effort;

  const resp = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error('上游厂商 HTTP ' + resp.status + '：' + t.slice(0, 200));
  }

  const tcAgg = new Map();
  for await (const line of sseLines(resp.body)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let j;
    try { j = JSON.parse(data); } catch (e) { continue; }
    const delta = j.choices && j.choices[0] && j.choices[0].delta;
    if (!delta) { if (j.usage) yield { usage: j.usage }; continue; }
    const chunk = {};
    if (delta.reasoning_content || delta.reasoning) chunk.reasoning_content = delta.reasoning_content || delta.reasoning;
    if (delta.content) chunk.content = delta.content;
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const i = tc.index != null ? tc.index : 0;
        if (!tcAgg.has(i)) tcAgg.set(i, { id: tc.id || '', function: { name: '', arguments: '' } });
        const acc = tcAgg.get(i);
        if (tc.id) acc.id = tc.id;
        if (tc.function && tc.function.name) acc.function.name += tc.function.name;
        if (tc.function && tc.function.arguments) acc.function.arguments += tc.function.arguments;
      }
    }
    if (j.usage) chunk.usage = j.usage;
    if (Object.keys(chunk).length) yield chunk;
  }
  if (tcAgg.size) yield { tool_calls: [...tcAgg.values()] };
}

async function* chatAnthropic({ base, key, model, messages, temperature, max_tokens }) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const body = { model, messages: msgs, max_tokens: max_tokens || 8192, stream: true };
  if (sys) body.system = sys;
  if (temperature != null) body.temperature = temperature;

  const resp = await fetch(base + '/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error('上游厂商 HTTP ' + resp.status + '：' + t.slice(0, 200));
  }

  for await (const line of sseLines(resp.body)) {
    if (!line.startsWith('data:')) continue;
    let j;
    try { j = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
    if (j.type === 'content_block_delta' && j.delta) {
      if (j.delta.type === 'thinking_delta' && j.delta.thinking) yield { reasoning_content: j.delta.thinking };
      else if (j.delta.type === 'text_delta' && j.delta.text) yield { content: j.delta.text };
    }
    if (j.type === 'message_delta' && j.usage) {
      yield { usage: { prompt_tokens: 0, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.output_tokens } };
    }
  }
}

async function* chatUpstream({ provider, model, messages, api_key, base, ...rest }) {
  const key = api_key || '';
  if (!key) throw new Error('未携带 API Key：请先在 ThirdHub「API 密钥」中配置对应厂商的 Key');
  const resolvedBase = resolveBase(provider, base);
  const args = { base: resolvedBase, key, model, messages, ...rest };
  if (provider === 'anthropic') yield* chatAnthropic(args);
  else yield* chatOpenAI(args);
}

/* ---------- 路由处理 ---------- */
async function handleHealth(request) {
  const base = { ok: true, name: 'thirdhub-cloud', mode: 'cloud', version: VERSION, time: Date.now() };
  if (request.headers.get('Authorization')) {
    const r = await checkAuth(request, { requireMember: false });
    if (r.ok) return json({ ...base, loggedIn: true, member: r.member, level: r.level });
    return json({ ...base, loggedIn: false, member: null });
  }
  return json({ ...base, member: null });
}

async function handleCompletions(request) {
  const auth = await checkAuth(request, { requireMember: true });
  if (!auth.ok) {
    return json({ error: auth.error, needMember: !!auth.needMember, needLogin: !!auth.needLogin }, auth.status);
  }

  const body = await request.json().catch(() => ({}));
  const { model, messages } = body;
  if (!model) return json({ error: '缺少 model' }, 400);
  if (!Array.isArray(messages) || !messages.length) return json({ error: '缺少 messages' }, 400);
  if (!body.api_key) return json({ error: '未携带 API Key：请先在「API 密钥」中配置对应厂商的 Key' }, 400);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (ev, data) => writer.write(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
  const streamId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  (async () => {
    try {
      await write('stream_start', { streamId });
      let usage = null;
      for await (const chunk of chatUpstream(body)) {
        if (chunk.reasoning_content) await write('reasoning_part', { content: chunk.reasoning_content });
        if (chunk.content) await write('content_part', { content: chunk.content });
        if (chunk.tool_calls) for (const tc of chunk.tool_calls) await write('tool_call', tc);
        if (chunk.usage) usage = chunk.usage;
      }
      await write('turn_end', usage ? { usage } : {});
    } catch (e) {
      await write('error', { message: (e && e.message) || '上游调用失败' });
    } finally {
      try { await writer.close(); } catch (e) {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS },
  });
}

/* ---------- 入口 ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS' && path.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (path === '/api/v1/health' && request.method === 'GET') return await handleHealth(request);
      if (path === '/api/v1/chat/completions' && request.method === 'POST') return await handleCompletions(request);
      if (path.startsWith('/api/')) return json({ error: '接口不存在' }, 404);
    } catch (e) {
      return json({ error: (e && e.message) || '服务器错误' }, 500);
    }

    // 静态资产回退
    return env.ASSETS.fetch(request);
  },
};
