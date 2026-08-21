/* ===== ThirdHub js/ai/ai-api.js — 统一 AI 对话核心 v1.6（流式 SSE · 推理流 · 本地后端优先 · 并行识别 · 模型同步 · 视频生成） ===== */
import { providerById, refreshCustomProviders } from './ai-models.js';
import { kvGet, kvSet, emit } from '../store.js';
import { recordUsage } from '../token-meter.js';
import { getLocalBackend, chatLocalBackend, cloudBase, getCloudAccessToken } from './local-backend.js';

/* ---------- API Key 管理 ---------- */
export async function getApiKey(providerId) {
  return await kvGet('ai:key:' + providerId, '');
}

/* ---------- v5.4：多 Key 管理（每个厂商可保存多个 Key，自命名 + 计费模式） ---------- */
const keysList = async (pid) => (await kvGet('ai:keys:' + pid, [])) || [];
const saveKeysList = async (pid, list) => kvSet('ai:keys:' + pid, list);

/* 厂商 Key 列表：[{name, key, mode}]（mode: payg 按量付费 | plan 会员计划） */
export async function listProviderKeys(providerId) {
  const list = await keysList(providerId);
  const legacy = await kvGet('ai:key:' + providerId, '');
  if (!list.length && legacy) list.push({ name: '默认', key: legacy, mode: 'payg' });
  return list;
}
export async function addProviderKey(providerId, entry) {
  const list = await keysList(providerId);
  if (entry.id) {
    const i = list.findIndex((x) => x.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
  } else list.push({ id: 'k' + Date.now().toString(36), ...entry });
  await saveKeysList(providerId, list);
  if (list.length === 1) await setApiKey(providerId, entry.key || '');
  return list;
}
export async function removeProviderKey(providerId, id) {
  let list = await keysList(providerId);
  const rem = list.find((x) => x.id === id);
  list = list.filter((x) => x.id !== id);
  await saveKeysList(providerId, list);
  if (rem && (await getApiKey(providerId)) === rem.key) {
    await setApiKey(providerId, list.length ? (list[0].key || '') : '');
  }
  return list;
}
export async function setActiveProviderKey(providerId, id) {
  const list = await keysList(providerId);
  const hit = list.find((x) => x.id === id);
  if (hit) await setApiKey(providerId, hit.key || '');
  return hit || null;
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
  await refreshCustomProviders();
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

/* ---------- 模块代理（v1.9：直连 / 自有代理 / 会员云端代理 / 自动优先级链路） ---------- */
const DEFAULT_BACKEND = 'https://thirdhub-proxy.1829487897.workers.dev/';
const wrapProxy = (base, url) => base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url);

async function isMemberUser() {
  try {
    const { currentUser, levelById } = await import('../auth.js');
    const u = await currentUser();
    const lv = levelById(u ? u.level : 'guest');
    return !!(u && lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now()));
  } catch (e) { return false; }
}

/* 构造某一条通道的地址；该通道不可用（未填地址 / 非会员）时返回 null */
async function hopUrl(hop, conf, url) {
  if (hop === 'direct') return url;
  if (hop === 'custom') {
    if (!conf.url) return null;
    return wrapProxy(conf.url.replace(/\/$/, '') + '/', url);
  }
  if (hop === 'cloud') {
    if (!(await isMemberUser())) return null;
    const base = await kvGet('proxy:backend', DEFAULT_BACKEND);
    return wrapProxy(base, url);
  }
  return null;
}

export async function proxiedUrl(module, url) {
  try {
    const conf = (await kvGet('proxy:mod', {}))[module];
    if (!conf || conf.mode === 'direct') return url;
    if (conf.mode === 'auto') {
      const prio = await kvGet('proxy:prio', ['cloud', 'custom', 'direct']);
      for (const hop of prio) { const u = await hopUrl(hop, conf, url); if (u) return u; }
      return url;
    }
    const u = await hopUrl(conf.mode, conf, url);
    return u || url;
  } catch (e) { return url; }
}

/* 带自动回退的 fetch：
   · 自动模式：按优先级链路依次尝试，断线（网络错误 / 5xx）自动切下一条
   · 显式自有代理 / 云端代理：失败时自动弹回直连并提示 */
