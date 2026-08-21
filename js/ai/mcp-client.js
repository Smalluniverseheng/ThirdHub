/* ===== ThirdHub js/ai/mcp-client.js — MCP 客户端（SSE 传输） =====
   浏览器环境限制：仅支持 SSE / Streamable HTTP 传输的远程 MCP Server
   stdio 传输仅适用于桌面端，浏览器/PWA 环境不可用 */
import { kvGet, kvSet, emit } from '../store.js';

let servers = [];      // [{id,name,url,enabled,tools:[{name,description,inputSchema}],status}]
let nextId = 1;
const pending = new Map();

export async function loadMcpServers() {
  servers = await kvGet('mcp:servers', []);
  return servers;
}
export async function saveMcpServers() {
  await kvSet('mcp:servers', servers.map(({ es, ...s }) => s));
}
export function listMcpServers() { return servers; }

export async function addMcpServer({ name, url }) {
  const s = { id: 'mcp-' + Date.now().toString(36), name, url, enabled: true, tools: [], status: 'disconnected' };
  servers.push(s);
  await saveMcpServers();
  return s;
}
export async function removeMcpServer(id) {
  disconnectMcp(id);
  servers = servers.filter((s) => s.id !== id);
  await saveMcpServers();
}
export async function toggleMcpServer(id, enabled) {
  const s = servers.find((x) => x.id === id);
  if (!s) return;
  s.enabled = enabled;
  if (!enabled) disconnectMcp(id);
  await saveMcpServers();
}

/* JSON-RPC 请求（Streamable HTTP：POST 单发单收） */
async function rpc(url, method, params) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await resp.text();
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    if (!line) throw new Error('SSE 响应为空');
    const j = JSON.parse(line.slice(5));
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
  const j = await resp.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

export async function connectMcp(id) {
  const s = servers.find((x) => x.id === id);
  if (!s) return;
  s.status = 'connecting';
  emit('mcp:changed');
  try {
    await rpc(s.url, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ThirdHub', version: '1.0' },
    });
    const result = await rpc(s.url, 'tools/list', {});
    s.tools = (result && result.tools) || [];
    s.status = 'connected';
  } catch (e) {
    s.status = 'error';
    s.error = e.message;
  }
  emit('mcp:changed');
  saveMcpServers();
  return s.status === 'connected';
}

export function disconnectMcp(id) {
  const s = servers.find((x) => x.id === id);
  if (s) { s.status = 'disconnected'; s.tools = []; emit('mcp:changed'); }
}

export async function callMcpTool(serverId, toolName, args) {
  const s = servers.find((x) => x.id === serverId);
  if (!s || s.status !== 'connected') throw new Error('MCP 服务未连接');
  const result = await rpc(s.url, 'tools/call', { name: toolName, arguments: args || {} });
  return result;
}

/* 汇总所有已连接服务的工具（供 AI 调用注入） */
export function allMcpTools() {
  const out = [];
  servers.forEach((s) => {
    if (s.enabled && s.status === 'connected') {
      s.tools.forEach((t) => out.push({ serverId: s.id, serverName: s.name, ...t }));
    }
  });
  return out;
}
