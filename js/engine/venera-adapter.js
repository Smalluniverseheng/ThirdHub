/* ===== ThirdHub js/engine/venera-adapter.js — Venera JS 漫画图源适配器 =====
   兼容 Venera 社区图源（.js 文件，class Xxx extends ComicSource）。
   零内置原则不变：图源全部由用户自行导入（粘贴 / 文件 / URL / 官方配置库）。
   原理：把 Venera 标准 API（ComicSource / Network / HtmlDocument / Convert / UI 等）
   以最小实现注入同一段连接器代码，在我们既有的 iframe 沙箱引擎中运行；
   再把 Venera 的 search/comic.loadInfo/comic.loadEp 适配为统一连接器接口。 */

/* ---------- 格式检测 ---------- */
export function isVeneraJs(text) {
  const t = String(text || '');
  return /class\s+\w+\s+extends\s+ComicSource/.test(t);
}

export function isVeneraIndex(text) {
  try {
    const j = JSON.parse(String(text).trim());
    return Array.isArray(j) && j.length > 0 && j.every((it) => it && it.fileName && it.key);
  } catch (e) { return false; }
}

/* 从源码提取类名与元信息 */
export function veneraMeta(code) {
  const m = String(code).match(/class\s+(\w+)\s+extends\s+ComicSource/);
  const grab = (field) => {
    const f = String(code).match(new RegExp(`${field}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
    return f ? f[1] : '';
  };
  return {
    cls: m ? m[1] : '',
    name: grab('name'),
    key: grab('key'),
    version: grab('version'),
  };
}

/* ---------- Venera API 最小运行时（注入到连接器代码内） ---------- */
const VENERA_RUNTIME = `
/* ---- Venera 标准 API 最小实现（ThirdHub 沙箱 · 运行时 v3.6） ---- */
class Comic {
  constructor(o = {}) {
    this.id = o.id || ''; this.title = o.title || '';
    this.subtitle = o.subtitle || o.subTitle || ''; this.subTitle = this.subtitle;
    this.cover = o.cover || ''; this.tags = o.tags || [];
    this.description = o.description || ''; this.maxPage = o.maxPage || 0;
    this.language = o.language || ''; this.favoriteId = o.favoriteId || ''; this.stars = o.stars || 0;
  }
}
class ComicDetails {
  constructor(o = {}) {
    this.title = o.title || ''; this.subtitle = o.subtitle || o.subTitle || ''; this.subTitle = this.subtitle;
    this.cover = o.cover || ''; this.description = o.description || ''; this.tags = o.tags || null;
    this.chapters = o.chapters || null; this.isFavorite = o.isFavorite ?? null;
    this.thumbnails = o.thumbnails || null; this.recommend = o.recommend || null;
    this.updateTime = o.updateTime || ''; this.uploadTime = o.uploadTime || '';
    this.url = o.url || ''; this.stars = o.stars || 0; this.maxPage = o.maxPage || 0; this.comments = o.comments || null;
  }
}
class Comment { constructor(o = {}) { Object.assign(this, o); } }
class ImageLoadingConfig {
  constructor(o = {}) {
    this.url = o.url || ''; this.method = o.method || 'GET'; this.data = o.data || null;
    this.headers = o.headers || null; this.onResponse = o.onResponse || null;
    this.modifyImage = o.modifyImage || null; this.onLoadFailed = o.onLoadFailed || null;
  }
}
class Cookie {
  constructor(o = {}) { Object.assign(this, o); }
  toString() { return (this.name || '') + '=' + (this.value || ''); }
  static fromString(s) { const i = s.indexOf('='); return new Cookie({ name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() }); }
}

/* Cookie 罐：按 host 存储，请求时自动附带 */
const __cookieJar = {};

async function __net(method, url, headers, data) {
  const h = { ...(headers || {}) };
  let host = '';
  try { host = new URL(url).host; } catch (e) {}
  if (__cookieJar[host] && !h['Cookie'] && !h['cookie']) {
    h['Cookie'] = __cookieJar[host].map((c) => c.toString()).join('; ');
  }
  const opt = { method, headers: h };
  if (data != null) {
    opt.body = (typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) ? data : JSON.stringify(data);
  }
  const r = await legado.http.request(url, opt);
  return { status: r.status, headers: r.headers || {}, body: r.body };
}
const Network = {
  fetchBytes: (m, u, h, d) => __net(m, u, h, d),
  sendRequest: (m, u, h, d) => __net(m, u, h, d),
  get: (u, h) => __net('GET', u, h),
  post: (u, h, d) => __net('POST', u, h, d),
  put: (u, h, d) => __net('PUT', u, h, d),
  delete: (u, h) => __net('DELETE', u, h),
  patch: (u, h, d) => __net('PATCH', u, h, d),
  setCookies(url, cookies) { try { __cookieJar[new URL(url).host] = cookies; } catch (e) {} },
  getCookies(url) { try { return __cookieJar[new URL(url).host] || []; } catch (e) { return []; } },
  deleteCookies(url) { try { delete __cookieJar[new URL(url).host]; } catch (e) {} },
};

class HtmlNode {
  constructor(n) { this._n = n; }
  get type() { return { 3: 'text', 1: 'element', 8: 'comment', 9: 'document' }[this._n.nodeType] || 'unknown'; }
  toElement() { return this._n.nodeType === 1 ? new HtmlElement(this._n) : null; }
  get text() { return this._n.textContent || ''; }
}
class HtmlElement {
  constructor(el) { this._el = el; }
  querySelector(sel) { const r = this._el.querySelector(sel); return r ? new HtmlElement(r) : null; }
  querySelectorAll(sel) { return [...this._el.querySelectorAll(sel)].map((e) => new HtmlElement(e)); }
  getElementById(id) { const r = this._el.ownerDocument ? this._el.ownerDocument.getElementById(id) : null; return r ? new HtmlElement(r) : null; }
  get text() { return this._el.textContent || ''; }
  get attributes() { const o = {}; [...(this._el.attributes || [])].forEach((a) => { o[a.name] = a.value; }); return o; }
  get children() { return [...this._el.children].map((c) => new HtmlElement(c)); }
  get nodes() { return [...this._el.childNodes].map((n) => new HtmlNode(n)); }
  get parent() { return this._el.parentElement ? new HtmlElement(this._el.parentElement) : null; }
  get innerHtml() { return this._el.innerHTML || ''; }
  get classNames() { return [...this._el.classList]; }
  get id() { return this._el.id || null; }
  get localName() { return this._el.localName || ''; }
  get previousSibling() { return this._el.previousElementSibling ? new HtmlElement(this._el.previousElementSibling) : null; }
  get nextSibling() { return this._el.nextElementSibling ? new HtmlElement(this._el.nextElementSibling) : null; }
}
class HtmlDocument extends HtmlElement {
  constructor(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html), 'text/html');
    super(doc.documentElement);
    this._doc = doc;
  }
  dispose() { this._doc = null; }
}

const Convert = {
  encodeUtf8(str) { return new TextEncoder().encode(String(str)).buffer; },
  decodeUtf8(buf) { return new TextDecoder().decode(buf); },
  encodeBase64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); },
  decodeBase64(str) { const bin = atob(String(str)); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; },
  async md5(buf) { return Convert.encodeUtf8(''); /* 占位，下方覆盖 */ },
  async sha1(buf) { return crypto.subtle.digest('SHA-1', buf); },
  async sha256(buf) { return crypto.subtle.digest('SHA-256', buf); },
  async sha512(buf) { return crypto.subtle.digest('SHA-512', buf); },
  async hmac(key, value, hash) {
    const algo = { name: 'HMAC', hash: String(hash).toUpperCase().replace('SHA', 'SHA-') };
    const k = await crypto.subtle.importKey('raw', key, algo, false, ['sign']);
    return crypto.subtle.sign('HMAC', k, value);
  },
  async hmacString(key, value, hash) { return Convert.encodeBase64(await Convert.hmac(key, value, hash)); },
  async decryptAesEcb(v, k) { console.warn('AES-ECB 不支持'); return v; },
  async decryptAesCbc(value, key, iv) {
    return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']), value);
  },
  async decryptAesCfb(v) { console.warn('AES-CFB 不支持'); return v; },
  async decryptAesOfb(v) { console.warn('AES-OFB 不支持'); return v; },
  async decryptRsa(v) { console.warn('RSA 不支持'); return v; },
  hexEncode(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); },
  hexDecode(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b.buffer; },
};
Convert.md5 = async (buf) => {
  /* 输入多为 UTF-8 字符串编码后的 buffer，还原为字符串走引擎内 MD5 */
  try { return Convert.encodeUtf8(legado.md5(Convert.decodeUtf8(buf))); } catch (e) { return buf; }
};

