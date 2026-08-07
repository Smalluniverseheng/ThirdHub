/* ===== ThirdHub source-sync.js — 书源云端同步（v1.8） =====
   把用户导入的连接器元信息（名称/类型/作者/网址/启停）同步到 th_sources，
   供跨设备查看与管理员后台审计。不同步连接器代码本体。 */
import { db, on } from '../store.js';
import { getSupabase, hasCloud } from '../supabase.js';
import { currentUser } from '../auth.js';

let _pushing = false;
let _timer = null;

export async function pushSources() {
  if (!hasCloud() || _pushing) return;
  const u = await currentUser();
  if (!u) return;
  _pushing = true;
  try {
    const all = await db.all('sources');
    const sb = getSupabase();
    const rows = all.map((s) => ({
      user_id: u.id,
      id: s.id,
      data: { name: s.name, type: s.type, version: s.version, author: s.author, url: s.url, enabled: s.enabled !== false },
      updated_at: new Date().toISOString(),
    }));
    if (rows.length) await sb.from('th_sources').upsert(rows);
    // 删除云端已不存在的
    const { data: remote } = await sb.from('th_sources').select('id').eq('user_id', u.id);
    const localIds = new Set(all.map((s) => s.id));
    const stale = (remote || []).filter((r) => !localIds.has(r.id)).map((r) => r.id);
    if (stale.length) await sb.from('th_sources').delete().eq('user_id', u.id).in('id', stale);
  } catch (e) { console.warn('pushSources', e); }
  finally { _pushing = false; }
}

export function initSourceSync() {
  pushSources();
  on('sources:changed', () => {
    clearTimeout(_timer);
    _timer = setTimeout(pushSources, 2000);
  });
}
