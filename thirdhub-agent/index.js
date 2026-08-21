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

function handleChat(ws, msg) {
  const payload = msg.payload || {};
  const text = String(payload.text || '').trim();
  if (!text) return send(ws, { type: 'error', id: msg.id, payload: { code: 'EMPTY', message: '消息为空' } });
  const sessionId = msg.session_id || 'default';
  if (!sessions.has(sessionId)) sessions.set(sessionId, { messages: [] });
  const session = sessions.get(sessionId);
  session.messages.push({ role: 'user', content: text });

  if (!harness) spawnHarness().catch((e) => send(ws, { type: 'error', id: msg.id, payload: { code: 'NO_ENGINE', message: 'DSH 内核未就绪：' + e.message } }));
  const run = harness.run(text, {
    sessionId: sessionId === 'default' ? undefined : sessionId,
    onNotification: (n) => {
      const p = n.params || {};
      if (n.method === 'session.event') {
        const ev = p.event;
        if (!ev) return;
        if (ev.type === 'assistant/chunk') {
          const c = ev.data && ev.data.chunk;
          if (c && c.type === 'text-delta' && c.text) {
            send(ws, { type: 'stream_token', id: msg.id, session_id: sessionId, payload: { token: c.text } });
          }
        }
        if (ev.type === 'tool/start' || ev.type === 'tool/call') {
          send(ws, { type: 'tool_call', id: msg.id, session_id: sessionId, payload: { tool_name: (ev.data && (ev.data.tool || ev.data.name)) || '工具', arguments: ev.data } });
        }
        if (ev.type === 'tool/result') {
          send(ws, { type: 'tool_result', id: msg.id, session_id: sessionId, payload: { tool_name: (ev.data && ev.data.tool) || '工具', result: ev.data } });
        }
      }
    },
  });
  run.then((result) => {
    session.messages.push({ role: 'assistant', content: result.finalResponse || '' });
    appendFileSync(SESSIONS_FILE, JSON.stringify({ session_id: sessionId, ts: Date.now(), messages: session.messages }) + String.fromCharCode(10));
    send(ws, { type: 'stream_done', id: msg.id, session_id: sessionId, payload: { full_text: result.finalResponse || '', session_id: result.sessionId } });
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
    return send(ws, { type: 'config_result', id: msg.id, payload: { models, activeModel: config.activeModel || null, agentVersion: '0.1.0' } });
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
