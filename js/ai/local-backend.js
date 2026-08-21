/* ===== ThirdHub js/ai/local-backend.js — AI 后端接入（v2.4 · 云端会员后端 + 本地自建后端） =====
   对应《ThirdHub 本地 AI 后端 + Kimi 化改造》开发文档的前端侧：
   · GET  {base}/health                    本地后端健康检查（文档约定）
   · GET  {origin}/api/v1/health           云端后端健康检查
   · POST {base}/api/v1/chat/completions   SSE 流式对话
     Wire Protocol 事件：stream_start / reasoning_part / content_part / tool_call /
                         tool_result / steer_ack / turn_end / error
   两种模式：
   · cloud — ThirdHub 云端后端（会员专属）：同源 Pages Functions，登录态即身份
   · local — 用户自建后端（Termux / Node.js）：局域网地址，可选访问令牌
   注意：本模块不 import ai-api.js（避免循环依赖）。 */
import { kvGet, kvSet, emit } from '../store.js';

const CONF_KEY = 'ai:local-backend';
const CONF_DEF = { enabled: false, mode: 'cloud', url: '', token: '', fallback: true };

/* ---------- 配置读写 ---------- */
export async function getLocalBackend() {
  return { ...CONF_DEF, ...(await kvGet(CONF_KEY, {})) };
}
export async function saveLocalBackend(conf) {
  const cur = await getLocalBackend();
  const next = { ...cur, ...conf };
  if (conf.url != null || cur.url) next.url = normalizeBase(conf.url != null ? conf.url : cur.url);
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

/* ---------- 云端模式：地址与身份 ---------- */
const CLOUD_CANONICAL = 'https://thirdhub.pages.dev';
export function cloudBase() {
  try {
    // 云端 Functions 只部署在主站；GitHub 镜像等其它来源回退到主站（Functions 已开 CORS）
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === 'thirdhub.pages.dev' || h.endsWith('.thirdhub.pages.dev')) return location.origin;
    return CLOUD_CANONICAL;
  } catch (e) { return CLOUD_CANONICAL; }
}

/* 取当前登录态的访问令牌（Supabase session access_token，不落库） */
export async function getCloudAccessToken() {
  try {
    const { getSupabase, hasCloud } = await import('../supabase.js');
    if (!hasCloud()) return '';
    const { data } = await getSupabase().auth.getSession();
    return (data && data.session && data.session.access_token) || '';
  } catch (e) { return ''; }
}

/* 当前会员状态（与 ai-api.js isMemberUser 同一判定） */
export async function cloudMemberInfo() {
  try {
    const { currentUser, levelById } = await import('../auth.js');
    const u = await currentUser();
    if (!u) return { loggedIn: false, member: false, levelName: '未登录' };
    const lv = levelById(u.level);
    const member = !!(lv.price > 0 && (!u.expireAt || new Date(u.expireAt).getTime() > Date.now()));
    return { loggedIn: true, member, levelName: lv.name, user: u };
  } catch (e) { return { loggedIn: false, member: false, levelName: '未登录' }; }
}

/* 把底层网络错误翻译成人话 */
function friendlyNetError(e, url, mode) {
  if (e && e.name === 'AbortError') return e;
  if (mode === 'cloud') {
    return new Error('无法连接云端后端（' + ((e && e.message) || '网络错误') + '），请检查网络后重试');
  }
  if (mixedContentRisk(url)) {
    return new Error('浏览器拦截了 HTTPS 页面对 http:// 局域网地址的请求（混合内容限制）。可改用 http:// 打开本站，或为本地后端配置 HTTPS / 内网穿透（文档 Phase 2）。');
  }
  return new Error('无法连接本地后端（' + ((e && e.message) || '网络错误') + '）。请确认：1) 后端已启动；2) 地址与端口正确；3) 本机与后端在同一局域网。');
}

