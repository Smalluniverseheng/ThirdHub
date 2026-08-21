/* ===== ThirdHub js/engine/sync-service.js — 云端同步（推送 + 登录拉取合并） ===== */
import { db, kvGet, on } from '../store.js';
import { hasCloud, syncPush, syncPull } from '../supabase.js';

/* 本地表 → 云端表映射 */
const MAP = {
  shelf: 'th_bookshelf',
  history: 'th_history',
  favorites: 'th_favorites',
};

let syncing = false;

/* 推送单条（fire & forget） */
export function pushRow(localStore, row) {
  const table = MAP[localStore];
  if (!table || !hasCloud()) return;
  syncPush(table, { id: row.id, data: row }).catch(() => {});
}

/* 进度推送 */
export async function pushProgress(itemId, progress) {
  if (!hasCloud()) return;
  syncPush('th_reading_progress', { id: itemId, data: progress }).catch(() => {});
}

/* 登录后全量拉取合并：云端 updated_at 更新则覆盖本地 */
export async function pullAll(userId) {
  if (!hasCloud() || syncing || !userId) return;
  syncing = true;
  try {
    // 书架 / 历史 / 收藏
    for (const [localStore, table] of Object.entries(MAP)) {
      const rows = await syncPull(table, userId);
      for (const r of rows) {
        if (!r.data) continue;
        const local = await db.get(localStore, r.id);
        const cloudTs = new Date(r.updated_at).getTime();
        const localTs = (local && (local.lastAt || local.addedAt || 0));
        if (!local || cloudTs > localTs) {
          await db.put(localStore, { ...r.data, id: r.id });
        } else if (localTs > cloudTs) {
          syncPush(table, { id: r.id, data: local }).catch(() => {});
        }
      }
      // 本地有、云端无 → 上传
      const localAll = await db.all(localStore);
      const cloudIds = new Set(rows.map((r) => r.id));
      for (const l of localAll) {
        if (!cloudIds.has(l.id)) syncPush(table, { id: l.id, data: l }).catch(() => {});
      }
    }
    // 阅读进度
    const progs = await syncPull('th_reading_progress', userId);
    for (const r of progs) {
      if (!r.data) continue;
      const local = await kvGet('progress:' + r.id, null);
      if (!local || (r.data.ts || 0) > (local.ts || 0)) {
        const { kvSet } = await import('../store.js');
        await kvSet('progress:' + r.id, r.data);
      }
    }
  } catch (e) {
    console.warn('云端同步失败', e);
  } finally {
    syncing = false;
  }
}

/* 初始化：登录状态变化时触发拉取 */
export function initSync() {
  on('auth:changed', async () => {
    const { currentUser } = await import('../auth.js');
    const u = await currentUser();
    if (u) pullAll(u.id);
  });
}
