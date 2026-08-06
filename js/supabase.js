/* ===== ThirdHub supabase.js — 云端同步（Supabase，Realtime + 离线优先） =====
   配置存放在本地 kv（cloud:url / cloud:anonKey），未配置时全部云端功能自动降级为仅本地 */
import { kvGet, kvSet, emit } from './store.js';

let _sb = null;
let _ready = false;

export function hasCloud() { return _ready && !!_sb; }
export function getSupabase() { return _sb; }

/* 动态加载 supabase-js（MIT） */
async function loadLib() {
  if (window.supabase) return window.supabase;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
    s.type = 'module';
    s.onerror = reject;
    // +esm 不提供全局变量，改用 UMD 构建
    s.type = 'text/javascript';
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
  return window.supabase;
}

export async function initCloud() {
  const url = await kvGet('cloud:url', '');
  const key = await kvGet('cloud:anonKey', '');
  if (!url || !key) { _ready = false; return false; }
  try {
    const lib = await loadLib();
    _sb = lib.createClient(url, key);
    _ready = true;
    emit('cloud:ready');
    return true;
  } catch (e) {
    console.warn('Supabase 初始化失败', e);
    _ready = false;
    return false;
  }
}

export async function configureCloud(url, anonKey) {
  await kvSet('cloud:url', (url || '').trim());
  await kvSet('cloud:anonKey', (anonKey || '').trim());
  _sb = null;
  return initCloud();
}

/* ---------- 通用同步表读写（带版本号防冲突） ---------- */
const SYNC_TABLES = ['bookshelf', 'reading_progress', 'history', 'favorites'];

export async function syncPush(table, row) {
  if (!hasCloud()) return false;
  if (!SYNC_TABLES.includes(table)) return false;
  try {
    row.updated_at = new Date().toISOString();
    row.version = (row.version || 0) + 1;
    const { error } = await _sb.from(table).upsert(row);
    return !error;
  } catch (e) { return false; }
}

export async function syncPull(table, userId) {
  if (!hasCloud()) return [];
  try {
    const { data, error } = await _sb.from(table).select('*').eq('user_id', userId);
    return error ? [] : (data || []);
  } catch (e) { return []; }
}

/* Realtime 订阅 */
export function subscribe(table, userId, onChange) {
  if (!hasCloud()) return null;
  try {
    return _sb.channel('sync:' + table)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, (payload) => onChange(payload))
      .subscribe();
  } catch (e) { return null; }
}
