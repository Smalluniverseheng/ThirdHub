/* ===== ThirdHub js/ai/ai-api.js — 统一 AI 对话核心（流式 SSE） ===== */
import { providerById } from './ai-models.js';
import { kvGet, kvSet, emit } from '../store.js';
import { recordUsage } from '../token-meter.js';

/* ---------- API Key 管理 ---------- */
export async function getApiKey(providerId) {
  return await kvGet('ai:key:' + providerId, '');
}
export async function setApiKey(providerId, key) {
  await kvSet('ai:key:' + providerId, (key || '').trim());
  emit('ai:keys-changed');
}
export async function getBaseOverride(providerId) {
  return await kvGet('ai:base:' + providerId, '');
}
export async function setBaseOverride(providerId, base) {
  await kvSet('ai:base:' + providerId, (base || '').trim());
}
export async function allConfiguredKeys() {
  const { PROVIDERS } = await import('./ai-models.js');
  const out = [];
  for (const p of PROVIDERS) {
    const k = await getApiKey(p.id);
    if (k) out.push(p.id);
  }
  return out;
}

/* ---------- 自定义提供商 ---------- */
export async function customProviders() {
  return await kvGet('ai:custom-providers', []);
}
export async function saveCustomProvider(cp) {
  const list = await customProviders();
  const i = list.findIndex((x) => x.id === cp.id);
  if (i >= 0) list[i] = cp; else list.push(cp);
  await kvSet('ai:custom-providers', list);
}

/* ---------- SSE 解析 ---------- */
async function* sseLines(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
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

/* ---------- OpenAI 兼容流式 ---------- */
async function chatOpenAI({ base, key, model, messages, onToken, signal, extra = {} }) {
  const resp = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages, stream: true, ...extra }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  let full = '';
  let usage = null;
  for await (const line of sseLines(resp)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    try {
      const j = JSON.parse(data);
      const delta = j.choices && j.choices[0] && j.choices[0].delta;
      const chunk = delta && (delta.content || delta.reasoning_content || '');
      if (chunk) { full += chunk; onToken && onToken(chunk, full); }
      if (j.usage) usage = j.usage;
    } catch (e) {}
  }
  return { text: full, usage };
}

/* ---------- Anthropic 流式 ---------- */
async function chatAnthropic({ base, key, model, messages, onToken, signal }) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const resp = await fetch(base.replace(/\/$/, '') + '/messages', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, messages: msgs, system: sys || undefined, max_tokens: 8192, stream: true }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  let full = '';
  let usage = null;
  for await (const line of sseLines(resp)) {
    if (!line.startsWith('data:')) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j.type === 'content_block_delta' && j.delta && j.delta.text) {
        full += j.delta.text;
        onToken && onToken(j.delta.text, full);
      }
      if (j.type === 'message_delta' && j.usage) usage = { prompt_tokens: 0, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.output_tokens };
    } catch (e) {}
  }
  return { text: full, usage };
}

/* ---------- 统一入口 ---------- */
export async function chat({ providerId, model, messages, onToken, signal }) {
  const provider = providerById(providerId);
  let key = await getApiKey(providerId);
  let base = (await getBaseOverride(providerId)) || provider.base;

  // 限时免费模型：走平台代理，无需用户 Key
  const free = await getFreeModel();
  if (!key && free && free.enabled && free.models && free.models.includes(providerId + '/' + model)) {
    const proxy = await kvGet('ai:free-proxy', '');
    if (proxy) { base = proxy; key = 'free'; }
  }
  if (!key) {
    const err = new Error(`未配置 ${provider.name} 的 API Key`);
    err.needKey = providerId;
    throw err;
  }
  if (!base) throw new Error(`${provider.name} 未配置接口地址`);

  const args = { base, key, model, messages, onToken, signal };
  const t0 = Date.now();
  const result = provider.type === 'anthropic' ? await chatAnthropic(args) : await chatOpenAI(args);

  // Token 统计
  const usage = result.usage || estimateUsage(messages, result.text);
  recordUsage(providerId, model, usage, Date.now() - t0);
  return result;
}

function estimateUsage(messages, reply) {
  const inChars = messages.reduce((n, m) => n + (m.content || '').length, 0);
  const outChars = (reply || '').length;
  const est = (c) => Math.ceil(c / 1.6);
  return { prompt_tokens: est(inChars), completion_tokens: est(outChars), total_tokens: est(inChars + outChars), estimated: true };
}

/* ---------- 限时免费模型（管理后台下发） ---------- */
export async function getFreeModel() {
  const local = await kvGet('ai:free-models', null);
  return local;
}
export async function refreshFreeModels() {
  try {
    const { getSupabase, hasCloud } = await import('../supabase.js');
    if (!hasCloud()) return;
    const { data } = await getSupabase().from('configs').select('value').eq('key', 'free_models').maybeSingle();
    if (data && data.value) await kvSet('ai:free-models', JSON.parse(data.value));
  } catch (e) {}
}

/* ---------- AI 绘画（OpenAI 兼容 images/generations） ---------- */
export async function drawImage({ providerId, model, prompt, size = '1024x1024' }) {
  const provider = providerById(providerId);
  const key = await getApiKey(providerId);
  const base = (await getBaseOverride(providerId)) || provider.base;
  if (!key) throw new Error('未配置 API Key');
  if (!base) throw new Error('该厂商暂不支持直连绘画接口');
  const resp = await fetch(base.replace(/\/$/, '') + '/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, prompt, n: 1, size }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const j = await resp.json();
  const item = j.data && j.data[0];
  if (!item) throw new Error('返回数据为空');
  if (item.url) return item.url;
  if (item.b64_json) return 'data:image/png;base64,' + item.b64_json;
  throw new Error('无法解析图片结果');
}

/* ---------- 联网搜索（由具备搜索能力的模型端完成） ---------- */
export function supportsWebSearch(providerId) {
  return ['perplexity', 'zhipu', 'aliyun', 'xai', 'google'].includes(providerId);
}
