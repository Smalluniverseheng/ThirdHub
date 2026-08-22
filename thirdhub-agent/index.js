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
import http from 'http';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
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


/* ---------- v0.3 设备自动发现与一键配对 ---------- */
const SB_URL = 'https://mxvxlgjzeboktufumxbp.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODM5OTcsImV4cCI6MjA5OTk1OTk5N30.QjSLfYAFhwX72YSeAcbTN5O2_PDLaNcv76HhdGJsqpo';
const DEVICE_FILE = path.join(DATA_DIR, 'device.json');
function loadDevice() {
  try {
    if (existsSync(DEVICE_FILE)) return JSON.parse(readFileSync(DEVICE_FILE, 'utf8'));
  } catch (e) {}
  const d = {
    device_id: (os.hostname() || 'agent') + '-' + randomBytes(3).toString('hex'),
    secret: randomBytes(16).toString('hex'),
    name: os.hostname() || 'ThirdHub-Agent',
    owner: null,
  };
  try { writeFileSync(DEVICE_FILE, JSON.stringify(d, null, 2)); } catch (e) {}
  return d;
}
function saveDevice() {
  try { writeFileSync(DEVICE_FILE, JSON.stringify(device, null, 2)); } catch (e) {}
}
const device = loadDevice();
const deviceSecretHash = () => createHash('sha256').update(device.secret).digest('hex');
async function sbRpc(fn, body) {
  try {
    const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
function lanIps() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((x) => x && x.family === 'IPv4' && !x.internal)
    .map((x) => x.address);
}
function isLanIp(ip) {
  ip = String(ip || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
/* ---------- v0.3.2 公网中继(cloudflared quick tunnel):HTTPS 页面(PNA 限制)也能连后端 ---------- */
const CF_BIN = path.join(__dirname, 'cloudflared.exe');
let relayUrl = null;
let cfProc = null;
async function ensureRelay() {
  try {
    if (cfProc) return relayUrl;
    if (!existsSync(CF_BIN)) {
      console.log('[relay] 未找到 cloudflared.exe(放在 agent 目录可启用公网中继,手机 Chrome 无法直连局域网时必备)');
      return null;
    }
    console.log('[relay] 启动 cloudflared quick tunnel...');
    cfProc = spawn(CF_BIN, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    const feed = (d) => {
      buf += d.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !relayUrl) { relayUrl = m[0]; console.log('[relay] 公网中继地址: ' + relayUrl); }
      if (buf.length > 131072) buf = buf.slice(-65536);
    };
    cfProc.stdout.on('data', feed);
    cfProc.stderr.on('data', feed);
    cfProc.on('exit', (c) => { relayUrl = null; cfProc = null; console.log('[relay] cloudflared 已退出 code=' + c); });
    for (let i = 0; i < 20 && !relayUrl; i++) await new Promise((r) => setTimeout(r, 1000));
    return relayUrl;
  } catch (e) { console.log('[relay] 启动失败: ' + e.message); return null; }
}
async function relayStatus() {
  if (!relayUrl) await ensureRelay();
  return relayUrl || '';
}

async function beat() {
  const r = await sbRpc('device_ping', {
    p_device_id: device.device_id, p_secret_hash: deviceSecretHash(),
    p_name: device.name, p_lan_ips: lanIps(), p_public_ip: '', p_version: '0.3.3', p_relay: relayUrl || '',
  });
  if (r && r.ok) {
    if (r.status === 'bound' && r.owner && String(r.owner) !== String(device.owner || '')) {
      device.owner = r.owner; saveDevice();
    }
    if (r.status === 'unbound' && device.owner) { device.owner = null; saveDevice(); }
  }
}
/* HTTP 发现端口（9601）：/discover 返回设备信息，前端探测用 */
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/discover') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ device_id: device.device_id, name: device.name, version: '0.3.3', bound: !!device.owner, port: PORT, relay: relayUrl || '' }));
    return;
  }
  if (u.pathname === '/panel') {
    if (!PANEL_HTML) { try { PANEL_HTML = readFileSync(path.join(__dirname, 'panel.html'), 'utf8'); } catch (e) { PANEL_HTML = '<h1>panel.html 缺失</h1>'; } }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(PANEL_HTML);
    return;
  }
  if (u.pathname === '/api/panel') {
    if (req.method === 'POST') { let b = ''; req.on('data', (d) => { b += d; if (b.length > 1048576) req.destroy(); }); req.on('end', () => { try { const j = JSON.parse(b || '{}'); panelApi(String(j.action || ''), j.payload || {}, res); } catch (e) { res.end(JSON.stringify({ ok: false, error: 'bad json' })); } }); return; }
    const u2 = new URL(req.url, 'http://x');
    panelApi(String(u2.searchParams.get('action') || ''), {}, res);
    return;
  }
  if (u.pathname === '/relay') {
    relayStatus().then((r2) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ relay: r2 })); });
    return;
  }
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
  res.end('ThirdHub-Agent discover endpoint');
}).listen(9601, '0.0.0.0');

