/* ===== ThirdHub store.js — IndexedDB 封装 + 本地状态管理 ===== */

const DB_NAME = 'thirdhub';
const DB_VERSION = 1;

/* 表结构：
   kv          — 键值配置（设置/API Key/进度等）
   sources     — 用户导入的连接器（书源）配置
   shelf       — 书架条目
   history     — 浏览/阅读历史
   favorites   — 收藏
   chats       — AI 对话会话
   cache       — 章节/图片等离线缓存
*/
const STORES = ['kv', 'sources', 'shelf', 'history', 'favorites', 'chats', 'cache'];

let _db = null;

/* 内存降级：隐私模式 / 内嵌 WebView 等 IndexedDB 不可用时保证应用可用（数据不持久化） */
const MEM_MODE = typeof indexedDB === 'undefined' || /[?&]mem=1/.test(location.search || '');
const MEM = {};
const memKey = (store, val) => {
  const kp = { kv: 'k', sources: 'id', shelf: 'id', history: 'id', favorites: 'id', chats: 'id', cache: 'k' }[store] || 'id';
  return val && typeof val === 'object' ? val[kp] : val;
};
const memDb = {
  get: async (s, k) => (MEM[s] || (MEM[s] = new Map())).get(k),
  put: async (s, v) => (MEM[s] || (MEM[s] = new Map())).set(memKey(s, v), v),
  del: async (s, k) => (MEM[s] || (MEM[s] = new Map())).delete(k),
  all: async (s) => [...(MEM[s] || (MEM[s] = new Map())).values()],
  clear: async (s) => (MEM[s] = new Map()),
  byIndex: async (s, idx, v) => [...(MEM[s] || (MEM[s] = new Map())).values()].filter((x) => x[idx] === v),
};

export function openDB() {
  if (MEM_MODE) return Promise.resolve(null);
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shelf')) {
        const s = db.createObjectStore('shelf', { keyPath: 'id' });
        s.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out._val !== undefined ? out._val : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqVal(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = MEM_MODE ? memDb : {
  async get(store, key) { const db = await openDB(); return reqVal(db.transaction(store).objectStore(store).get(key)); },
  async put(store, val) { const db = await openDB(); return reqVal(db.transaction(store, 'readwrite').objectStore(store).put(val)); },
  async del(store, key) { const db = await openDB(); return reqVal(db.transaction(store, 'readwrite').objectStore(store).delete(key)); },
  async all(store) { const db = await openDB(); return reqVal(db.transaction(store).objectStore(store).getAll()); },
  async clear(store) { const db = await openDB(); return reqVal(db.transaction(store, 'readwrite').objectStore(store).clear()); },
  async byIndex(store, index, val) {
    const db = await openDB();
    return reqVal(db.transaction(store).objectStore(store).index(index).getAll(val));
  },
};

/* ---------- KV 快捷读写 ---------- */
export async function kvGet(k, def = null) {
  const row = await db.get('kv', k);
  return row ? row.v : def;
}
export async function kvSet(k, v) { const r = await db.put('kv', { k, v }); emit('kv:changed', k); return r; }
export async function kvDel(k) { return db.del('kv', k); }

/* ---------- 全局响应式状态（轻量事件总线） ---------- */
const listeners = new Map();
export const state = {};
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, data) {
  (listeners.get(event) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
}

/* ---------- 设置读写（带默认值） ---------- */
const DEFAULT_SETTINGS = {
  theme: 'auto',            // dark | light | auto（默认跟随系统）
  lang: 'zh-CN',
  readerFontSize: 17,
  readerLineHeight: 1.7,
  readerTheme: 'night',     // day | night | eye | paper | blue | green
  readerFlip: 'slide',      // slide | cover | sim | none | scroll
  comicMode: 'gallery',     // gallery | scroll（旧键，与 comicLayout 同步）
  comicDir: 'ltr',          // ltr | rtl
  proxyMode: 'auto',        // auto | backend | direct
  proxyUrl: '',             // 自建后端代理地址
  ttsRate: 1.0,

  /* ---- v1.5 语音引擎 ---- */
  ttsEngine: 'system',      // system | xiaomi | volc | edge
  ttsCustomUrl: '',
  asrEngine: 'system',      // system | custom
  asrCustomUrl: '',

  /* ---- v1.5 小说阅读 ---- */
  readerFont: 'system',     // system | serif | sans | kai
  readerFontWeight: 400,    // 300 | 400 | 600
  readerPadding: 20,
  readerParaGap: 0.6,       // em
  readerTextColor: '',      // 自定义文字色（空 = 跟随主题）
  readerBgColor: '',        // 自定义背景色
  readerBrightness: 1.0,
  readerFullscreen: false,
  readerVolumeFlip: false,
  readerAutoScroll: 0,      // 0=关闭，否则 px/s
  readerIllust: true,       // 插图小说：显示正文插图
  readerTapFlip: true,
  readerInfoBar: true,

  /* ---- v1.5 漫画阅读 ---- */
  comicLayout: 'paged',     // paged 单页 | webtoon 条漫 | double 双页
  comicFit: 'width',        // width | height | original
  comicGap: true,
  comicBrightness: 1.0,
  comicCropBorder: false,
  comicPreload: 3,

  /* ---- v1.5 多端导航 ---- */
  navDesktop: 'bottom',     // top | bottom | fold
  navMobile: 'bottom',      // top | bottom
  navWatch: 'bottom',       // top | bottom
  aiDrawerSide: 'left',     // AI 抽屉拉出方向
};

export async function getSetting(k) {
  const v = await kvGet('setting:' + k);
  return v === null || v === undefined ? DEFAULT_SETTINGS[k] : v;
}
export async function setSetting(k, v) {
  await db.put('kv', { k: 'setting:' + k, v });
  emit('setting:' + k, v);
  emit('setting:changed', k);
}
export async function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = await getSetting(k);
  return out;
}
export { DEFAULT_SETTINGS };
export const DEFAULT_SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
