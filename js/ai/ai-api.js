/* ===== ThirdHub js/ai/ai-api.js — 统一 AI 对话核心 v1.5（流式 SSE · 推理流 · 并行识别 · 模型同步 · 视频生成） ===== */
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

/* ---------- 模块代理（v1.7 设置分级：直连 / 自有代理 / 会员云端代理） ---------- */
export async function proxiedUrl(module, url) {
  try {
    const conf = (await kvGet('proxy:mod', {}))[module];
    if (!conf || conf.mode === 'direct') return url;
    const wrap = (base) => base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);
    if (conf.mode === 'custom' && conf.url) return wrap(conf.url.replace(/\/$/, '') + (conf.url.endsWith('/') ? '' : '/'));
    if (conf.mode === 'cloud') {
      /* 云端代理为会员能力：校验会员有效后才生效，否则回退直连 */
      const { currentUser, levelById } = await import('../auth.js');
      const u = await currentUser();
      const lv = levelById(u ? u.level : 'guest');
      if (u && lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now())) {
        const base = await kvGet('proxy:backend', 'https://thirdhub-proxy.1829487897.workers.dev/');
        return wrap(base);
      }
    }
  } catch (e) {}
  return url;
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

/* ---------- OpenAI 兼容流式（正文 / 推理分离） ---------- */
async function chatOpenAI({ base, key, model, messages, onToken, onReasoning, signal, extra = {} }) {
  const resp = await fetch(await proxiedUrl('ai_chat', base.replace(/\/$/, '') + '/chat/completions'), {
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
  let thinking = '';
  let usage = null;
  for await (const line of sseLines(resp)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    try {
      const j = JSON.parse(data);
      const delta = j.choices && j.choices[0] && j.choices[0].delta;
      if (delta) {
        const rchunk = delta.reasoning_content || delta.reasoning || '';
        if (rchunk) { thinking += rchunk; onReasoning && onReasoning(rchunk, thinking); }
        const chunk = delta.content || '';
        if (chunk) { full += chunk; onToken && onToken(chunk, full); }
      }
      if (j.usage) usage = j.usage;
    } catch (e) {}
  }
  return { text: full, reasoning: thinking, usage };
}

/* ---------- Anthropic 流式（含 thinking_delta） ---------- */
async function chatAnthropic({ base, key, model, messages, onToken, onReasoning, signal, extra = {} }) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const resp = await fetch(await proxiedUrl('ai_chat', base.replace(/\/$/, '') + '/messages'), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, messages: msgs, system: sys || undefined, max_tokens: 8192, stream: true, ...extra }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
  }
  let full = '';
  let thinking = '';
  let usage = null;
  for await (const line of sseLines(resp)) {
    if (!line.startsWith('data:')) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j.type === 'content_block_delta' && j.delta) {
        if (j.delta.type === 'thinking_delta' && j.delta.thinking) {
          thinking += j.delta.thinking;
          onReasoning && onReasoning(j.delta.thinking, thinking);
        } else if (j.delta.text) {
          full += j.delta.text;
          onToken && onToken(j.delta.text, full);
        }
      }
      if (j.type === 'message_delta' && j.usage) usage = { prompt_tokens: 0, completion_tokens: j.usage.output_tokens, total_tokens: j.usage.output_tokens };
    } catch (e) {}
  }
  return { text: full, reasoning: thinking, usage };
}

