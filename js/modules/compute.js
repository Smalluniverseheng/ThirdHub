/* ===== ThirdHub js/modules/compute.js — 本地算力（v5.0） =====
   管理本地 AI 计算节点（ThirdHub-Agent + DSH）：
   - 添加设备（IP:端口 + 访问密码）→ WebSocket 连接 + 认证
   - 设备状态 / 模型 / 能力展示
   - 连接池供 AI 对话页「本地模式」复用：send(deviceId,msg) + onMessage(cb)
   配置存 localStorage：compute:devices */
import { $, $$, el, esc, icon, toast, modal } from '../ui.js';
import { kvGet, kvSet, on, emit } from '../store.js';

const DEV_KEY = 'compute:devices';
const wsPool = new Map(); // deviceId -> { ws, status }
const msgHandlers = new Set();

/* ---------- 连接池 API（供 ai-chat 本地模式使用） ---------- */
export function listDevices() {
  try { return (JSON.parse(localStorage.getItem(DEV_KEY) || '[]')); } catch (e) { return []; }
}
async function saveDevices(list) { localStorage.setItem(DEV_KEY, JSON.stringify(list)); }

export function getStatus(deviceId) {
  const c = wsPool.get(deviceId);
  return c ? c.status : 'offline';
}
export function onAgentMessage(cb) { msgHandlers.add(cb); return () => msgHandlers.delete(cb); }
function fire(msg, deviceId) { msgHandlers.forEach((cb) => { try { cb(msg, deviceId); } catch (e) {} }); }

export function sendToDevice(deviceId, msg) {
  const c = wsPool.get(deviceId);
  if (!c || c.status !== 'online' || !c.ws || c.ws.readyState !== 1) return false;
  c.ws.send(JSON.stringify(msg));
  return true;
}

/* 连接设备：返回 Promise<{ok, info?}> */
export async function connectDevice(dev, { silent = false } = {}) {
  const old = wsPool.get(dev.id);
  if (old && old.ws) { try { old.ws.close(); } catch (e) {} }
  const ws = new WebSocket('ws://' + dev.host + ':' + dev.port);
  const c = { ws, status: 'connecting', info: null };
  wsPool.set(dev.id, c);

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('连接超时（请确认后端已启动、地址正确）')), 8000));
  const authResult = new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', action: 'login', id: 'auth-' + Date.now(), payload: { password: dev.password || '' } }));
    };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'auth_result') {
        if (msg.payload && msg.payload.success) { resolve(msg.payload); }
        else reject(new Error((msg.payload && msg.payload.error) || '认证失败'));
      }
      if (msg.type === 'error' && msg.payload && msg.payload.code === 'AUTH_REQUIRED') {
        reject(new Error('需要访问密码'));
      }
      fire(msg, dev.id);
    };
    ws.onerror = () => reject(new Error('无法连接（后端未启动或地址错误）'));
    ws.onclose = () => {
      c.status = 'offline';
      emit('compute:status', { id: dev.id, status: 'offline' });
    };
  });
  try {
    const info = await Promise.race([authResult, timeout]);
    c.status = 'online';
    c.info = info;
    emit('compute:status', { id: dev.id, status: 'online', info });
    if (!silent) toast('已连接 ' + (dev.name || dev.host));
    return { ok: true, info };
  } catch (e) {
    c.status = 'error';
    try { ws.close(); } catch (err) {}
    emit('compute:status', { id: dev.id, status: 'error' });
    return { ok: false, error: e.message };
  }
}

export function disconnectDevice(deviceId) {
  const c = wsPool.get(deviceId);
  if (c && c.ws) { try { c.ws.close(); } catch (e) {} }
  c.status = 'offline';
  emit('compute:status', { id: deviceId, status: 'offline' });
}

