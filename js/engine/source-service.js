/* ===== ThirdHub js/engine/source-service.js — 连接器管理服务 =====
   零内置原则：出厂无任何连接器，全部由用户导入 */
import { db, kvGet, kvSet, emit } from '../store.js';
import { uid } from '../ui.js';

export const SOURCE_TYPES = [
  { id: 'novel', name: '小说', icon: 'book' },
  { id: 'comic', name: '漫画', icon: 'comic' },
  { id: 'video', name: '影视/短剧', icon: 'film' },
  { id: 'audio', name: '听书', icon: 'headphone' },
  { id: 'music', name: '音乐', icon: 'music' },
];
export function sourceType(id) { return SOURCE_TYPES.find((t) => t.id === id); }

/* 解析连接器文件元信息（// @key value 注释头） */
export function parseSourceMeta(code) {
  const meta = {};
  String(code).split('\n').slice(0, 40).forEach((line) => {
    const m = line.match(/^\s*\/\/\s*@([\w-]+)\s+(.+)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  });
  return meta;
}

export function validateSource(code) {
  const meta = parseSourceMeta(code);
  if (!meta.name) throw new Error('缺少 @name 声明');
  if (!meta.type || !SOURCE_TYPES.find((t) => t.id === meta.type)) throw new Error('缺少有效的 @type 声明（novel/comic/video/audio/music）');
  if (!/function\s+search\s*\(/.test(code)) throw new Error('缺少 search() 函数');
  if (!/function\s+chapterList\s*\(/.test(code)) throw new Error('缺少 chapterList() 函数');
  if (!/function\s+chapterContent\s*\(/.test(code)) throw new Error('缺少 chapterContent() 函数');
  return meta;
}

export async function importSource(code) {
  const meta = validateSource(code);
  const source = {
    id: 'src-' + uid(),
    name: meta.name,
    version: meta.version || '1.0',
    author: meta.author || '',
    url: meta.url || '',
    type: meta.type,
    enabled: meta.enabled !== 'false',
    code,
    importedAt: Date.now(),
  };
  await db.put('sources', source);
  emit('sources:changed');
  return source;
}

export async function listSources(type = null) {
  const all = await db.all('sources');
  return type ? all.filter((s) => s.type === type) : all;
}
export async function getSource(id) {
  if (id === 'local') { const { LOCAL_SOURCE } = await import('./local-source.js'); return LOCAL_SOURCE; }
  return db.get('sources', id);
}
export async function removeSource(id) { await db.del('sources', id); emit('sources:changed'); }
export async function toggleSource(id, enabled) {
  const s = await db.get('sources', id);
  if (s) { s.enabled = enabled; await db.put('sources', s); emit('sources:changed'); }
}
export async function updateSource(id, patch) {
  const s = await db.get('sources', id);
  if (s) { Object.assign(s, patch); await db.put('sources', s); emit('sources:changed'); }
}

/* ---------- 统一搜索（多源并发） ---------- */
export async function searchAll(keyword, { types = null, onProgress = null } = {}) {
  const { getEngine } = await import('./source-engine.js');
  let sources = await listSources();
  sources = sources.filter((s) => s.enabled && (!types || types.includes(s.type)));
  const results = [];
  await Promise.allSettled(sources.map(async (s) => {
    try {
      const engine = getEngine(s);
      const list = await engine.search(keyword, 1);
      const arr = Array.isArray(list) ? list : (typeof list === 'string' ? JSON.parse(list) : []);
      arr.forEach((item) => results.push({ ...item, sourceId: s.id, sourceName: s.name, type: s.type }));
      onProgress && onProgress(s, arr.length, null);
    } catch (e) {
      onProgress && onProgress(s, 0, e.message);
    }
  }));
  return results;
}