/* ---------- 健康检查 ---------- */
export async function testLocalBackend(url, token = '', timeoutMs = 6000, mode = 'local') {
  const base = mode === 'cloud' ? cloudBase() : normalizeBase(url);
  if (!base) throw new Error(mode === 'cloud' ? '云端地址不可用' : '请先填写本地后端地址');
  const healthUrl = base + (mode === 'cloud' ? '/api/v1/health' : '/health');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    const resp = await fetch(healthUrl, { signal: ctl.signal, headers });
    if (!resp.ok) {
      let j = null;
      try { j = await resp.json(); } catch (e) {}
      const err = new Error((j && j.error) || ('HTTP ' + resp.status + '：健康检查未通过'));
      if (j && j.needMember) err.needMember = true;
      throw err;
    }
    let info = {};
    try { info = await resp.json(); } catch (e) {}
    return { ok: true, ms: Date.now() - t0, info, base };
  } catch (e) {
    if (e && e.needMember) throw e;
    if (e && e.name === 'AbortError') throw new Error('连接超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应），请确认后端已启动' + (mode === 'local' ? '且在同一局域网' : ''));
    if (/^HTTP|^云端|^无法|^浏览器/.test((e && e.message) || '')) throw e;
    throw friendlyNetError(e, base, mode);
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
   apiKey / providerBase：转发给后端用于调上游厂商（后端不落库保存）
   返回 { text, reasoning, toolCalls, toolResults, usage, local:true, streamId } */
export async function chatLocalBackend({
  base, token = '', mode = 'local', providerId, model, messages, sessionId,
  apiKey = '', providerBase = '',
  onToken, onReasoning, onToolCall, onToolResult,
  signal, params = {}, connectTimeoutMs = 8000,
}) {
  const url = normalizeBase(base) + '/api/v1/chat/completions';

  // 请求体：按文档字段，多余字段后端可忽略；provider/api_key/base 供后端路由调上游
  const body = { model, messages, stream: true, provider: providerId };
  if (sessionId) body.session_id = sessionId;
  if (apiKey) body.api_key = apiKey;
  if (providerBase) body.base = providerBase;
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
    if (timedOut) throw new Error('连接' + (mode === 'cloud' ? '云端' : '本地') + '后端超时（' + Math.round(connectTimeoutMs / 1000) + ' 秒无响应），请确认后端已启动' + (mode === 'local' ? '、地址端口正确、设备在同一局域网' : ''));
    throw friendlyNetError(e, url, mode);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    let j = null;
    try { j = JSON.parse(t); } catch (e) {}
    const msg = (j && j.error) || ((mode === 'cloud' ? '云端后端' : '本地后端') + ' HTTP ' + resp.status + (t && !j ? '：' + t.slice(0, 160) : ''));
    const err = new Error(msg);
    if (j && j.needMember) err.needMember = true;
    if (resp.status === 401) err.authFailed = true;
    throw err;
  }

  let full = '';
  let thinking = '';
  const toolCalls = [];
  const toolResults = [];
  let usage = null;
  let streamId = '';
  let serverError = null;
  let evName = 'message';

  try {
    for await (const line of sseLines(resp)) {
      if (line.startsWith('event:')) { evName = line.slice(6).trim() || 'message'; continue; }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      let j = null;
      try { j = JSON.parse(data); } catch (e) {}

      if (evName === 'stream_start') {
        if (j && j.streamId) streamId = j.streamId;
      } else if (evName === 'reasoning_part') {
        const c = (j && j.content) || '';
        if (c) { thinking += c; onReasoning && onReasoning(c, thinking); }
      } else if (evName === 'content_part') {
        const c = (j && j.content) || '';
        if (c) { full += c; onToken && onToken(c, full); }
      } else if (evName === 'tool_call') {
        if (j) { toolCalls.push(j); onToolCall && onToolCall(j); }
      } else if (evName === 'tool_result') {
        if (j) { toolResults.push(j); onToolResult && onToolResult(j); }
      } else if (evName === 'error') {
        serverError = new Error((j && j.message) || '后端处理失败');
      } else if (evName === 'turn_end') {
        if (j && j.usage) usage = j.usage;
      } else if (evName === 'steer_ack') {
        // 后端确认收到 steer 注入，无需处理
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

  if (serverError && !full && !thinking) throw serverError; // 整轮失败才抛；已有输出则保留
  return { text: full, reasoning: thinking, toolCalls, toolResults, usage, local: true, streamId };
}
