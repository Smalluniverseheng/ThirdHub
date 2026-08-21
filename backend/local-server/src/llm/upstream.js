/* ===== ThirdHub 本地后端 — 上游 LLM 调用与流解析 =====
   统一产出 chunk：{ content, reasoning_content, tool_calls, usage }
   支持：OpenAI 兼容（DeepSeek / GPT / Qwen / Grok / Kimi 等）与 Anthropic */

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

/* 环境变量兜底 Key（前端未转发 api_key 时使用） */
function envKey(provider) {
  const k = (provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[k + '_API_KEY'] || '';
}

function resolveBase(provider, bodyBase) {
  if (bodyBase && /^https?:\/\//i.test(bodyBase)) return bodyBase.replace(/\/+$/, '');
  return PROVIDER_BASES[provider] || PROVIDER_BASES.openai;
}

/* 逐行解析 SSE 文本流 */
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

/* OpenAI 兼容流式 */
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

  // 流式 tool_calls 聚合（index → 累积 arguments 分片）
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

/* Anthropic 流式 */
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

/* 统一入口：reqBody 为前端 POST /api/v1/chat/completions 的请求体 */
async function* chat({ provider, model, messages, api_key, base, ...rest }) {
  const key = api_key || envKey(provider);
  if (!key) {
    throw new Error('未提供 API Key：前端请求未携带 api_key，且后端环境变量 ' +
      (provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY 未配置');
  }
  const resolvedBase = resolveBase(provider, base);
  const args = { base: resolvedBase, key, model, messages, ...rest };
  if (provider === 'anthropic') yield* chatAnthropic(args);
  else yield* chatOpenAI(args);
}

module.exports = { chat, PROVIDER_BASES };