/* ---------- 统一入口（params：temperature / top_p / max_tokens / stream_options 等） ---------- */
export async function chat({ providerId, model, messages, onToken, onReasoning, signal, params = {} }) {
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

  const args = { base, key, model, messages, onToken, onReasoning, signal, extra: params };
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
    const { data } = await getSupabase().from('th_configs').select('value').eq('key', 'free_models').maybeSingle();
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
  const resp = await fetch(await proxiedUrl('ai_image', base.replace(/\/$/, '') + '/images/generations'), {
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

/* ---------- AI 视频生成（异步任务轮询） ---------- */
export async function generateVideo({ providerId, model, prompt, ratio = '16:9', duration = 5, onProgress }) {
  const provider = providerById(providerId);
  const key = await getApiKey(providerId);
  const base = ((await getBaseOverride(providerId)) || provider.base || '').replace(/\/$/, '');
  if (!key) throw new Error('未配置 API Key');
  if (!base) throw new Error('该厂商暂不支持视频生成接口');

  if (providerId === 'bytedance') {
    // 火山方舟：POST /contents/generations/tasks → 轮询
    const resp = await fetch(await proxiedUrl('ai_video', base + '/contents/generations/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, content: [{ type: 'text', text: `${prompt} --ratio ${ratio} --duration ${duration}` }] }),
    });
    if (!resp.ok) throw new Error('创建视频任务失败 HTTP ' + resp.status);
    const j = await resp.json();
    const taskId = j.id;
    if (!taskId) throw new Error('未返回任务 ID');
    return await pollTask(base + '/contents/generations/tasks/' + taskId, { Authorization: 'Bearer ' + key }, onProgress,
      (d) => d.status === 'succeeded' ? (d.content && d.content.video_url) : null,
      (d) => ['failed', 'cancelled'].includes(d.status) ? (d.error && d.error.message) || '视频生成失败' : null);
  }

  if (providerId === 'aliyun') {
    // DashScope 异步任务
    const dash = 'https://dashscope.aliyuncs.com/api/v1';
    const resp = await fetch(await proxiedUrl('ai_video', dash + '/services/aigc/video-generation/video-synthesis'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model, input: { prompt }, parameters: { size: ratio === '16:9' ? '1280*720' : ratio === '9:16' ? '720*1280' : '960*960' } }),
    });
    if (!resp.ok) throw new Error('创建视频任务失败 HTTP ' + resp.status);
    const j = await resp.json();
    const taskId = j.output && j.output.task_id;
    if (!taskId) throw new Error('未返回任务 ID');
    return await pollTask(dash + '/tasks/' + taskId, { Authorization: 'Bearer ' + key }, onProgress,
      (d) => d.output && d.output.task_status === 'SUCCEEDED' ? (d.output.video_url || (d.output.results && d.output.results[0])) : null,
      (d) => d.output && d.output.task_status === 'FAILED' ? (d.output.message || '视频生成失败') : null);
  }

  throw new Error(`${provider.name} 的视频生成暂未接入直连适配器，可使用字节跳动（豆包 Seedance）或阿里云（万相 Wanx）`);
}

async function pollTask(url, headers, onProgress, extract, extractErr) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error('轮询任务失败 HTTP ' + resp.status);
    const d = await resp.json();
    const err = extractErr(d);
    if (err) throw new Error(err);
    const out = extract(d);
    if (out) return out;
    onProgress && onProgress(i + 1);
  }
  throw new Error('视频生成超时');
}

/* ---------- 联网搜索（由具备搜索能力的模型端完成） ---------- */
export function supportsWebSearch(providerId) {
  return ['perplexity', 'zhipu', 'aliyun', 'xai', 'google', 'moonshot', 'openai', 'bytedance', 'xiaomi'].includes(providerId);
}

/* ---------- Key 验证与自动识别（v1.5 · 并行） ----------
   识别原则：不轻信 Key 前缀，必须向厂商发送真实对话请求，
   成功返回对话结果才算匹配成功；多家并行测速，先成功者胜出。 */

/* 对指定厂商做一次真实对话验证（最小开销：max_tokens=1） */
export async function testProviderKey(providerId, key, timeoutMs = 9000) {
  const p = providerById(providerId);
  const model = (p.models || [])[0];
  if (!model) throw new Error('该厂商没有预置对话模型');
  const base = ((await getBaseOverride(providerId)) || p.base || '').replace(/\/$/, '');
  if (!base) throw new Error('该厂商未配置接口地址');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let resp;
    if (p.type === 'anthropic') {
      resp = await fetch(base + '/messages', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
    } else {
      resp = await fetch(base + '/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
      });
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      const err = new Error(`HTTP ${resp.status}`);
      err.quota = /insufficient|quota|balance|余额/i.test(t);
      throw err;
    }
    const data = await resp.json().catch(() => ({}));
    const txt = p.type === 'anthropic'
      ? (data.content && data.content[0] && data.content[0].text)
      : (data.choices && data.choices[0] && (data.choices[0].message ? data.choices[0].message.content : data.choices[0].text));
    if (txt === undefined || txt === null) throw new Error('返回格式异常');
    return { provider: p, model, reply: String(txt) };
  } finally {
    clearTimeout(timer);
  }
}

