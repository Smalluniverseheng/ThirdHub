/* ===== ThirdHub source-sync.js — 书源云端同步（v4.8） =====
   v1.8：只同步连接器元信息；
   v4.8：连接器代码本体一并同步（会员云存储容量），跨设备登录自动恢复本地缺失的源。 */
import { db, on, emit } from '../store.js';
import { getSupabase, hasCloud } from '../supabase.js';
import { currentUser } from '../auth.js';
import { toast } from '../ui.js';

let _pushing = false;
let _timer = null;
let _pulling = false;

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
      data: {
        name: s.name, type: s.type, version: s.version, author: s.author, url: s.url,
        enabled: s.enabled !== false,
        code: s.code || '',          /* v4.8：代码本体随源一起云端存储 */
        importedAt: s.importedAt || Date.now(),
      },
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

/* v4.8：登录后拉取云端连接器，本地缺失的自动恢复（含代码本体），
   本地已有且云端更新的覆盖本地（以云端 updated_at 为准） */
export async function pullSources() {
  if (!hasCloud() || _pulling) return;
  const u = await currentUser();
  if (!u) return;
  _pulling = true;
  try {
    const sb = getSupabase();
    const { data: remote, error } = await sb.from('th_sources').select('*').eq('user_id', u.id);
    if (error || !remote || !remote.length) return;
    let restored = 0, updated = 0;
    for (const r of remote) {
      if (!r.data || !r.data.code) continue; /* 旧数据无代码本体：跳过恢复 */
      const local = await db.get('sources', r.id);
      const cloudTs = new Date(r.updated_at || 0).getTime();
      const localTs = local && (local.syncedAt || 0);
      if (!local) {
        await db.put('sources', {
          id: r.id, name: r.data.name, type: r.data.type, version: r.data.version || '1.0',
          author: r.data.author || '', url: r.data.url || '',
          enabled: r.data.enabled !== false, code: r.data.code,
          importedAt: r.data.importedAt || Date.now(), syncedAt: cloudTs,
        });
        restored++;
      } else if (cloudTs > localTs && r.data.code !== local.code) {
        await db.put('sources', { ...local, ...r.data, code: r.data.code, syncedAt: cloudTs });
        updated++;
      }
    }
    if (restored || updated) {
      emit('sources:changed');
      toast(restored ? `云端恢复 ${restored} 个连接器${updated ? '，更新 ' + updated + ' 个' : ''}` : '');
    }
  } catch (e) { console.warn('pullSources', e); }
  finally { _pulling = false; }
}

export function initSourceSync() {
  pushSources();
  pullSources(); /* v4.8：启动即尝试恢复云端连接器 */
  on('sources:changed', () => {
    clearTimeout(_timer);
    _timer = setTimeout(pushSources, 2000);
  });
  const { on: storeOn } = { on };
  storeOn('auth:changed', () => { pushSources(); pullSources(); });
}
