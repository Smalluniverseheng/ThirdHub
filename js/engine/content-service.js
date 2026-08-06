/* ===== ThirdHub js/engine/content-service.js — 内容获取与进度服务 ===== */
import { db, kvGet, kvSet, emit } from '../store.js';
import { getEngine } from './source-engine.js';
import { pushRow, pushProgress } from './sync-service.js';
import { localBookInfo, localChapterList, localChapterContent } from './local-source.js';

/* 详情 + 目录缓存 */
export async function getBookInfo(source, bookUrl) {
  if (source.id === 'local') return localBookInfo(bookUrl);
  const cacheKey = 'info:' + source.id + ':' + bookUrl;
  const cached = await db.get('cache', cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.v;
  const engine = getEngine(source);
  let info = await engine.bookInfo(bookUrl);
  if (typeof info === 'string') info = JSON.parse(info);
  await db.put('cache', { k: cacheKey, v: info, ts: Date.now() });
  return info;
}

export async function getChapterList(source, bookUrl, force = false) {
  if (source.id === 'local') return localChapterList(bookUrl);
  const cacheKey = 'chapters:' + source.id + ':' + bookUrl;
  if (!force) {
    const cached = await db.get('cache', cacheKey);
    if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.v;
  }
  const engine = getEngine(source);
  let list = await engine.chapterList(bookUrl);
  if (typeof list === 'string') list = JSON.parse(list);
  list = (list || []).map((c, i) => ({ ...c, index: i }));
  await db.put('cache', { k: cacheKey, v: list, ts: Date.now() });
  return list;
}

export async function getChapterContent(source, chapterUrl) {
  if (source.id === 'local') return localChapterContent(chapterUrl);
  const cacheKey = 'content:' + source.id + ':' + chapterUrl;
  const cached = await db.get('cache', cacheKey);
  if (cached) return cached.v;
  const engine = getEngine(source);
  const content = await engine.chapterContent(chapterUrl);
  await db.put('cache', { k: cacheKey, v: content, ts: Date.now() });
  return content;
}

/* ---------- 阅读进度 ---------- */
export async function saveProgress(itemId, progress) {
  // progress: {chapterIndex, offset?, position?, ts}
  const row = { ...progress, ts: Date.now() };
  await kvSet('progress:' + itemId, row);
  pushProgress(itemId, row);
}
export async function getProgress(itemId) {
  return await kvGet('progress:' + itemId, null);
}

/* ---------- 书架操作 ---------- */
export async function addToShelf(item) {
  // item: {sourceId, type, title, author, coverUrl, bookUrl}
  const id = item.sourceId + ':' + item.bookUrl;
  const existing = await db.get('shelf', id);
  if (existing) return existing;
  const row = {
    id,
    sourceId: item.sourceId,
    type: item.type,
    title: item.title || item.name,
    author: item.author || '',
    coverUrl: item.coverUrl || '',
    bookUrl: item.bookUrl,
    sourceName: item.sourceName || '',
    addedAt: Date.now(),
    top: false,
  };
  await db.put('shelf', row);
  pushRow('shelf', row);
  emit('shelf:changed');
  return row;
}
export async function inShelf(sourceId, bookUrl) {
  return !!(await db.get('shelf', sourceId + ':' + bookUrl));
}
export async function removeFromShelf(id) {
  await db.del('shelf', id);
  emit('shelf:changed');
}

/* ---------- 历史记录 ---------- */
export async function addHistory(item) {
  const id = item.sourceId + ':' + item.bookUrl;
  const row = {
    id,
    sourceId: item.sourceId,
    type: item.type,
    title: item.title || item.name,
    coverUrl: item.coverUrl || '',
    bookUrl: item.bookUrl,
    sourceName: item.sourceName || '',
    lastAt: Date.now(),
  };
  await db.put('history', row);
  pushRow('history', row);
}

/* ---------- 收藏 ---------- */
export async function toggleFavorite(item) {
  const id = item.sourceId + ':' + item.bookUrl;
  const existing = await db.get('favorites', id);
  if (existing) { await db.del('favorites', id); return false; }
  const row = {
    id, sourceId: item.sourceId, type: item.type,
    title: item.title || item.name, coverUrl: item.coverUrl || '',
    bookUrl: item.bookUrl, sourceName: item.sourceName || '', addedAt: Date.now(),
  };
  await db.put('favorites', row);
  pushRow('favorites', row);
  return true;
}