/* 自动识别 Key：前缀命中优先，其余并行验证（每批 8 家），任一成功即返回 */
export async function identifyApiKey(key, onProgress = null) {
  const { PROVIDERS } = await import('./ai-models.js');
  const usable = PROVIDERS.filter((p) => p.base && (p.models || []).length && (p.type === 'openai' || p.type === 'anthropic'));
  const HINTS = [
    [/^sk-ant-/i, 'anthropic'], [/^sk-or-/i, 'openrouter'], [/^xai-/i, 'xai'], [/^gsk_/i, 'groq'],
    [/^AIza/, 'google'], [/^pplx-/i, 'perplexity'], [/^nvapi-/i, 'nvidia'], [/^sk-proj-/i, 'openai'],
    [/^tp-/i, 'xiaomi'],
  ];
  const first = [];
  for (const [re, id] of HINTS) {
    if (id && re.test(key)) {
      const p = usable.find((x) => x.id === id);
      if (p) first.push(p);
    }
  }
  // 带小数点的 Key 多为智谱
  if (/^[a-f0-9]{32}\./i.test(key)) {
    const p = usable.find((x) => x.id === 'zhipu');
    if (p) first.push(p);
  }
  const rest = usable.filter((p) => !first.includes(p));
  const candidates = [...first, ...rest];

  const BATCH = 8;
  let lastErr = null;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    onProgress && onProgress(`正在并行验证 ${chunk.length} 家厂商（${Math.min(i + BATCH, candidates.length)}/${candidates.length}）…`);
    try {
      const r = await Promise.any(chunk.map((p) => testProviderKey(p.id, key)));
      onProgress && onProgress(`✓ ${r.provider.name} 对话验证通过`);
      return r;
    } catch (e) {
      const errs = (e && e.errors) || [];
      lastErr = errs.find((x) => x && x.quota) || errs[0] || lastErr;
      onProgress && onProgress(`✗ 本批未通过${lastErr ? `（${lastErr.message}）` : ''}`);
    }
  }
  throw new Error('所有厂商对话验证均未通过' + (lastErr ? `（最后错误：${lastErr.message}）` : ''));
}

/* ---------- 实时模型同步（厂商 /models 接口） ---------- */
export async function fetchRemoteModels(providerId) {
  const p = providerById(providerId);
  const key = await getApiKey(providerId);
  const base = ((await getBaseOverride(providerId)) || p.base || '').replace(/\/$/, '');
  if (!key) throw new Error('请先配置该厂商的 API Key');
  if (!base) throw new Error('该厂商未配置接口地址');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    let resp;
    if (p.type === 'anthropic') {
      resp = await fetch(base + '/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        signal: ctl.signal,
      });
    } else {
      resp = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: ctl.signal });
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    const list = (j.data || j.models || []).map((m) => (typeof m === 'string' ? m : (m.id || m.name || ''))).filter(Boolean);
    if (!list.length) throw new Error('厂商未返回模型列表');
    return list;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveSyncedModels(providerId, models) {
  await kvSet('ai:sync-models:' + providerId, { at: Date.now(), models });
}
export async function getSyncedModels(providerId) {
  const r = await kvGet('ai:sync-models:' + providerId, null);
  return r && r.models ? r.models : [];
}

/* 有效模型清单 = 预置 + 已同步去重 */
export async function effectiveModels(providerId) {
  const p = providerById(providerId);
  const base = [...(p.models || [])];
  const synced = await getSyncedModels(providerId);
  for (const m of synced) if (!base.includes(m) && !(p.deprecated || []).includes(m)) base.push(m);
  return base;
}

/* ---------- 模型 ASR：OpenAI 兼容 /audio/transcriptions ---------- */
export async function transcribeAudio({ providerId, model, blob, lang }) {
  const provider = providerById(providerId);
  const key = await getApiKey(providerId);
  const base = ((await getBaseOverride(providerId)) || provider.base || '').replace(/\/$/, '');
  if (!key) {
    const err = new Error(`未配置 ${provider.name} 的 API Key`);
    err.needKey = providerId;
    throw err;
  }
  if (!base) throw new Error(`${provider.name} 未配置接口地址`);
  const ext = (blob.type && blob.type.split('/')[1]) || 'webm';
  const fd = new FormData();
  fd.append('file', blob, 'audio.' + ext.split(';')[0]);
  fd.append('model', model);
  if (lang) fd.append('language', String(lang).split('-')[0]);
  const resp = await fetch(await proxiedUrl('ai_asr', base + '/audio/transcriptions'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key },
    body: fd,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${t.slice(0, 160)}`);
  }
  const d = await resp.json();
  return d.text || '';
}