/* 注册 + 心跳（每 30s） */
beat();
setInterval(beat, 30000);
ensureRelay().then((u) => { if (u) console.log("[relay] 就绪: " + u); });

/* ---------- WS 服务 ---------- */

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
wss.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') { console.log('[agent] 端口 ' + PORT + ' 已被占用,跳过启动(已有实例在运行)'); process.exit(0); }
  throw e;
});
const clients = new Map(); // ws -> { authed, token, device }

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  for (const [ws] of clients) if (ws !== except && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/* v0.3.2：chat 串行队列 —— 多设备同时对话时不冲突（DSH 内核单实例，逐条执行） */
let chatChain = Promise.resolve();

/* ---------- v0.4 DSH 工作台:转发 DSH Web API(client-request 信封) ---------- */
let dshWeb = null;
async function findDshWeb() {
  if (dshWeb) return dshWeb;
  for (const port of [3789, 3790, 3788]) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/host.describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:' + port, Referer: 'http://127.0.0.1:' + port + '/' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'probe-' + Date.now(), method: 'host.describe', payload: {} }),
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) { dshWeb = 'http://127.0.0.1:' + port; console.log('[dsh] 发现 DSH Web: ' + dshWeb); return dshWeb; }
    } catch (e) {}
  }
  return null;
}
/* ---------- v7.1 ThirdHub 后端化:书源托管 / 电子书存储 / 搜索执行(DSH 插件底座) ---------- */
const DATA_FILE = path.join(DATA_DIR, 'backend.json');
function loadBackend() {
  try { if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  return { sources: [], storageDir: path.join(os.homedir(), 'ThirdHub'), books: [] };
}
function saveBackend() { try { writeFileSync(DATA_FILE, JSON.stringify(backend, null, 2)); } catch (e) {} }
const backend = loadBackend();
const B_MIME = { '.epub': 'application/epub+zip', '.pdf': 'application/pdf', '.txt': 'text/plain', '.mobi': 'application/x-mobipocket-ebook', '.azw3': 'application/vnd.amazon.ebook', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.zip': 'application/zip', '.cbz': 'application/zip', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.jpeg': 'image/jpeg' };
async function handleBackend(ws, msg) {
  const p = (msg.payload || {});
  const act = String(p.action || '');
  try {
    if (act === 'storage.setDir') {
      const dir = String(p.dir || '').trim();
      if (!dir) return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '目录不能为空' } });
      try { mkdirSync(dir, { recursive: true }); } catch (e) {}
      backend.storageDir = dir; saveBackend();
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, dir } });
    }
    if (act === 'storage.get') {
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, dir: backend.storageDir, books: backend.books } });
    }
    if (act === 'storage.import') {
      const name = String(p.name || 'book-' + Date.now());
      const data = String(p.data || '');
      if (!data) return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '缺少文件数据(base64)' } });
      const ext = String(p.ext || '.bin').toLowerCase();
      mkdirSync(backend.storageDir, { recursive: true });
      const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      const fpath = path.join(backend.storageDir, safe + ext);
      writeFileSync(fpath, Buffer.from(data, 'base64'));
      const meta = { id: 'b' + Date.now().toString(36), name: safe, ext, path: fpath, size: Buffer.byteLength(data, 'base64'), ts: Date.now() };
      backend.books.push(meta); saveBackend();
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, book: meta } });
    }
    if (act === 'storage.delete') {
      const id = String(p.id || '');
      const i = backend.books.findIndex((x) => x.id === id);
      if (i < 0) return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '未找到' } });
      try { unlinkSync(backend.books[i].path); } catch (e) {}
      backend.books.splice(i, 1); saveBackend();
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true } });
    }
    if (act === 'sources.import') {
      const list = Array.isArray(p.sources) ? p.sources : [];
      for (const s of list) {
        if (!s || !s.id) continue;
        const i = backend.sources.findIndex((x) => x.id === s.id);
        if (i >= 0) backend.sources[i] = Object.assign({}, backend.sources[i], s);
        else backend.sources.push(s);
      }
      saveBackend();
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, count: list.length, total: backend.sources.length } });
    }
    if (act === 'sources.list') {
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, sources: backend.sources } });
    }
    if (act === 'sources.delete') {
      const id = String(p.id || '');
      const before = backend.sources.length;
      backend.sources = backend.sources.filter((x) => x.id !== id);
      saveBackend();
      return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, removed: before - backend.sources.length } });
    }
    if (act === 'search') {
      /* 搜索执行:后端用 Node fetch 执行简单规则书源(GET/POST + JSON/正则解析),浏览器指纹类书源会失败并提示 */
      const kw = String(p.kw || '').trim();
      const type = String(p.type || 'novel');
      const src = backend.sources.find((x) => x.id === p.sourceId) || (p.source ? p.source : null);
      if (!src || !src.searchUrl) return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '该书源缺少 searchUrl,无法后端执行' } });
      if (!kw) return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '搜索词为空' } });
      const url = String(src.searchUrl).replace(/{key}|{kw}|%s/g, encodeURIComponent(kw));
      const headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json, text/html, */*' }, src.headers || {});
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(url, { method: src.searchMethod === 'POST' ? 'POST' : 'GET', headers, body: src.searchMethod === 'POST' ? (src.searchBody ? String(src.searchBody).replace(/{key}|{kw}/g, kw) : undefined) : undefined, signal: ctl.signal, redirect: 'follow' });
        const text2 = await r.text();
        let items = [];
        if (src.searchParse === 'json' && src.searchItems) {
          try {
            const j = JSON.parse(text2);
            const arr = src.searchItems.split('.').reduce((o, k) => (o == null ? o : o[k]), j);
            items = (Array.isArray(arr) ? arr : []).slice(0, 30).map((it) => ({
              title: pickField(it, src.searchTitle),
              author: pickField(it, src.searchAuthor),
              cover: pickField(it, src.searchCover),
              url: pickField(it, src.searchUrlItem) || '',
              source: src.name || src.id,
            })).filter((x) => x.title);
          } catch (e) {}
        } else {
          /* 简易 HTML 正则:itemRegex 捕获 title / link / author */
          if (src.itemRegex) {
            const re = new RegExp(src.itemRegex, 'g');
            let m; let n = 0;
            while ((m = re.exec(text2)) && n < 30) {
              items.push({ title: (m[1] || '').trim(), url: (m[2] || '').trim(), author: (m[3] || '').trim(), source: src.name || src.id });
              n++;
            }
            items = items.filter((x) => x.title);
          }
        }
        clearTimeout(timer);
        return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: true, items, type } });
      } catch (e) {
        clearTimeout(timer);
        return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '执行失败:' + String((e && e.message) || e).slice(0, 120) } });
      }
    }
    return send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: '未知操作 ' + act } });
  } catch (e) {
    send(ws, { type: 'backend_result', id: msg.id, payload: { ok: false, error: String((e && e.message) || e).slice(0, 160) } });
  }
}
function pickField(o, path2) {
  if (!path2) return '';
  const v = path2.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  return v == null ? '' : String(v);
}

