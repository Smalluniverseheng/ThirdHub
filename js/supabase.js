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

const DEFAULT_CLOUD = { url: 'https://mxvxlgjzeboktufumxbp.supabase.co', anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODM5OTcsImV4cCI6MjA5OTk1OTk5N30.QjSLfYAFhwX72YSeAcbTN5O2_PDLaNcv76HhdGJsqpo' };

export async function initCloud() {
  const url = (await kvGet('cloud:url', '')) || DEFAULT_CLOUD.url;
  const key = (await kvGet('cloud:anonKey', '')) || DEFAULT_CLOUD.anon;
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
const SYNC_TABLES = ['th_bookshelf', 'th_reading_progress', 'th_history', 'th_favorites', 'th_settings', 'th_devices'];

export async function syncPush(table, row, userId) {
  if (!hasCloud()) return false;
  if (!SYNC_TABLES.includes(table)) return false;
  try {
    const { data: sess } = await _sb.auth.getSession();
    const uid = userId || (sess && sess.session && sess.session.user.id);
    if (!uid) return false;
    const payload = { user_id: uid, id: row.id, data: row.data || row, updated_at: new Date().toISOString() };
    const { error } = await _sb.from(table).upsert(payload);
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