export async function proxiedFetch(module, url, opts = {}) {
  let confAll = {};
  try { confAll = await kvGet('proxy:mod', {}); } catch (e) {}
  const conf = confAll[module] || { mode: 'direct' };
  let chain;
  if (conf.mode === 'auto') chain = await kvGet('proxy:prio', ['cloud', 'custom', 'direct']);
  else if (conf.mode === 'custom' || conf.mode === 'cloud') chain = [conf.mode, 'direct']; // 显式模式失败 → 弹回直连
  else chain = ['direct'];

  for (let i = 0; i < chain.length; i++) {
    const hop = chain[i];
    const u = await hopUrl(hop, conf, url);
    if (!u) continue;
    const last = i === chain.length - 1;
    try {
      const resp = await fetch(u, opts);
      if (resp.status >= 500 && !last) throw new Error('HTTP ' + resp.status); // 网关/代理故障 → 下一条
      return resp;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e; // 用户主动取消不回退
      // 显式选择自有代理 / 云端代理失败 → 自动弹回直连并提示
      if (conf.mode !== 'auto' && hop === conf.mode && hop !== 'direct') {
        try {
          confAll[module] = { ...conf, mode: 'direct' };
          await kvSet('proxy:mod', confAll);
          const { toast } = await import('../ui.js');
          toast(hop === 'custom' ? '自有代理连接失败，已自动切回直连' : '云端代理连接失败，已自动切回直连', 'err');
        } catch (_) {}
      }
      if (last) throw new Error('网络请求失败：所有通道均不可用，请检查网络或代理设置');
    }
  }
  throw new Error('网络请求失败：所有通道均不可用，请检查网络或代理设置');
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
  const resp = await proxiedFetch('ai_chat', base.replace(/\/$/, '') + '/chat/completions', {
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
  const resp = await proxiedFetch('ai_chat', base.replace(/\/$/, '') + '/messages', {
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

/* ---------- 统一入口（params：temperature / top_p / max_tokens / stream_options 等） ----------
   v2.4：AI 后端（云端会员后端 / 本地自建后端）优先，均按文档 Wire Protocol；
   用户的厂商 Key 与接口地址随请求转发给后端（后端不落库保存）；
   连接级失败且开启回退时自动退回厂商直连；已开始输出或用户取消则直接报错。 */
export async function chat({ providerId, model, messages, onToken, onReasoning, signal, params = {} }) {
  await refreshCustomProviders();
  const provider = providerById(providerId);
  let key = await getApiKey(providerId);
  let base = (await getBaseOverride(providerId)) || provider.base;

  // 限时免费模型（无 Key 时走平台代理，不经后端）
  const free = await getFreeModel();
  const isFree = !key && !!(free && free.enabled && free.models && free.models.includes(providerId + '/' + model));

  const lb = await getLocalBackend();
  if (lb.enabled && !isFree) {
    let backendBase = lb.mode === 'cloud' ? cloudBase() : lb.url;
    let backendToken = lb.token || '';
    if (lb.mode === 'cloud') {
      backendToken = await getCloudAccessToken();
      if (!backendToken) {
        const err = new Error('云端后端需要登录 ThirdHub 账号');
        err.needLogin = true;
        throw err;
      }
    }
    if (backendBase) {
      let streamed = false;
      try {
        const t0 = Date.now();
        const r = await chatLocalBackend({
          base: backendBase, token: backendToken, mode: lb.mode, providerId, model, messages,
          sessionId: params.sessionId,
          apiKey: key, providerBase: base,
          onToken: (c, f) => { streamed = true; onToken && onToken(c, f); },
          onReasoning: (c, f) => { onReasoning && onReasoning(c, f); },
          signal, params,
        });
        const usage = r.usage || estimateUsage(messages, r.text);
        recordUsage(providerId, model, usage, Date.now() - t0);
        return r;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e; // 用户主动取消：不回退
        if (streamed || !lb.fallback) throw e;    // 已产出内容或未开回退：直接报错
        try {
          const { toast } = await import('../ui.js');
          toast(e.needMember
            ? '云端后端为会员功能，已回退到厂商直连'
            : (lb.mode === 'cloud' ? '云端后端不可用，已回退到厂商直连' : '本地后端不可用，已自动回退到厂商直连'), 'err');
        } catch (_) {}
        // 落入下方直连流程
      }
    }
  }

  if (!key && isFree) {
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

/* ---------- 限时免费模型（管理后台 th_free_models 下发；限时/限量/范围自动过滤） ---------- */
export async function getFreeModel() {
  return await kvGet('ai:free-models', []);
}
export async function refreshFreeModels() {
  try {
    const { getSupabase, hasCloud } = await import('../supabase.js');
    const { currentUser } = await import('../auth.js');
    if (!hasCloud()) return;
    const u = await currentUser();
    const uid = u && u.id ? String(u.id) : '';
    const { data } = await getSupabase().from('th_free_models').select('id,provider,model,name,max_quota,quota_unit,used_quota,start_time,end_time,scope,user_ids,enabled').order('created_at', { ascending: false }).limit(50);
    const now = Date.now();
    const list = (data || []).filter((m) => {
      if (m.enabled === false) return false;
      if (m.scope === 'users' && !(m.user_ids || []).includes(uid)) return false;
      if (m.start_time && now < new Date(m.start_time).getTime()) return false;
      if (m.end_time && now > new Date(m.end_time).getTime()) return false;
      if (m.max_quota > 0 && (m.used_quota || 0) >= m.max_quota) return false;
      return true;
    }).map((m) => ({
      provider: m.provider, model: m.model, name: m.name || m.model,
      remaining: m.max_quota > 0 ? Math.max(0, m.max_quota - (m.used_quota || 0)) : -1,
      end_time: m.end_time, scope: m.scope,
    }));
    await kvSet('ai:free-models', list);
  } catch (e) {}
}

/* ---------- v6.6 第三方中转密钥：多品牌通用 Key 自动识别与匹配 ---------- */
const RELAY_KEY = 'ai:relay-keys';
export async function getRelayKeys() {
  return (await kvGet(RELAY_KEY, [])) || [];
}
export async function getRelayName() {
  return (await kvGet('ai:relay-name', '中转站模型')) || '中转站模型';
}
export async function setRelayName(name) {
  await kvSet('ai:relay-name', String(name || '中转站模型').trim());
}
/* 探测：并行请求多个品牌模型，成功 ≥2 家判定为中转站密钥 */
export async function probeRelayKey(key) {
  const probes = [
    { pid: 'openai', model: 'gpt-4o-mini', base: 'https://api.openai.com/v1' },
    { pid: 'deepseek', model: 'deepseek-chat', base: 'https://api.deepseek.com/v1' },
    { pid: 'zhipu', model: 'glm-4-flash', base: 'https://open.bigmodel.cn/api/paas/v4' },
  ];
  let ok = 0;
  const results = [];
  await Promise.all(probes.map(async (p) => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(p.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const j = await r.json().catch(() => ({}));
      const hit = r.ok || (j.error && /invalid.*model|model.*not/i.test(String(j.error.message || '')));
      results.push({ pid: p.pid, ok: hit, status: r.status });
      if (hit) ok++;
    } catch (e) { results.push({ pid: p.pid, ok: false, err: e.message }); }
  }));
  return { relay: ok >= 2, ok, results };
}
/* 保存中转密钥：自动匹配到所有支持厂商（备注中转站模型，可重命名） */
export async function saveRelayKey(key) {
  const list = await getRelayKeys();
  if (!list.some((x) => x.key === key)) {
    list.push({ id: 'relay-' + Date.now().toString(36), name: await getRelayName(), key, note: '中转站模型' });
    await kvSet(RELAY_KEY, list);
  }
  const { PROVIDERS } = await import('./ai-models.js');
  let n = 0;
  for (const p of PROVIDERS) {
    if (!p || !p.id || p.type !== 'openai') continue;
    if (!(await kvGet('ai:key:' + p.id, ''))) { await setApiKey(p.id, key); n++; }
  }
  return { count: n };
}
export async function removeRelayKey(id) {
  await kvSet(RELAY_KEY, (await getRelayKeys()).filter((x) => x.id !== id));
}

/* ---------- AI 绘画（OpenAI 兼容 images/generations） ---------- */
export async function drawImage({ providerId, model, prompt, size = '1024x1024' }) {
  await refreshCustomProviders();
  const provider = providerById(providerId);
  const key = await getApiKey(providerId);
  const base = (await getBaseOverride(providerId)) || provider.base;
  if (!key) throw new Error('未配置 API Key');
  if (!base) throw new Error('该厂商暂不支持直连绘画接口');
  const resp = await proxiedFetch('ai_image', base.replace(/\/$/, '') + '/images/generations', {
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
  await refreshCustomProviders();
  const provider = providerById(providerId);
  const key = await getApiKey(providerId);
  const base = ((await getBaseOverride(providerId)) || provider.base || '').replace(/\/$/, '');
  if (!key) throw new Error('未配置 API Key');
  if (!base) throw new Error('该厂商暂不支持视频生成接口');

  if (providerId === 'bytedance') {
    // 火山方舟：POST /contents/generations/tasks → 轮询
    const resp = await proxiedFetch('ai_video', base + '/contents/generations/tasks', {
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
    const resp = await proxiedFetch('ai_video', dash + '/services/aigc/video-generation/video-synthesis', {
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
  await refreshCustomProviders();
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

  /* v6.8：一口气并行验证所有厂商（最快命中立即返回，不再分批空等） */
  let lastErr = null;
  onProgress && onProgress(`正在并行验证 ${candidates.length} 家厂商，最快命中即返回…`);
  try {
    const r = await Promise.any(candidates.map((p) => testProviderKey(p.id, key, 7000)));
    onProgress && onProgress(`✓ ${r.provider.name} 对话验证通过`);
    return r;
  } catch (e) {
    const errs = (e && e.errors) || [];
    lastErr = errs.find((x) => x && x.quota) || errs[0] || lastErr;
    onProgress && onProgress(`✗ 未匹配到厂商${lastErr ? `（最后错误：${lastErr.message}）` : ''}`);
  }
  throw new Error('所有厂商对话验证均未通过' + (lastErr ? `（最后错误：${lastErr.message}）` : ''));
}

/* ---------- 实时模型同步（厂商 /models 接口） ---------- */
export async function fetchRemoteModels(providerId) {
  await refreshCustomProviders();
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
  await refreshCustomProviders();
  const p = providerById(providerId);
  const base = [...(p.models || [])];
  const synced = await getSyncedModels(providerId);
  for (const m of synced) if (!base.includes(m) && !(p.deprecated || []).includes(m)) base.push(m);
  return base;
}

/* ---------- 模型 ASR：OpenAI 兼容 /audio/transcriptions ---------- */
export async function transcribeAudio({ providerId, model, blob, lang }) {
  await refreshCustomProviders();
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
  const resp = await proxiedFetch('ai_asr', base + '/audio/transcriptions', {
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
