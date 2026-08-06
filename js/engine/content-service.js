/* ===== ThirdHub js/engine/content-service.js — 内容获取与进度服务 ===== */
import { db, kvGet, kvSet } from '../store.js';
import { getEngine } from './source-engine.js';

/* 详情 + 目录缓存 */
export async function getBookInfo(source, bookUrl) {
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
  await kvSet('progress:' + itemId, { ...progress, ts: Date.now() });
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
  return row;
}
export async function inShelf(sourceId, bookUrl) {
  return !!(await db.get('shelf', sourceId + ':' + bookUrl));
}
export async function removeFromShelf(id) { await db.del('shelf', id); }

/* ---------- 历史记录 ---------- */
export async function addHistory(item) {
  const id = item.sourceId + ':' + item.bookUrl;
  await db.put('history', {
    id,
    sourceId: item.sourceId,
    type: item.type,
    title: item.title || item.name,
    coverUrl: item.coverUrl || '',
    bookUrl: item.bookUrl,
    sourceName: item.sourceName || '',
    lastAt: Date.now(),
  });
}

/* ---------- 收藏 ---------- */
export async function toggleFavorite(item) {
  const id = item.sourceId + ':' + item.bookUrl;
  const existing = await db.get('favorites', id);
  if (existing) { await db.del('favorites', id); return false; }
  await db.put('favorites', {
    id, sourceId: item.sourceId, type: item.type,
    title: item.title || item.name, coverUrl: item.coverUrl || '',
    bookUrl: item.bookUrl, sourceName: item.sourceName || '', addedAt: Date.now(),
  });
  return true;
}
