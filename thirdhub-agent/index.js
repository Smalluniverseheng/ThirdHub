/* ===== ThirdHub-Agent index.js — 本地算力后端（v0.1，对应 ThirdHub v5.0） =====
   职责：
   1. WS Server（默认 9600）：供 ThirdHub 前端（局域网）连接
   2. 访问密码认证（bcrypt，首次启动设置；前端连接需验证）
   3. chat 流式对话：通过官方 @deepseek-ai/dsh-sdk-client 驱动 DSH 内核子进程
   4. 配置管理：前端下发 API Key / Base URL / 模型（API Key AES-256-GCM 加密存储）
   5. 会话历史：JSONL 持久化（data/sessions.jsonl）

   协议（前端 ↔ 后端，JSON）：
   前端 → {type:'auth', action:'login', payload:{password}}          → auth_result
   前端 → {type:'chat', id, session_id?, payload:{text, model_id?}}  → stream_token* → stream_done | error
   前端 → {type:'stop', id, session_id?}                             → error(not_supported)
   前端 → {type:'config', action:'list'|'save'|'test', payload}      → config_result
   前端 → {type:'history', action:'get', payload:{session_id}}       → history_result
   前端 → {type:'heartbeat'}                                         → heartbeat
   后端 → stream_token {token, accumulated} / stream_done {full_text}
   后端 → tool_call {tool_name, arguments} / tool_result {tool_name, result}（Agent 工具轨迹） */
import { WebSocketServer } from 'ws';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readFileSync as read } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.THIRD_HUB_AGENT_PORT || 9600);
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.jsonl');
mkdirSync(DATA_DIR, { recursive: true });

/* ---------- 配置存储（密码 hash + AES 加密 API Key） ---------- */
function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
let config = loadConfig();

/* 主密钥：随机生成存 data/master.key（用于 AES 加密 API Key，不依赖访问密码） */
function ensureMasterKey() {
  const f = path.join(DATA_DIR, 'master.key');
  if (!existsSync(f)) {
    const k = randomBytes(32).toString('hex');
    try { writeFileSync(f, k, { mode: 0o600 }); } catch (e) { writeFileSync(f, k); }
    return k;
  }
  return readFileSync(f, 'utf8').trim();
}
const masterKey = ensureMasterKey();

function encryptSecret(plain) {
  const iv = randomBytes(12);
  const key = Buffer.from(masterKey, 'hex');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), data: enc.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
function decryptSecret(box) {
  try {
    const key = Buffer.from(masterKey, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(box.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'hex')), decipher.final()]).toString('utf8');
  } catch (e) { return ''; }
}

/* 首次启动：若未设置访问密码，控制台交互设置 */
async function ensurePassword() {
  if (config.passwordHash) return true;
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  ThirdHub-Agent 首次启动                    ║');
  console.log('║  请设置后端访问密码（保护 API Key 与算力）   ║');
  console.log('╚════════════════════════════════════════════╝');
  const readline = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stdout });
  const p1 = await readline.question('访问密码：');
  const p2 = await readline.question('再次确认：');
  readline.close();
  if (!p1 || p1.length < 6) { console.log('密码至少 6 位，请重试'); return ensurePassword(); }
  if (p1 !== p2) { console.log('两次输入不一致，请重试'); return ensurePassword(); }
  config.passwordHash = await bcrypt.hash(p1, 10);
  config.salt = randomBytes(8).toString('hex');
  config.models = config.models || [];
  saveConfig(config);
  console.log('✓ 密码已设置');
  return true;
}

/* ---------- DSH 子进程管理（官方 SDK） ---------- */
let harness = null;
let harnessModel = 'deepseek-v4-flash';
let harnessKey = '';
let harnessBase = '';
const sessions = new Map(); // session_id -> {messages:[]}

function currentModelConf() {
  const models = config.models || [];
  const active = models.find((m) => m.id === config.activeModel) || models[0];
  return active || null;
}

