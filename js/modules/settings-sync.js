/* ===== ThirdHub js/modules/settings-sync.js — 设置云端同步（v1.7） =====
   设置文件（主题/阅读/漫画/AI 偏好/回收站天数/代理策略等）自动同步到云端；
   每次进入浏览器时拉取最新设置，保证多设备一致；
   本地改动后防抖推送。 applock 等本机安全项不参与同步。 */
import { kvGet, kvSet, getSetting, setSetting, on, DEFAULT_SETTINGS_KEYS } from '../store.js';
import { hasCloud, syncPush, syncPull } from '../supabase.js';
import { currentUser } from '../auth.js';

/* 参与同步的 kv 键（settings 表的全部键 + 这些散键） */
const TRACKED_KV = [
  'ai:prefs', 'ai:ctx', 'ai:chat-def', 'ai:asr',
  'ai:tts-mode', 'ai:tts-voice', 'ai:tts-model', 'ai:tts-autoread', 'ai:tts-rate', 'ai:tts-pitch',
  'ai:mem-on', 'ai:pin-open', 'recycle:days', 'storage:policy', 'splash:on',
  'proxy:mod', 'proxy:backend', 'nav:tabs',
];

async function collectSettings() {
  const out = { s: {}, kv: {} };
  for (const k of DEFAULT_SETTINGS_KEYS) out.s[k] = await getSetting(k);
  for (const k of TRACKED_KV) { const v = await kvGet(k, undefined); if (v !== undefined) out.kv[k] = v; }
  return out;
}

let applying = false;

export async function applySettings(data) {
  if (!data) return;
  applying = true;
  try {
    if (data.s) for (const [k, v] of Object.entries(data.s)) await setSetting(k, v);
    if (data.kv) for (const [k, v] of Object.entries(data.kv)) await kvSet(k, v);
  } finally { applying = false; }
}

/* 推送（防抖 1.5s） */
let pushTimer = null;
export function schedulePush() {
  if (applying) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1500);
}

export async function pushNow() {
  if (!hasCloud()) return;
  const u = await currentUser();
  if (!u) return;
  const settings = await collectSettings();
  const updatedAt = Date.now();
  const ok = await syncPush('th_settings', { id: u.id, data: { settings, updatedAt } }, u.id);
  if (ok) await kvSet('settings:syncedAt', updatedAt);
}

/* 拉取：云端较新则覆盖本地；本地较新则上传 */
export async function pullNow() {
  if (!hasCloud()) return 'no-cloud';
  const u = await currentUser();
  if (!u) return 'no-user';
  const rows = await syncPull('th_settings', u.id);
  const row = rows.find((r) => r.id === u.id) || rows[0];
  const cloudAt = row && row.data && row.data.updatedAt ? row.data.updatedAt : 0;
  const localAt = await kvGet('settings:syncedAt', 0);
  if (row && cloudAt > localAt) {
    await applySettings(row.data.settings);
    await kvSet('settings:syncedAt', cloudAt);
    return 'pulled';
  }
  if (!row || localAt > cloudAt) { await pushNow(); return 'pushed'; }
  return 'same';
}

/* 启动初始化：进入浏览器即拉取最新设置；之后本地改动自动推送 */
export async function initSettingsSync() {
  try { await pullNow(); } catch (e) { console.warn('设置同步失败', e); }
  on('setting:changed', () => schedulePush());
  on('kv:changed', (k) => { if (TRACKED_KV.includes(k)) schedulePush(); });
  on('auth:changed', () => { pullNow().catch(() => {}); });
}