/* ---------- v7.2 /panel:ThirdHub 后端面板(书源/存储/搜索/任务) ---------- */
let PANEL_HTML = null;
async function panelApi(action, payload, res) {
  try {
    if (action === 'storage.get') {
      return res.end(JSON.stringify({ ok: true, dir: backend.storageDir, books: backend.books }));
    }
    if (action === 'storage.setDir') {
      const dir = String((payload && payload.dir) || '').trim();
      if (!dir) return res.end(JSON.stringify({ ok: false, error: '目录不能为空' }));
      try { mkdirSync(dir, { recursive: true }); } catch (e) {}
      backend.storageDir = dir; saveBackend();
      return res.end(JSON.stringify({ ok: true, dir }));
    }
    if (action === 'sources.list') {
      return res.end(JSON.stringify({ ok: true, sources: backend.sources }));
    }
    if (action === 'sources.delete') {
      backend.sources = backend.sources.filter((x) => x.id !== (payload && payload.id));
      saveBackend();
      return res.end(JSON.stringify({ ok: true }));
    }
    if (action === 'storage.delete') {
      const i = backend.books.findIndex((x) => x.id === (payload && payload.id));
      if (i >= 0) { try { unlinkSync(backend.books[i].path); } catch (e) {} backend.books.splice(i, 1); saveBackend(); }
      return res.end(JSON.stringify({ ok: true }));
    }
    if (action === 'search') {
      const kw = String((payload && payload.kw) || '').trim();
      const src = backend.sources.find((x) => x.id === (payload && payload.sourceId));
      if (!src || !src.searchUrl) return res.end(JSON.stringify({ ok: false, error: '书源缺少 searchUrl' }));
      const url = String(src.searchUrl).replace(/{key}|{kw}|%s/g, encodeURIComponent(kw));
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/html, */*' }, signal: AbortSignal.timeout(15000) });
      const text2 = await r.text();
      let items = [];
      if (src.searchParse === 'json' && src.searchItems) {
        try { const j = JSON.parse(text2); const arr = src.searchItems.split('.').reduce((o, k) => (o == null ? o : o[k]), j); items = (Array.isArray(arr) ? arr : []).slice(0, 30).map((it) => ({ title: pickField(it, src.searchTitle), author: pickField(it, src.searchAuthor), cover: pickField(it, src.searchCover), url: pickField(it, src.searchUrlItem), source: src.name || src.id })).filter((x) => x.title); } catch (e) {}
      } else if (src.itemRegex) {
        const re = new RegExp(src.itemRegex, 'g'); let m; let n = 0;
        while ((m = re.exec(text2)) && n < 30) { items.push({ title: (m[1] || '').trim(), url: (m[2] || '').trim(), author: (m[3] || '').trim(), source: src.name || src.id }); n++; }
      }
      return res.end(JSON.stringify({ ok: true, items }));
    }
    if (action === 'taskboard') {
      const web = await findDshWeb();
      if (!web) return res.end(JSON.stringify({ ok: true, connected: false }));
      const r2 = await fetch(web + '/api/task-board/state', { headers: { Origin: web, Referer: web + '/' }, signal: AbortSignal.timeout(8000) });
      const j = await r2.json().catch(() => ({}));
      return res.end(JSON.stringify({ ok: true, connected: true, tasks: (j.tasks || []).slice(0, 10), running: (j.power && j.power.runningSessions) || 0 }));
    }
    return res.end(JSON.stringify({ ok: false, error: '未知操作' }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e).slice(0, 160) }));
  }
}

async function handleDsh(ws, msg) {
  const p = (msg.payload || {});
  const path = String(p.path || '');
  const method = String(p.method || 'POST').toUpperCase();
  const payload = (p.payload && typeof p.payload === 'object') ? p.payload : {};
  if (!path) return send(ws, { type: 'error', id: msg.id, payload: { code: 'BAD_ARGS', message: '缺少 path' } });
  const web = await findDshWeb();
  if (!web) return send(ws, { type: 'error', id: msg.id, payload: { code: 'NO_DSH_WEB', message: '本机未运行 DSH Web(端口 3789),请先在电脑上启动 dsh web' } });
  try {
    const headers = { Origin: web, Referer: web + '/' };
    let r;
    if (method === 'GET') {
      r = await fetch(web + path, { headers, signal: AbortSignal.timeout(20000) });
    } else {
      const body = JSON.stringify({ type: 'client-request', rpcId: 'ag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), method: path.replace(/^\/api\//, ''), payload });
      r = await fetch(web + path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(25000) });
    }
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch (e) { j = { raw: t.slice(0, 800) }; }
    send(ws, { type: 'dsh_result', id: msg.id, payload: { ok: r.ok, status: r.status, data: j } });
  } catch (e) {
    send(ws, { type: 'error', id: msg.id, payload: { code: 'DSH_ERR', message: String((e && e.message) || e).slice(0, 200) } });
  }
}


/* ---------- v9.2 审批联动:订阅 DSH Web mux SSE → 审批/提问转发到手机 → 远程批准 ---------- */
let muxActive = false;
let muxTimer = null;
function broadcastAuthed(msg) {
  for (const [ws, cl] of clients) if (cl.authed && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
async function startApprovalStream() {
  if (muxTimer) return;
  const FRAME_TYPES = ['approval/requested', 'approval/resolved', 'question/requested', 'question/resolved'];
  const tick = async () => {
    if (muxActive) return;
    const web = await findDshWeb();
    if (!web) return;
    muxActive = true;
    try {
      const r = await fetch(web + '/api/events.mux', {
        headers: { Origin: web, Referer: web + '/', Accept: 'text/event-stream' },
      });
      if (!r.ok || !r.body) throw new Error('mux HTTP ' + r.status);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
          if (!data) continue;
          let j; try { j = JSON.parse(data); } catch (e) { continue; }
          const frame = j && j.payload;
          if (frame && FRAME_TYPES.includes(frame.type)) {
            broadcastAuthed({ type: 'approval_event', payload: { rpcId: j.rpcId || '', frame } });
          }
        }
      }
    } catch (e) {
      /* 连接中断:等下一轮定时器重连 */
    } finally {
      muxActive = false;
    }
  };
  muxTimer = setInterval(tick, 5000);
  tick();
  console.log('[dsh] 审批联动已启用(订阅 /api/events.mux)');
}

async function handleApproval(ws, msg) {
  const p = (msg.payload || {});
  const action = String(p.action || '');
  const rpcId = String(p.rpcId || '');
  const sessionId = String(p.sessionId || '');
  if (!rpcId) return send(ws, { type: 'error', id: msg.id, payload: { code: 'BAD_ARGS', message: '缺少 rpcId' } });
  const web = await findDshWeb();
  if (!web) return send(ws, { type: 'error', id: msg.id, payload: { code: 'NO_DSH_WEB', message: '本机未运行 DSH Web(端口 3789),请先在电脑上启动 dsh web' } });
  let result;
  if (action === 'approve') result = { ok: true, value: { sessionId, approvalId: String(p.approvalId || ''), outcome: 'allowed-once' } };
  else if (action === 'reject') result = { ok: true, value: { sessionId, approvalId: String(p.approvalId || ''), outcome: 'rejected' } };
  else if (action === 'answer') result = { ok: true, value: { sessionId, answer: { answers: Array.isArray(p.answers) ? p.answers : [] } } };
  else if (action === 'cancel') result = { ok: false, error: { code: 'cancelled', message: 'the user cancelled ask_user_question' } };
  else return send(ws, { type: 'error', id: msg.id, payload: { code: 'BAD_ARGS', message: '未知审批操作' } });
  try {
    const r = await fetch(web + '/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: web, Referer: web + '/' },
      body: JSON.stringify({ type: 'client-response', rpcId, result }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    send(ws, { type: 'approval_result', id: msg.id, payload: { accepted: !!j.accepted, reason: j.reason || '' } });
  } catch (e) {
    send(ws, { type: 'error', id: msg.id, payload: { code: 'DSH_ERR', message: String((e && e.message) || e).slice(0, 200) } });
  }
}
/* v7.1：当前对话(用于停止) */
let currentChat = null;
let stoppingFlag = false;
async function handleChat(ws, msg) {
  const payload = msg.payload || {};
  currentChat = { ws, msgId: msg.id, sessionId: msg.session_id || 'default' };
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
    if (stoppingFlag) {
      stoppingFlag = false;
      send(ws, { type: 'stream_done', id: msg.id, session_id: sessionId, payload: { full_text: '', session_id: sessionId, stopped: true, stats: null } });
    } else {
      send(ws, { type: 'error', id: msg.id, session_id: sessionId, payload: { code: 'RUN_FAIL', message: e.message } });
    }
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

    if (msg.type === 'auth' && msg.action === 'pair') {
      const token = String(msg.payload && msg.payload.token || '');
      const r = await sbRpc('device_pair_claim', { p_device_id: device.device_id, p_token: token });
      if (r && r.ok) {
        device.owner = r.user_id; saveDevice();
        client.authed = true; client.token = randomBytes(16).toString('hex');
        const conf2 = currentModelConf();
        return send(ws, { type: 'auth_result', id: msg.id, payload: { success: true, token: client.token, paired: true, owner: r.user_id, device_id: device.device_id, workspace: { id: 'main', mode: 'full', label: '本机工作区' }, capabilities: ['deepseek', 'tools', 'files', 'python'], active_model: conf2 ? { id: conf2.id, name: conf2.name, modelId: conf2.modelId } : null, models: (config.models || []).map((m) => ({ id: m.id, name: m.name, apiKeyMasked: m.apiKeyMask || '' })) } });
      }
      return send(ws, { type: 'auth_result', id: msg.id, payload: { success: false, error: '配对失败（令牌无效或已过期）' } });
    }

    if (msg.type === 'auth' && msg.action === 'login') {
      const pw = String(msg.payload && msg.payload.password || '');
      /* 已配对设备：同局域网免密登录（一键配对后无需再输密码） */
      if (!pw && device.owner && isLanIp(remote)) {
        client.authed = true; client.token = randomBytes(16).toString('hex');
        const conf3 = currentModelConf();
        return send(ws, { type: 'auth_result', id: msg.id, payload: { success: true, token: client.token, paired: true, owner: device.owner, device_id: device.device_id, workspace: { id: 'main', mode: 'full', label: '本机工作区' }, capabilities: ['deepseek', 'tools', 'files', 'python'], active_model: conf3 ? { id: conf3.id, name: conf3.name, modelId: conf3.modelId } : null, models: (config.models || []).map((m) => ({ id: m.id, name: m.name, apiKeyMasked: m.apiKeyMask || '' })) } });
      }
      const ok = await bcrypt.compare(pw, config.passwordHash || '');
      if (!ok) return send(ws, { type: 'auth_result', id: msg.id, payload: { success: false, error: '密码错误' } });
      client.authed = true;
      client.token = randomBytes(16).toString('hex');
      const conf = currentModelConf();
      return send(ws, {
        type: 'auth_result', id: msg.id,
        payload: {
          success: true, token: client.token,
          device_id: device.device_id,
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
      case 'chat': chatChain = chatChain.then(() => handleChat(ws, msg)).catch((e) => { try { send(ws, { type: 'error', id: msg.id, payload: { code: 'CHAT_ERROR', message: String((e && e.message) || e) } }); } catch (err) {} }); break;
      case 'dsh': handleDsh(ws, msg); break;
      case 'backend': handleBackend(ws, msg); break;
      case 'dsh_approval': handleApproval(ws, msg); break;
      case 'config': handleConfig(ws, msg); break;
      case 'history': handleHistory(ws, msg); break;
      case 'stop': {
        const cur = currentChat;
        stoppingFlag = true;
        if (cur && cur.ws) {
          try { await closeHarness(); } catch (err) {}
          try { send(cur.ws, { type: 'stream_done', id: cur.msgId, session_id: cur.sessionId, payload: { full_text: '', stopped: true, stats: null } }); } catch (err) {}
        }
        send(ws, { type: 'stop_result', id: msg.id, payload: { ok: true, stopped: !!cur } });
        currentChat = null;
        break;
      }
      default: send(ws, { type: 'error', id: msg.id, payload: { code: 'UNKNOWN', message: '未知消息类型' } });
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

/* ---------- 启动 ---------- */
async function main() {
  console.log('ThirdHub-Agent v0.3.3');
  const ok = await ensurePassword();
  if (!ok) return;
  const ip = Object.values(os.networkInterfaces()).flat().find((x) => x && x.family === 'IPv4' && !x.internal);
  console.log('WS 服务已启动：ws://' + (ip ? ip.address : '127.0.0.1') + ':' + PORT);
  console.log('在 ThirdHub 前端「算力」中添加设备，使用上面的地址与访问密码连接');
  await spawnHarness().catch((e) => console.error('[agent] DSH 内核启动失败：', e.message));
  startApprovalStream();
}
main();