async function spawnHarness() {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client');
  const bin = path.join(__dirname, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-demo', 'lib', 'bin.js');
  const conf = currentModelConf();
  harnessModel = (conf && conf.modelId) || 'deepseek-v4-flash';
  harnessKey = conf ? decryptSecret(conf.apiKeyBox) : '';
  harnessBase = (conf && conf.baseUrl) || '';
  const env = { ...process.env };
  if (harnessKey) env.DEEPSEEK_API_KEY = harnessKey;
  if (harnessBase) env.DEEPSEEK_BASE_URL = harnessBase;
  harness = new DeepSeekHarness({
    launch: { command: process.execPath, args: [bin, path.join(__dirname, 'cordis.yml')], cwd: __dirname, env },
    provider: 'deepseek-official',
    model: harnessModel,
    maxTokens: 8192,
  });
  console.log('[agent] DSH 内核启动：model=' + harnessModel + (harnessBase ? ' base=' + harnessBase : ''));
}

async function closeHarness() {
  if (harness) { try { await harness.close(); } catch (e) {} harness = null; }
}

/* ---------- WS 服务 ---------- */
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
const clients = new Map(); // ws -> { authed, token, device }

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  for (const [ws] of clients) if (ws !== except && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

async function handleChat(ws, msg) {
  const payload = msg.payload || {};
  const text = String(payload.text || '').trim();
  if (!text) return send(ws, { type: 'error', id: msg.id, payload: { code: 'EMPTY', message: '消息为空' } });
  const sessionId = msg.session_id || 'default';
  if (!sessions.has(sessionId)) sessions.set(sessionId, { messages: [] });
  const session = sessions.get(sessionId);
  session.messages.push({ role: 'user', content: text });

  /* v0.3：前端可在消息里带 modelId 切换设备模型（切换后重启内核） */
  const modelId = String(payload.modelId || '').trim();
  if (modelId && modelId !== (config.activeModel || '')) {
    config.activeModel = modelId;
    saveConfig(config);
    await closeHarness();
  }

  if (!harness) spawnHarness().catch((e) => send(ws, { type: 'error', id: msg.id, payload: { code: 'NO_ENGINE', message: 'DSH 内核未就绪：' + e.message } }));

  /* ---- 轨迹聚合（v0.3）：思考/工具/统计流式转发 ---- */
  const st = {
    turn: 0, step: 0,
    llmMs: 0, toolMs: 0,
    firstTokenMs: null, stepStartMs: null, toolStartMs: null,
    inTokens: 0, outTokens: 0, cacheHit: 0, cacheMiss: 0,
    curCall: null, toolCount: 0,
  };
  function fmtMs(ms) {
    if (ms == null) return '-';
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + 'm' + (r < 10 ? '0' : '') + r + 's';
  }
  function fmtTok(n) {
    if (n == null) return '-';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }
  function buildStats() {
    const hit = st.cacheHit || 0, miss = st.cacheMiss || 0;
    const cacheRate = (hit + miss) > 0 ? Math.round(hit * 1000 / (hit + miss)) / 10 : null;
    const totalIn = st.inTokens || 0, totalOut = st.outTokens || 0;
    return {
      turns: st.turn, steps: st.step,
      llmMs: st.llmMs, toolMs: st.toolMs,
      firstTokenMs: st.firstTokenMs,
      rate: st.llmMs > 0 && totalOut > 0 ? Math.round(totalOut * 1000 / st.llmMs) : null,
      cacheRate: cacheRate,
      inTokens: totalIn, outTokens: totalOut,
      fmtMs, fmtTok,
    };
  }

  const run = harness.run(text, {
    sessionId: sessionId === 'default' ? undefined : sessionId,
    onNotification: (n) => {
      const p = n.params || {};
      if (n.method !== 'session.event') return;
      const ev = p.event;
      if (!ev) return;
      const t0 = ev.time || Date.now();
      if (ev.type === 'turn/start') {
        st.turn = (ev.data && ev.data.turn) || st.turn + 1;
        st.toolCount = 0; st.curCall = null;
        send(ws, { type: 'turn_info', id: msg.id, session_id: sessionId, payload: { turn: st.turn } });
        return;
      }
      if (ev.type === 'step/start') {
        st.step = (ev.data && ev.data.step) || st.step + 1;
        st.stepStartMs = t0; st.firstTokenMs = null;
        send(ws, { type: 'step_info', id: msg.id, session_id: sessionId, payload: { turn: st.turn, step: st.step } });
        return;
      }
      if (ev.type === 'assistant/chunk') {
        const c = ev.data && ev.data.chunk;
        if (!c) return;
        if (st.firstTokenMs == null && (c.type === 'text-delta' || c.type === 'reasoning-delta')) {
          st.firstTokenMs = t0 - st.stepStartMs;
        }
        if (c.type === 'text-delta' && c.text) {
          send(ws, { type: 'stream_token', id: msg.id, session_id: sessionId, payload: { token: c.text } });
        } else if (c.type === 'reasoning-delta' && c.text) {
          send(ws, { type: 'reasoning_delta', id: msg.id, session_id: sessionId, payload: { text: c.text } });
        } else if (c.type === 'tool-call-delta') {
          if (!st.curCall || st.curCall.id !== c.id) {
            st.curCall = { id: c.id, name: c.name || '', args: '' };
          }
          if (c.name) st.curCall.name = c.name;
          st.curCall.args += c.argumentsDelta || '';
          send(ws, { type: 'tool_call', id: msg.id, session_id: sessionId, payload: { id: st.curCall.id, name: st.curCall.name || '工具', arguments: st.curCall.args } });
        } else if (c.type === 'usage' && c.usage) {
          const u = c.usage;
          st.inTokens = (u.input_tokens ?? u.prompt_tokens ?? 0);
          st.outTokens = (u.output_tokens ?? u.completion_tokens ?? 0);
          st.cacheHit = (u.prompt_cache_hit_tokens ?? 0);
          st.cacheMiss = (u.prompt_cache_miss_tokens ?? 0);
        }
        return;
      }
      if (ev.type === 'tool/start' || ev.type === 'tool/call') {
        st.toolStartMs = t0;
        st.toolCount++;
        const name = (ev.data && (ev.data.tool || ev.data.name)) || (st.curCall && st.curCall.name) || '工具';
        send(ws, { type: 'tool_call', id: msg.id, session_id: sessionId, payload: { id: (ev.data && ev.data.id) || '', name: name, arguments: (ev.data && ev.data.arguments) || (st.curCall ? st.curCall.args : '') } });
        return;
      }
      if (ev.type === 'tool/result') {
        if (st.toolStartMs != null) st.toolMs += t0 - st.toolStartMs;
        st.toolStartMs = null;
        const d = ev.data || {};
        const msg2 = d.message || {};
        let resultTxt = '';
        try { resultTxt = typeof msg2.content === 'string' ? msg2.content : JSON.stringify(msg2.content); } catch (e) { resultTxt = String(msg2.content || ''); }
        if (resultTxt && resultTxt.length > 2000) resultTxt = resultTxt.slice(0, 2000) + '…';
        send(ws, { type: 'tool_result', id: msg.id, session_id: sessionId, payload: { name: d.tool || (msg2.tool_name) || '工具', ok: !ev.data.error, result: resultTxt, error: ev.data.error || null } });
        return;
      }
      if (ev.type === 'assistant/message') {
        const d = ev.data || {};
        if (st.stepStartMs != null) st.llmMs += t0 - st.stepStartMs;
        st.stepStartMs = null;
        if (d.usage) {
          const u = d.usage;
          st.inTokens = (u.input_tokens ?? u.prompt_tokens ?? st.inTokens);
          st.outTokens = (u.output_tokens ?? u.completion_tokens ?? st.outTokens);
          st.cacheHit = (u.prompt_cache_hit_tokens ?? st.cacheHit);
          st.cacheMiss = (u.prompt_cache_miss_tokens ?? st.cacheMiss);
        }
        send(ws, { type: 'assistant_done', id: msg.id, session_id: sessionId, payload: { turn: d.turn, step: d.step, interrupted: !!d.interrupted } });
        return;
      }
      if (ev.type === 'turn/end') {
        send(ws, { type: 'turn_stats', id: msg.id, session_id: sessionId, payload: { stats: buildStats(), reason: (ev.data && ev.data.reason) || '' } });
        return;
      }
    },
  });
  run.then((result) => {
    session.messages.push({ role: 'assistant', content: result.finalResponse || '' });
    appendFileSync(SESSIONS_FILE, JSON.stringify({ session_id: sessionId, ts: Date.now(), messages: session.messages }) + String.fromCharCode(10));
    send(ws, { type: 'stream_done', id: msg.id, session_id: sessionId, payload: { full_text: result.finalResponse || '', session_id: result.sessionId, stats: buildStats() } });
  }).catch((e) => {
    send(ws, { type: 'error', id: msg.id, session_id: sessionId, payload: { code: 'RUN_FAIL', message: e.message } });
  });
}

function handleConfig(ws, msg) {
  const action = msg.payload && msg.payload.action;
  if (action === 'list') {
    const models = (config.models || []).map((m) => ({
      id: m.id, name: m.name, baseUrl: m.baseUrl || '', modelId: m.modelId || '',
      apiKeyMasked: m.apiKeyBox ? (m.apiKeyMask || '') : '',
    }));
    return send(ws, { type: 'config_result', id: msg.id, payload: { models, activeModel: config.activeModel || null, agentVersion: '0.3.0' } });
  }
  if (action === 'save') {
    const m = msg.payload || {};
    if (!m.id || !m.modelId) return send(ws, { type: 'error', id: msg.id, payload: { code: 'BAD_CONFIG', message: '缺少模型配置' } });
    const models = config.models || [];
    const idx = models.findIndex((x) => x.id === m.id);
    const box = m.apiKey ? encryptSecret(m.apiKey) : (idx >= 0 ? models[idx].apiKeyBox : null);
    const entry = {
      id: m.id, name: m.name || m.id, baseUrl: m.baseUrl || '', modelId: m.modelId,
      apiKeyBox: box, apiKeyMask: m.apiKey ? maskKey(m.apiKey) : (idx >= 0 ? models[idx].apiKeyMask : ''),
    };
    if (idx >= 0) models[idx] = entry; else models.push(entry);
    config.models = models;
    if (m.active) config.activeModel = m.id;
    saveConfig(config);
    if (m.active || idx < 0) closeHarness().then(spawnHarness); /* 配置变更重启内核 */
    return send(ws, { type: 'config_result', id: msg.id, payload: { ok: true, models: models.map((x) => ({ id: x.id, name: x.name, apiKeyMasked: x.apiKeyMask || '' })) } });
  }
  if (action === 'delete') {
    const id = msg.payload && msg.payload.id;
    config.models = (config.models || []).filter((x) => x.id !== id);
    if (config.activeModel === id) config.activeModel = null;
    saveConfig(config);
    return send(ws, { type: 'config_result', id: msg.id, payload: { ok: true } });
  }
  send(ws, { type: 'error', id: msg.id, payload: { code: 'BAD_ACTION', message: '未知配置操作' } });
}

function handleHistory(ws, msg) {
  const sid = msg.payload && msg.payload.session_id;
  if (!sessions.has(sid)) return send(ws, { type: 'history_result', id: msg.id, payload: { messages: [] } });
  send(ws, { type: 'history_result', id: msg.id, payload: { messages: sessions.get(sid).messages } });
}

function maskKey(k) {
  const s = String(k || '');
  if (s.length <= 8) return '****';
  return s.slice(0, 3) + '...' + s.slice(-4);
}

wss.on('connection', (ws, req) => {
  const client = { authed: false, token: null, device: null };
  clients.set(ws, client);
  const remote = req.socket.remoteAddress || '';
  console.log('[conn] ' + remote);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return send(ws, { type: 'error', payload: { code: 'BAD_JSON', message: '消息格式错误' } }); }
    if (msg.type === 'heartbeat') return send(ws, { type: 'heartbeat', payload: { timestamp: Date.now() } });

    if (msg.type === 'auth' && msg.action === 'login') {
      const ok = await bcrypt.compare(String(msg.payload && msg.payload.password || ''), config.passwordHash || '');
      if (!ok) return send(ws, { type: 'auth_result', id: msg.id, payload: { success: false, error: '密码错误' } });
      client.authed = true;
      client.token = randomBytes(16).toString('hex');
      const conf = currentModelConf();
      return send(ws, {
        type: 'auth_result', id: msg.id,
        payload: {
          success: true, token: client.token,
          device_id: (os.hostname() || 'agent') + '-' + createHash('sha1').update(os.hostname()).digest('hex').slice(0, 6),
          /* v0.2：工作区与权限（管理员=full 全权限；分享用户=container 隔离容器，由 DSH 沙箱提供隔离） */
          workspace: { id: 'main', mode: 'full', label: '本机工作区' },
          capabilities: ['deepseek', 'tools', 'files', 'python'],
          active_model: conf ? { id: conf.id, name: conf.name, modelId: conf.modelId } : null,
          models: (config.models || []).map((m) => ({ id: m.id, name: m.name, apiKeyMasked: m.apiKeyMask || '' })),
        },
      });
    }

    if (!client.authed) return send(ws, { type: 'error', id: msg.id, payload: { code: 'AUTH_REQUIRED', message: '请先登录' } });

    switch (msg.type) {
      case 'chat': handleChat(ws, msg); break;
      case 'config': handleConfig(ws, msg); break;
      case 'history': handleHistory(ws, msg); break;
      case 'stop': send(ws, { type: 'error', id: msg.id, payload: { code: 'NOT_SUPPORTED', message: '中断生成暂不支持（v0.1）' } }); break;
      default: send(ws, { type: 'error', id: msg.id, payload: { code: 'UNKNOWN', message: '未知消息类型' } });
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

/* ---------- 启动 ---------- */
async function main() {
  console.log('ThirdHub-Agent v0.1.0');
  const ok = await ensurePassword();
  if (!ok) return;
  const ip = Object.values(os.networkInterfaces()).flat().find((x) => x && x.family === 'IPv4' && !x.internal);
  console.log('WS 服务已启动：ws://' + (ip ? ip.address : '127.0.0.1') + ':' + PORT);
  console.log('在 ThirdHub 前端「算力」中添加设备，使用上面的地址与访问密码连接');
  await spawnHarness().catch((e) => console.error('[agent] DSH 内核启动失败：', e.message));
}
main();