const UI = {
  showMessage(msg) { legado.log('[图源] ' + msg); },
  showDialog() {}, launchUrl() {}, showLoading() { return 1; }, cancelLoading() {},
  showInputDialog() { return null; }, showSelectDialog() { return null; },
};

function createUuid() { return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
function randomInt(from, to) { return Math.floor(Math.random() * (to - from + 1)) + from; }
function randomDouble() { return Math.random(); }
function parseJson(s) { return JSON.parse(s); }

/* 兼容版 fetch：返回类 Response 对象 */
const fetch = async (url, opt = {}) => {
  const r = await __net(opt.method || 'GET', url, opt.headers, opt.body);
  return {
    status: r.status, ok: r.status >= 200 && r.status < 300,
    headers: { get: (k) => (r.headers || {})[String(k).toLowerCase()] || null },
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
    arrayBuffer: async () => new TextEncoder().encode(r.body).buffer,
  };
};

class ComicSource {
  constructor() { this.key = ''; this.name = ''; }
  loadData(k) { return legado.data.get(__VEN_KEY, k); }
  saveData(k, v) { legado.data.set(__VEN_KEY, k, v); }
  deleteData(k) { legado.data.del(__VEN_KEY, k); }
  get isLogged() { return legado.data.isLogged(__VEN_KEY); }
  /* v3.6：图源设置项（settings 里声明的 select/switch 等），未设置时回退 default */
  loadSetting(k) {
    const v = legado.data.get(__VEN_KEY, 'setting:' + k);
    if (v !== null && v !== undefined) return v;
    const s = this.settings && this.settings[k];
    return (s && s.default !== undefined) ? s.default : undefined;
  }
  saveSetting(k, v) { legado.data.set(__VEN_KEY, 'setting:' + k, v); }
}
ComicSource.sources = {};
`;

/* ---------- 适配器：Venera 接口 → 统一连接器接口 ---------- */
const VENERA_ADAPTER = `
/* ---- Venera → ThirdHub 统一接口适配 ---- */
const __src = new __VEN_CLS();
ComicSource.sources[__src.key || '__VEN_KEY'] = __src;
if (typeof __src.init === 'function') { try { __src.init(); } catch (e) { legado.log('init: ' + (e.message || e)); } }

function __cov(u) {
  if (!u || String(u).indexOf('data:') === 0) return u || '';
  return legado.proxyUrl(String(u), { referer: __src.url || '' });
}
function __mapComic(c) {
  return {
    name: c.title || '', author: c.subtitle || c.subTitle || '',
    coverUrl: __cov(c.cover), bookUrl: String(c.id),
    intro: c.description || '',
    kind: Array.isArray(c.tags) ? c.tags.join(' ') : '',
    type: 'comic',
  };
}

async function search(keyword, page) {
  const r = await __src.search.load(keyword, undefined, page || 1);
  const arr = Array.isArray(r) ? r : (r.comics || []);
  return arr.map(__mapComic);
}

function __flattenChapters(ch, comicId) {
  const out = [];
  if (!ch) return out;
  if (ch instanceof Map) {
    ch.forEach((v, k) => {
      if (v instanceof Map) v.forEach((v2, k2) => out.push({ name: String(v2), url: comicId + '||' + String(k2), vip: false }));
      else out.push({ name: String(v), url: comicId + '||' + String(k), vip: false });
    });
  } else if (typeof ch === 'object') {
    Object.keys(ch).forEach((k) => out.push({ name: String(ch[k]), url: comicId + '||' + k, vip: false }));
  }
  return out;
}

async function bookInfo(bookUrl) {
  const d = await __src.comic.loadInfo(bookUrl);
  return {
    name: d.title || '', author: d.subtitle || d.subTitle || '',
    coverUrl: __cov(d.cover), intro: d.description || '',
    lastUpdate: d.updateTime || '',
    kind: Array.isArray(d.tags) ? d.tags.join(' ') : '',
  };
}

async function chapterList(bookUrl) {
  const d = await __src.comic.loadInfo(bookUrl);
  return __flattenChapters(d.chapters, bookUrl);
}

async function chapterContent(chapterUrl) {
  const i = chapterUrl.indexOf('||');
  const comicId = chapterUrl.slice(0, i);
  const epId = chapterUrl.slice(i + 2);
  let imgs = await __src.comic.loadEp(comicId, epId);
  if (!Array.isArray(imgs)) imgs = (imgs && imgs.images) || [];
  const out = [];
  for (const im of imgs) {
    let u = typeof im === 'string' ? im : (im.url || '');
    let h = (typeof im === 'object' && im) ? im.headers : null;
    if (typeof __src.comic.onImageLoad === 'function') {
      try {
        const cfg = await __src.comic.onImageLoad(u);
        if (cfg) { u = cfg.url || u; h = cfg.headers || h; }
      } catch (e) {}
    }
    if (!u) continue;
    if (!/^https?:\\/\\//i.test(u)) continue;
    /* 需要自定义请求头的图片（防盗链）走中转 */
    if (h && Object.keys(h).length) u = legado.proxyUrl(u, h);
    out.push(u);
  }
  return JSON.stringify({ images: out });
}
`;

/* ---------- 对外：图源代码包装为统一连接器 ---------- */
export function veneraToJsSource(code, fileUrl) {
  const meta = veneraMeta(code);
  if (!meta.cls) throw new Error('未找到继承 ComicSource 的图源类');
  const name = meta.name || meta.cls;
  const key = meta.key || meta.cls;
  return `// @name        ${name}
// @version     ${meta.version || '1.0.0'}
// @author      Venera 社区
// @url         ${fileUrl || ''}
// @type        comic
// @enabled     true

const __VEN_KEY = ${JSON.stringify(key)};
${VENERA_RUNTIME}
/* ================= 用户图源代码 ================= */
${code}
/* ================= 适配层 ================= */
${VENERA_ADAPTER.replace(/__VEN_CLS/g, meta.cls)}
`;
}

/* v3.6：旧版 Venera 运行时缺少 loadSetting 等 API，导致大量官方图源（包子漫画等）无法使用。
   从旧连接器代码中提取用户图源原始代码，用新版运行时重新包装（返回 null 表示无需升级）。 */
const VEN_RUNTIME_MARK = '运行时 v3.6';
export function regenVeneraCode(code) {
  const text = String(code || '');
  if (!/extends\s+ComicSource/.test(text)) return null;      // 不是 Venera 图源
  if (text.includes(VEN_RUNTIME_MARK)) return null;          // 已是新版运行时
  const m = text.match(/\/\* =+ 用户图源代码 =+ \*\/\n([\s\S]*?)\n\/\* =+ 适配层 =+ \*\//);
  if (!m) return null;
  const userCode = m[1];
  const urlM = text.match(/^\/\/ @url\s+(\S*)$/m);
  try {
    return veneraToJsSource(userCode, urlM ? urlM[1] : '');
  } catch (e) { return null; }
}