/* ---------- 板块页面 ---------- */
export async function renderCompute(page) {
  const devices = listDevices();

  function deviceCard(dev) {
    const st = getStatus(dev.id);
    const info = wsPool.get(dev.id) ? wsPool.get(dev.id).info : null;
    return `<div class="cp-device" data-dev="${dev.id}">
      <div class="cp-dev-head">
        <span class="cp-dev-ico">${icon('cpu')}</span>
        <div style="min-width:0">
          <div class="cp-dev-name">${esc(dev.name || dev.host)}</div>
          <div class="cp-dev-addr">${esc(dev.host)}:${esc(dev.port)}</div>
        </div>
        <span class="cp-dev-status">
          <span class="cp-dot ${st === 'online' ? 'on' : st === 'error' ? 'err' : ''}"></span>
          ${st === 'online' ? '在线' : st === 'connecting' ? '连接中…' : st === 'error' ? '失败' : '离线'}
        </span>
      </div>
      <div class="cp-dev-meta" data-role="meta">
        ${st === 'online' && info ? `
          <span class="cp-chip ok">已认证</span>
          <span class="cp-chip">${esc(info.device_id || '')}</span>
          ${info.active_model ? `<span class="cp-chip">模型：${esc(info.active_model.name || info.active_model.modelId)}</span>` : ''}
          ${(info.capabilities || []).map((c) => `<span class="cp-chip">${esc(c)}</span>`).join('')}
        ` : '<span class="cp-chip">未连接</span>'}
      </div>
      <div class="cp-actions">
        ${st === 'online' ? `<button class="btn btn-sm" data-a="disc">断开</button>` : `<button class="btn btn-sm btn-primary" data-a="conn">连接</button>`}
        <button class="btn btn-sm" data-a="edit">编辑</button>
        <button class="btn btn-sm" data-a="del">删除</button>
      </div>
    </div>`;
  }

  function render() {
    page.innerHTML = `
      <div class="page-head">
        <div class="page-title">算力</div>
        <div class="spacer"></div>
        <button class="icon-btn" data-a="add" title="添加设备">${icon('plus')}</button>
      </div>
      <div class="cp-wrap">
        <div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:14px">
          连接你电脑上运行的 <b>ThirdHub-Agent</b>（基于 DeepSeek Harness），
          即可在浏览器之外使用完整 Agent 能力：本地工具、文件读写、代码执行、MCP 服务。
          设备端启动：<code>npm i -g thirdhub-agent && thirdhub-agent</code>
        </div>
        <div data-role="list">
          ${devices.length ? devices.map(deviceCard).join('') : `
            <div class="cp-empty">
              ${icon('cpu')}<br>
              还没有添加算力设备<br>
              <span style="font-size:12px">点击右上角 ＋ 添加（输入后端地址与访问密码）</span>
            </div>`}
        </div>
        <button class="cp-add" data-a="add2">＋ 添加设备</button>
      </div>`;
    $$('[data-a="add"], [data-a="add2"]', page).forEach((b) => b.onclick = showAddDialog);
    $$('[data-a="conn"]', page).forEach((b) => b.onclick = async () => {
      const dev = devices.find((d) => d.id === b.closest('[data-dev]').dataset.dev);
      b.textContent = '连接中…';
      const r = await connectDevice(dev);
      render();
      if (!r.ok) toast(r.error, 'err');
    });
    $$('[data-a="disc"]', page).forEach((b) => b.onclick = () => {
      const dev = devices.find((d) => d.id === b.closest('[data-dev]').dataset.dev);
      disconnectDevice(dev.id); render();
    });
    $$('[data-a="del"]', page).forEach((b) => b.onclick = async () => {
      const dev = devices.find((d) => d.id === b.closest('[data-dev]').dataset.dev);
      const { confirmDialog } = await import('../ui.js');
      if (!(await confirmDialog('删除设备', '将删除「' + dev.name + '」的配置（不影响后端）', '删除', true))) return;
      disconnectDevice(dev.id);
      const list = listDevices().filter((d) => d.id !== dev.id);
      saveDevices(list);
      render();
    });
    $$('[data-a="edit"]', page).forEach((b) => b.onclick = () => {
      const dev = devices.find((d) => d.id === b.closest('[data-dev]').dataset.dev);
      showAddDialog(dev);
    });
  }

  function showAddDialog(dev = null) {
    const d = dev || { name: '', host: '', port: '9600', password: '' };
    const m = modal({
      title: dev ? '编辑设备' : '添加本地设备',
      body: el(`<div class="cp-form">
        <div>
          <div class="muted mb8" style="font-size:12.5px">设备名称</div>
          <input class="input" data-f="name" placeholder="如：我的笔记本" value="${esc(d.name)}">
        </div>
        <div>
          <div class="muted mb8" style="font-size:12.5px">后端地址（IP 或域名）</div>
          <input class="input" data-f="host" placeholder="192.168.1.5" value="${esc(d.host)}">
        </div>
        <div>
          <div class="muted mb8" style="font-size:12.5px">端口</div>
          <input class="input" data-f="port" placeholder="9600" value="${esc(d.port)}">
        </div>
        <div>
          <div class="muted mb8" style="font-size:12.5px">访问密码（后端启动时设置）</div>
          <input class="input" type="password" data-f="password" placeholder="后端访问密码" value="${esc(d.password)}">
        </div>
        <div class="cp-hint">提示：后端在你电脑上运行 thirdhub-agent 启动；首次启动会要求设置访问密码。设备密码仅保存在本机浏览器。</div>
      </div>`),
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">' + (dev ? '保存' : '连接') + '</button>',
    });
    {
      $('[data-a="cancel"]', m.mask).onclick = () => m.close();
      $('[data-a="ok"]', m.mask).onclick = async () => {
        const name = $('[data-f="name"]', m.mask).value.trim();
        const host = $('[data-f="host"]', m.mask).value.trim();
        const port = ($('[data-f="port"]', m.mask).value.trim() || '9600').replace(/\D/g, '');
        const password = $('[data-f="password"]', m.mask).value;
        if (!host) return toast('请填写后端地址');
        const list = listDevices();
        let entry;
        if (dev) {
          entry = { ...dev, name: name || host, host, port, password };
          const idx = list.findIndex((x) => x.id === dev.id);
          if (idx >= 0) list[idx] = entry;
          disconnectDevice(dev.id);
        } else {
          entry = { id: 'dev-' + Date.now().toString(36), name: name || host, host, port, password };
          list.push(entry);
        }
        saveDevices(list);
        m.close();
        render();
        toast('连接中…');
        const r = await connectDevice(entry, { silent: true });
        render();
        if (!r.ok) toast(r.error, 'err');
      };
    }
  }

  /* 状态变化时刷新页面（在线状态等） */
  const off = on('compute:status', () => { render(); });
  render();
  // 自动重连上次在线设备
  devices.forEach((d) => { if (getStatus(d.id) === 'offline' && d.auto) connectDevice(d, { silent: true }); });
  return () => { off(); };
}
