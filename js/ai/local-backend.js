/* ===== ThirdHub js/ai/local-backend.js — 本地 AI 后端接入（v2.3 · 第一阶段） =====
   对应《ThirdHub 本地 AI 后端 + Kimi 化改造》开发文档的前端侧：
   · GET  /health                    健康检查
   · POST /api/v1/chat/completions   SSE 流式对话
     Wire Protocol 事件：reasoning_part / content_part / tool_call / tool_result / turn_end
   职责边界：本地后端只做对话 / 工具 / Agent / 记忆，不做认证、会员、全局设置。
   注意：本模块不 import ai-api.js（避免循环依赖）。 */
import { kvGet, kvSet, emit } from '../store.js';

const CONF_KEY = 'ai:local-backend';
const CONF_DEF = { enabled: false, url: '', token: '', fallback: true };

/* ---------- 配置读写 ---------- */
export async function getLocalBackend() {
  return { ...CONF_DEF, ...(await kvGet(CONF_KEY, {})) };
}
export async function saveLocalBackend(conf) {
  const cur = await getLocalBackend();
  const next = { ...cur, ...conf, url: normalizeBase(conf.url != null ? conf.url : cur.url) };
  await kvSet(CONF_KEY, next);
  emit('ai:local-backend-changed', next);
  return next;
}

/* 规范化地址：补协议、去尾斜杠；空值原样返回 */
export function normalizeBase(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

/* HTTPS 页面请求 http:// 局域网地址会被浏览器按混合内容拦截 */
export function mixedContentRisk(url) {
  try { return location.protocol === 'https:' && /^http:\/\//i.test(String(url || '')); } catch (e) { return false; }
}

/* 把底层网络错误翻译成人话 */
function friendlyNetError(e, url) {
  if (e && e.name === 'AbortError') return e;
  if (mixedContentRisk(url)) {
    return new Error('浏览器拦截了 HTTPS 页面对 http:// 局域网地址的请求（混合内容限制）。可改用 http:// 打开本站，或为本地后端配置 HTTPS / 内网穿透（文档 Phase 2）。');
  }
  return new Error('无法连接本地后端（' + ((e && e.message) || '网络错误') + '）。请确认：1) 后端已启动；2) 地址与端口正确；3) 本机与后端在同一局域网。');
}

/* ---------- 健康检查：GET /health ---------- */
export async function testLocalBackend(url, token = '', timeoutMs = 6000) {
  const base = normalizeBase(url);
  if (!base) throw new Error('请先填写本地后端地址');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const resp = await fetch(base + '/health', { signal: ctl.signal, headers });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + '：后端已响应但健康检查未通过');
    let info = {};
    try { info = await resp.json(); } catch (e) {}
    return { ok: true, ms: Date.now() - t0, info, base };
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('连接超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应），请确认后端已启动且在同一局域网');
    throw friendlyNetError(e, base);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- SSE 行流 ---------- */
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

/* ---------- 流式对话：POST /api/v1/chat/completions ----------
   返回 { text, reasoning, toolCalls, toolResults, usage, local:true } */
export async function chatLocalBackend({
  base, token = '', providerId, model, messages, sessionId,
  onToken, onReasoning, onToolCall, onToolResult,
  signal, params = {}, connectTimeoutMs = 8000,
}) {
  const url = normalizeBase(base) + '/api/v1/chat/completions';

  // 请求体：按文档字段，多余字段后端可忽略；provider 供后端路由参考
  const body = { model, messages, stream: true, provider: providerId };
  if (sessionId) body.session_id = sessionId;
  if (params.temperature != null) body.temperature = params.temperature;
  if (params.top_p != null) body.top_p = params.top_p;
  if (params.max_tokens != null) body.max_tokens = params.max_tokens;
  if (params.reasoning_effort != null) body.reasoning_effort = params.reasoning_effort;
  if (Array.isArray(params.tools) && params.tools.length) body.tools = params.tools;

  // 连接超时只覆盖「建立连接 + 等待响应头」阶段；开始流式后由用户手动取消
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, connectTimeoutMs);
  const onUserAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', onUserAbort, { once: true });
  }

  let resp;
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (token) headers.Authorization = 'Bearer ' + token;
    resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    if (timedOut) throw new Error('连接本地后端超时（' + Math.round(connectTimeoutMs / 1000) + ' 秒无响应），请确认后端已启动、地址端口正确、设备在同一局域网');
    throw friendlyNetError(e, url);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error('本地后端 HTTP ' + resp.status + (t ? '：' + t.slice(0, 160) : ''));
  }

  let full = '';
  let thinking = '';
  const toolCalls = [];
  const toolResults = [];
  let usage = null;
  let evName = 'message';

  try {
    for await (const line of sseLines(resp)) {
      if (line.startsWith('event:')) { evName = line.slice(6).trim() || 'message'; continue; }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      let j = null;
      try { j = JSON.parse(data); } catch (e) {}

      if (evName === 'reasoning_part') {
        const c = (j && j.content) || '';
        if (c) { thinking += c; onReasoning && onReasoning(c, thinking); }
      } else if (evName === 'content_part') {
        const c = (j && j.content) || '';
        if (c) { full += c; onToken && onToken(c, full); }
      } else if (evName === 'tool_call') {
        if (j) { toolCalls.push(j); onToolCall && onToolCall(j); }
      } else if (evName === 'tool_result') {
        if (j) { toolResults.push(j); onToolResult && onToolResult(j); }
      } else if (evName === 'turn_end') {
        if (j && j.usage) usage = j.usage;
      } else {
        // 无 event 前缀：兼容 OpenAI 风格 data（[DONE] / choices.delta）
        if (data === '[DONE]') break;
        const delta = j && j.choices && j.choices[0] && j.choices[0].delta;
        if (delta) {
          const rc = delta.reasoning_content || delta.reasoning || '';
          if (rc) { thinking += rc; onReasoning && onReasoning(rc, thinking); }
          const c = delta.content || '';
          if (c) { full += c; onToken && onToken(c, full); }
        }
        if (j && j.usage) usage = j.usage;
      }
      evName = 'message'; // 一条 data 消费后复位（后端每条事件独立成帧）
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onUserAbort);
  }

  return { text: full, reasoning: thinking, toolCalls, toolResults, usage, local: true };
}
