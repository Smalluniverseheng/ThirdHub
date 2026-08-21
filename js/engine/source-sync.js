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

/* v4.8/v5.7：登录后拉取云端连接器清单（含代码本体），存入待恢复队列；
   按需恢复——进入连接器管理 / 阅读板块时才安装对应类型的连接器（没开启的模块先不装） */
export async function pullSources() {
  if (!hasCloud() || _pulling) return;
  const u = await currentUser();
  if (!u) return;
  _pulling = true;
  try {
    const sb = getSupabase();
    const { data: remote, error } = await sb.from('th_sources').select('*').eq('user_id', u.id);
    if (error || !remote || !remote.length) return;
    const pending = [];
    let updated = 0;
    for (const r of remote) {
      if (!r.data || !r.data.code) continue;
      const local = await db.get('sources', r.id);
      const cloudTs = new Date(r.updated_at || 0).getTime();
      const localTs = local && (local.syncedAt || 0);
      if (!local) {
        pending.push({
          id: r.id, name: r.data.name, type: r.data.type, version: r.data.version || '1.0',
          author: r.data.author || '', url: r.data.url || '',
          enabled: r.data.enabled !== false, code: r.data.code,
          importedAt: r.data.importedAt || Date.now(), syncedAt: cloudTs,
        });
      } else if (cloudTs > localTs && r.data.code !== local.code) {
        await db.put('sources', { ...local, ...r.data, code: r.data.code, syncedAt: cloudTs });
        updated++;
      }
    }
    const existing = (await kvGet('cloud:pending-sources', [])) || [];
    const merged = [...existing];
    for (const s of pending) if (!merged.some((x) => x.id === s.id)) merged.push(s);
    await kvSet('cloud:pending-sources', merged);
    if (updated) { emit('sources:changed'); toast('云端连接器已更新 ' + updated + ' 个'); }
  } catch (e) { console.warn('pullSources', e); }
  finally { _pulling = false; }
}

/* v5.7：按需恢复——types 为空恢复全部；指定 types 只恢复对应类型（进入阅读板块 / 连接器管理时调用） */
export async function restorePendingSources(types = null) {
  const pending = (await kvGet('cloud:pending-sources', [])) || [];
  if (!pending.length) return 0;
  const want = pending.filter((s) => !types || types.includes(s.type));
  if (!want.length) return 0;
  let n = 0;
  for (const s of want) {
    const local = await db.get('sources', s.id);
    if (!local) { await db.put('sources', s); n++; }
  }
  if (n) {
    await kvSet('cloud:pending-sources', pending.filter((s) => !want.some((w) => w.id === s.id)));
    emit('sources:changed');
    toast('已从云端恢复 ' + n + ' 个连接器', 'ok');
  }
  return n;
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
