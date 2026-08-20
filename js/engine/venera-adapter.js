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
/* ---- Venera 标准 API 最小实现（ThirdHub 沙箱 · 运行时 v4.0） ---- */
/* ---- 纯 JS 同步 AES-128/192/256（ECB/CBC，PKCS#7），S 盒为标准表 ---- */
const __aes = (() => {
  const sbox = Uint8Array.from('637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b27509832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16'.match(/../g), (x) => parseInt(x, 16));
  const invs = new Uint8Array(256);
  for (let i = 0; i < 256; i++) invs[sbox[i]] = i;
  const rcon = Uint8Array.from([0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]);
  const mul2 = (a) => (a & 0x80) ? ((a << 1) ^ 0x1b) & 0xff : (a << 1) & 0xff;
  const mulG = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = mul2(a); b >>= 1; } return r; };
  function keyExpand(key) {
    const Nk = key.length / 4, Nr = Nk + 6;
    const w = new Uint8Array(16 * (Nr + 1));
    w.set(key);
    let bytes = Nk * 4, i = Nk;
    while (bytes < w.length) {
      let tmp = w.slice(bytes - 4, bytes);
      if (i % Nk === 0) {
        tmp = Uint8Array.from([sbox[tmp[1]] ^ rcon[i / Nk], sbox[tmp[2]], sbox[tmp[3]], sbox[tmp[0]]]);
      } else if (Nk > 6 && i % Nk === 4) {
        for (let j = 0; j < 4; j++) tmp[j] = sbox[tmp[j]];
      }
      for (let j = 0; j < 4; j++) { w[bytes] = w[bytes - Nk * 4] ^ tmp[j]; bytes++; }
      i++;
    }
    return { w, Nr };
  }
  const addRoundKey = (s, w, r) => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };
  const subBytes = (s) => { for (let i = 0; i < 16; i++) s[i] = sbox[s[i]]; };
  const invSubBytes = (s) => { for (let i = 0; i < 16; i++) s[i] = invs[s[i]]; };
  function shiftRows(s) {
    let t;
    t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
  }
  function invShiftRows(s) {
    let t;
    t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
  }
  function mixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const i = c * 4, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = mulG(a0, 2) ^ mulG(a1, 3) ^ a2 ^ a3;
      s[i + 1] = a0 ^ mulG(a1, 2) ^ mulG(a2, 3) ^ a3;
      s[i + 2] = a0 ^ a1 ^ mulG(a2, 2) ^ mulG(a3, 3);
      s[i + 3] = mulG(a0, 3) ^ a1 ^ a2 ^ mulG(a3, 2);
    }
  }
  function invMixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const i = c * 4, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = mulG(a0, 14) ^ mulG(a1, 11) ^ mulG(a2, 13) ^ mulG(a3, 9);
      s[i + 1] = mulG(a0, 9) ^ mulG(a1, 14) ^ mulG(a2, 11) ^ mulG(a3, 13);
      s[i + 2] = mulG(a0, 13) ^ mulG(a1, 9) ^ mulG(a2, 14) ^ mulG(a3, 11);
      s[i + 3] = mulG(a0, 11) ^ mulG(a1, 13) ^ mulG(a2, 9) ^ mulG(a3, 14);
    }
  }
  function encBlock(b, w, Nr) {
    const s = new Uint8Array(b);
    addRoundKey(s, w, 0);
    for (let r = 1; r < Nr; r++) { subBytes(s); shiftRows(s); mixColumns(s); addRoundKey(s, w, r); }
    subBytes(s); shiftRows(s); addRoundKey(s, w, Nr);
    return s;
  }
  function decBlock(b, w, Nr) {
    const s = new Uint8Array(b);
    addRoundKey(s, w, Nr);
    for (let r = Nr - 1; r >= 1; r--) { invShiftRows(s); invSubBytes(s); addRoundKey(s, w, r); invMixColumns(s); }
    invShiftRows(s); invSubBytes(s); addRoundKey(s, w, 0);
    return s;
  }
  const pad = (d) => { const n = 16 - (d.length % 16); const out = new Uint8Array(d.length + n); out.set(d); out.fill(n, d.length); return out; };
  const unpad = (d) => { const n = d[d.length - 1]; return (n >= 1 && n <= 16 && d.length >= n) ? d.slice(0, d.length - n) : d; };
  function run(data, key, iv, encrypt) {
    const { w, Nr } = keyExpand(new Uint8Array(key));
    const d = encrypt ? pad(new Uint8Array(data)) : new Uint8Array(data);
    const out = new Uint8Array(d.length);
    let prev = iv ? new Uint8Array(iv) : new Uint8Array(16);
    for (let off = 0; off < d.length; off += 16) {
      const blk = d.slice(off, off + 16);
      if (encrypt) {
        const x = iv ? Uint8Array.from(blk, (v, i) => v ^ prev[i]) : blk;
        const e = encBlock(x, w, Nr);
        out.set(e, off); if (iv) prev = e;
      } else {
        const dec = decBlock(blk, w, Nr);
        out.set(iv ? Uint8Array.from(dec, (v, i) => v ^ prev[i]) : dec, off);
        if (iv) prev = blk;
      }
    }
    const res = encrypt ? out : unpad(out);
    return res.buffer.slice(res.byteOffset, res.byteOffset + res.length);
  }
  return { run };
})();

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
    const raw = (typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data));
    opt.body = raw ? data : JSON.stringify(data);
    /* v3.9：对象 body 自动补 JSON Content-Type（Komiic 等 GraphQL 源必需，否则服务端报 "no operations in query document"） */
    if (!raw && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) {
      h['Content-Type'] = 'application/json';
      opt.headers = h;
    }
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
  decodeUtf8(buf) { if (typeof buf === 'string') return buf; return new TextDecoder().decode(buf); },
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
  /* v3.9：AES 改同步纯 JS 实现（禁漫等源同步调用，async 会导致 Promise 流入后续计算） */
  encryptAesEcb(v, k) { return __aes.run(v, k, null, true); },
  decryptAesEcb(v, k) { return __aes.run(v, k, null, false); },
  encryptAesCbc(v, k, iv) { return __aes.run(v, k, iv, true); },
  decryptAesCbc(v, k, iv) { return __aes.run(v, k, iv, false); },
  async encryptAesCfb(v) { console.warn('AES-CFB 不支持'); return v; },
  async decryptAesCfb(v) { console.warn('AES-CFB 不支持'); return v; },
  async encryptAesOfb(v) { console.warn('AES-OFB 不支持'); return v; },
  async decryptAesOfb(v) { console.warn('AES-OFB 不支持'); return v; },
  async decryptRsa(v) { console.warn('RSA 不支持'); return v; },
  hexEncode(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); },
  hexDecode(hex) { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b.buffer; },
};
/* v3.9：md5 同步化。官方 Convert.md5 返回 16 字节原始摘要；
   引擎内 legado.md5 返回的是 hex 字符串，必须 hexDecode 还原成原始字节 */
Convert.md5 = (buf) => {
  try { return Convert.hexDecode(legado.md5(Convert.decodeUtf8(buf))); } catch (e) { return buf; }
};

/* v3.7：同步 SHA-256 / HMAC-SHA256 纯 JS 实现。
   很多图源（拷贝漫画等）把 Convert.hmacString 当同步函数用（没写 await），
   async 实现会变成 "[object Promise]" 请求头；且旧实现算法名拼错（SHA--256）。 */
const __sha256 = (() => {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  return function sha256(bytes) {
    const b = Array.from(new Uint8Array(bytes));
    const bitLen = b.length * 8;
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    for (let i = 7; i >= 0; i--) b.push((bitLen / Math.pow(256, i)) & 0xff);
    let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Array(64);
    for (let off = 0; off < b.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = ((b[off+i*4]<<24)|(b[off+i*4+1]<<16)|(b[off+i*4+2]<<8)|b[off+i*4+3]) >>> 0;
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i-15],7)^rr(w[i-15],18)^(w[i-15]>>>3);
        const s1 = rr(w[i-2],17)^rr(w[i-2],19)^(w[i-2]>>>10);
        w[i] = (w[i-16]+s0+w[i-7]+s1) >>> 0;
      }
      let [a,b2,c,d,e,f,g,hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e,6)^rr(e,11)^rr(e,25);
        const ch = (e&f)^(~e&g);
        const t1 = (hh+S1+ch+K[i]+w[i]) >>> 0;
        const S0 = rr(a,2)^rr(a,13)^rr(a,22);
        const mj = (a&b2)^(a&c)^(b2&c);
        const t2 = (S0+mj) >>> 0;
        hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b2; b2=a; a=(t1+t2)>>>0;
      }
      h = h.map((x,i)=>(x+[a,b2,c,d,e,f,g,hh][i])>>>0);
    }
    const out = new Uint8Array(32);
    h.forEach((x,i)=>{ out[i*4]=x>>>24; out[i*4+1]=(x>>>16)&0xff; out[i*4+2]=(x>>>8)&0xff; out[i*4+3]=x&0xff; });
    return out.buffer;
  };
})();
function __hmacSha256(key, value) {
  let k = new Uint8Array(key);
  if (k.length > 64) k = new Uint8Array(__sha256(k));
  const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < k.length; i++) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
  const v = new Uint8Array(value);
  const inner = new Uint8Array(64 + v.length); inner.set(ipad); inner.set(v, 64);
  const ih = new Uint8Array(__sha256(inner));
  const outer = new Uint8Array(64 + 32); outer.set(opad); outer.set(ih, 64);
  return __sha256(outer);
}
Convert.sha256 = (buf) => __sha256(buf); /* v3.9：同步 */
Convert.hmac = async (key, value, hash) => {
  const hs = String(hash || 'sha256').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (hs === 'sha256') return __hmacSha256(key, value);
  /* 其余算法退回 WebCrypto（图源里几乎只用 sha256） */
  const algo = { name: 'HMAC', hash: 'SHA-' + hs.replace('sha', '') };
  const k = await crypto.subtle.importKey('raw', key, algo, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, value);
};
Convert.hmacString = (key, value, hash) => {
  /* 同步版本：图源不写 await 也能拿到正确签名 */
  const hs = String(hash || 'sha256').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (hs === 'sha256') return Convert.encodeBase64(__hmacSha256(key, value));
  return '[hmac-' + hs + '-async-required]';
};

const UI = {
  showMessage(msg) { legado.log('[图源] ' + msg); },
  showDialog() {}, launchUrl() {}, showLoading() { return 1; }, cancelLoading() {},
  showInputDialog() { return null; }, showSelectDialog() { return null; },
};

/* v3.9：官方 APP 全局（manga_dex 等源用 APP.locale 决定语言） */
const APP = {
  version: '9.9.9',
  locale: 'zh_CN',
  platform: 'web',
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
    /* v3.7：部分图源（拷贝漫画）会把设置项直接改写成字符串（动态域名），此时整个值即设置值 */
    if (s != null && typeof s !== 'object') return s;
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
/* v3.9：init 常常是异步的（禁漫等源在 init 里拉取/回退域名列表），
   必须等它完成再执行搜索，否则域名表为空直接报错 */
const __initP = (typeof __src.init === 'function')
  ? Promise.resolve().then(() => __src.init()).catch((e) => legado.log('init: ' + (e.message || e)))
  : Promise.resolve();

function __tagsText(t) {
  if (!t) return '';
  if (Array.isArray(t)) return t.join(' ');
  if (t instanceof Map) { const a = []; t.forEach((v) => { if (Array.isArray(v)) a.push(...v); }); return a.join(' '); }
  if (typeof t === 'object') { const a = []; Object.values(t).forEach((v) => { if (Array.isArray(v)) a.push(...v); }); return a.join(' '); }
  return String(t);
}
/* v4.0：封面/缩略图应用 onThumbnailLoad 的请求头（JM 等 CDN 校验 Referer/UA，缺头直接 403）。
   官方缩略图不支持 modifyImage，只需头。 */
async function __cov(u) {
  if (!u || String(u).indexOf('data:') === 0) return u || '';
  u = String(u);
  let h = null;
  try {
    const f = __src.comic && __src.comic.onThumbnailLoad;
    if (typeof f === 'function') {
      const cfg = await f(u);
      if (cfg) { u = cfg.url || u; h = cfg.headers || null; }
    }
  } catch (e) {}
  return legado.proxyUrl(u, h || { referer: __src.url || '' });
}
async function __mapComic(c) {
  return {
    name: c.title || '', author: c.subtitle || c.subTitle || '',
    coverUrl: await __cov(c.cover), bookUrl: String(c.id),
    intro: c.description || '',
    kind: __tagsText(c.tags),
    type: 'comic',
  };
}

/* v3.9：按官方规范计算搜索选项默认值。
   官方行为：optionList 每项取 default（json 字符串化，多选得到 '["0","1"]'，所以图源里会 JSON.parse），
   无 default 时取第一个选项的 key（'-' 前部分）；dropdown 空 key 传 null */
function __defaultSearchOptions() {
  const ol = (__src.search && __src.search.optionList) || [];
  return ol.map((o) => {
    if (o.default !== undefined && o.default !== null) return JSON.stringify(o.default);
    const opts = (o.options || []).map((x) => String(x));
    if (!opts.length) return o.type === 'dropdown' ? null : '';
    const first = opts[0];
    const idx = first.indexOf('-');
    const key = idx >= 0 ? first.slice(0, idx) : first;
    if (o.type === 'dropdown' && key === '') return null;
    if (o.type === 'multi-select') return JSON.stringify([key]);
    return key;
  });
}

async function search(keyword, page) {
  await __initP;
  if (!__src.search) throw new Error('该图源不支持搜索');
  const opts = __defaultSearchOptions();
  let r;
  if (typeof __src.search.load === 'function') {
    r = await __src.search.load(keyword, opts, page || 1);
  } else if (typeof __src.search.loadNext === 'function') {
    /* loadNext 是游标式分页：无官方页码概念，只取首页 */
    if ((page || 1) > 1) return [];
    r = await __src.search.loadNext(keyword, opts, null);
  } else {
    throw new Error('该图源不支持搜索');
  }
  const arr = Array.isArray(r) ? r : (r.comics || []);
  return Promise.all(arr.map(__mapComic));
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
  await __initP;
  const d = await __src.comic.loadInfo(bookUrl);
  const info = {
    name: d.title || '', author: d.subtitle || d.subTitle || '',
    coverUrl: await __cov(d.cover), intro: d.description || '',
    lastUpdate: d.updateTime || d.uploadTime || '',
    kind: __tagsText(d.tags),
  };
  /* v4.0：分组标签 / 评分 / 点赞 / 评论数 / 上传者 / 推荐漫画（详情页展示用） */
  try {
    let tagsMap = null;
    if (d.tags && !Array.isArray(d.tags)) {
      tagsMap = {};
      if (d.tags instanceof Map) d.tags.forEach((v, k) => { tagsMap[String(k)] = Array.isArray(v) ? v.map(String) : [String(v)]; });
      else if (typeof d.tags === 'object') Object.keys(d.tags).forEach((k) => { const v = d.tags[k]; tagsMap[k] = Array.isArray(v) ? v.map(String) : [String(v)]; });
    }
    const extra = {
      tagsMap,
      stars: d.stars || 0,
      likes: d.likesCount || 0,
      comments: d.commentCount || 0,
      uploader: d.uploader || '',
      uploadTime: d.uploadTime || '',
      subId: d.subId != null ? String(d.subId) : null,
    };
    if (Array.isArray(d.recommend) && d.recommend.length) {
      extra.recommend = await Promise.all(d.recommend.slice(0, 20).map(__mapComic));
    }
    info.extra = JSON.stringify(extra);
  } catch (e) {}
  return info;
}

async function chapterList(bookUrl) {
  await __initP;
  const d = await __src.comic.loadInfo(bookUrl);
  return __flattenChapters(d.chapters, bookUrl);
}

async function chapterContent(chapterUrl) {
  await __initP;
  const i = chapterUrl.indexOf('||');
  const comicId = chapterUrl.slice(0, i);
  const epId = chapterUrl.slice(i + 2);
  let imgs = await __src.comic.loadEp(comicId, epId);
  if (!Array.isArray(imgs)) imgs = (imgs && imgs.images) || [];
  const out = [];
  for (const im of imgs) {
    let u = typeof im === 'string' ? im : (im.url || '');
    let h = (typeof im === 'object' && im) ? im.headers : null;
    let mod = null;
    if (typeof __src.comic.onImageLoad === 'function') {
      try {
        /* v4.0：传齐 (url, comicId, epId) —— JM 等源要用 epId+图片名 计算混淆切分数，
           之前只传 url 导致切分数恒为 0，图片永远是混淆原图 */
        const cfg = await __src.comic.onImageLoad(u, comicId, epId);
        if (cfg) { u = cfg.url || u; h = cfg.headers || h; mod = cfg.modifyImage || null; }
      } catch (e) {}
    }
    if (!u) continue;
    if (!/^https?:\\/\\//i.test(u)) continue;
    /* v4.5：漫画正文图片一律走中转（带源站 Referer/UA），防盗链 CDN（JM 等）直连会 403 */
    u = legado.proxyUrl(u, (h && Object.keys(h).length) ? h : { referer: __src.url || '' });
    /* v4.0：带 modifyImage 脚本时输出对象，阅读器端用 Canvas 执行图像还原 */
    out.push(mod ? { u, m: String(mod) } : u);
  }
  return JSON.stringify({ images: out });
}

/* ---------- v4.0：发现页（图源自带 explore 定义，App 不预置任何内容） ---------- */
async function sourceExplore() {
  await __initP;
  const list = Array.isArray(__src.explore) ? __src.explore : [];
  return JSON.stringify(list.map((e) => ({ title: String(e.title || ''), type: String(e.type || 'multiPartPage') })));
}

async function exploreLoad(idx, page) {
  await __initP;
  const e = (__src.explore || [])[idx];
  if (!e || typeof e.load !== 'function') throw new Error('该图源没有发现页');
  const r = await e.load(page);
  /* multiPartPage：返回 [{title, comics, viewMore}] */
  if (Array.isArray(r)) {
    return JSON.stringify({
      parts: await Promise.all(r.map(async (p) => ({
        title: String(p.title || ''), viewMore: String(p.viewMore || ''),
        comics: await Promise.all((p.comics || []).map(__mapComic)),
      }))),
    });
  }
  /* mixed：{data: [Comic[] | {title, comics, viewMore}], maxPage} */
  if (r && Array.isArray(r.data)) {
    const parts = [];
    for (const item of r.data) {
      if (Array.isArray(item)) parts.push({ title: '', viewMore: '', comics: await Promise.all(item.map(__mapComic)) });
      else if (item) parts.push({ title: String(item.title || ''), viewMore: String(item.viewMore || ''), comics: await Promise.all((item.comics || []).map(__mapComic)) });
    }
    return JSON.stringify({ parts, maxPage: r.maxPage || 0 });
  }
  /* multiPageComicList：{comics, maxPage} */
  const comics = (r && r.comics) || [];
  return JSON.stringify({ comics: await Promise.all(comics.map(__mapComic)), maxPage: (r && r.maxPage) || 0 });
}

/* v4.0：viewMore 跳转 —— 官方格式 'search:关键词' / 'category:名称[@参数]' */
async function viewMoreLoad(spec, page) {
  await __initP;
  spec = String(spec || '');
  if (spec.indexOf('search:') === 0) {
    return JSON.stringify({ comics: await search(spec.slice(7), page || 1), maxPage: 0 });
  }
  if (spec.indexOf('category:') === 0) {
    let body = spec.slice(9), param = null;
    const at = body.lastIndexOf('@');
    if (at >= 0) { param = body.slice(at + 1); body = body.slice(0, at); }
    const cc = __src.categoryComics;
    if (!cc || typeof cc.load !== 'function') throw new Error('该图源不支持分类浏览');
    /* 分类加载选项默认值（规则与搜索选项一致） */
    const opts = (cc.optionList || []).map((o) => {
      if (o.default !== undefined && o.default !== null) return JSON.stringify(o.default);
      const os = (o.options || []).map(String);
      if (!os.length) return '';
      const f = os[0], ci = f.indexOf('-');
      return ci >= 0 ? f.slice(0, ci) : f;
    });
    const r = await cc.load(body, param, opts, page || 1);
    return JSON.stringify({ comics: await Promise.all(((r && r.comics) || []).map(__mapComic)), maxPage: (r && r.maxPage) || 0 });
  }
  throw new Error('未知的跳转目标：' + spec);
}

/* ---------- v4.0：评论 ---------- */
async function loadComments(bookUrl, page) {
  await __initP;
  const f = __src.comic && __src.comic.loadComments;
  if (typeof f !== 'function') throw new Error('该图源不支持评论');
  let subId = null;
  try { const d = await __src.comic.loadInfo(bookUrl); subId = d.subId != null ? String(d.subId) : null; } catch (e) {}
  const r = await f(bookUrl, subId, page || 1, null);
  const list = await Promise.all(((r && r.comments) || []).map(async (c) => ({
    userName: String(c.userName || ''),
    avatar: await __cov(c.avatar || ''),
    content: String(c.content || ''),
    time: String(c.time || ''),
    replyCount: c.replyCount || 0,
    score: c.score || 0,
  })));
  return JSON.stringify({ comments: list, maxPage: (r && r.maxPage) || 0 });
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
/* v3.9：用户代码包进 IIFE——图源自带的顶层函数（hitomi 的 search 等）不再与适配层冲突 */
const __VEN_CLS = (() => {
${code}
;return ${meta.cls};
})();
/* ================= 适配层 ================= */
${VENERA_ADAPTER}
`;
}

/* v3.6：旧版 Venera 运行时缺少 loadSetting 等 API，导致大量官方图源（包子漫画等）无法使用。
   从旧连接器代码中提取用户图源原始代码，用新版运行时重新包装（返回 null 表示无需升级）。 */
const VEN_RUNTIME_MARK = '运行时 v4.0';
export function regenVeneraCode(code) {
  const text = String(code || '');
  if (!/extends\s+ComicSource/.test(text)) return null;      // 不是 Venera 图源
  if (text.includes(VEN_RUNTIME_MARK)) return null;          // 已是新版运行时
  const m = text.match(/\/\* =+ 用户图源代码 =+ \*\/\n([\s\S]*?)\n\/\* =+ 适配层 =+ \*\//);
  if (!m) return null;
  let userCode = m[1];
  /* v3.9 起用户代码包在 IIFE 里，提取时剥掉外壳 */
  userCode = userCode
    .replace(/^const __VEN_CLS = \(\(\) => \{\n/, '')
    .replace(/\n?;return [A-Za-z_$][\w$]*;\}\)\(\);\s*$/, '');
  const urlM = text.match(/^\/\/ @url\s+(\S*)$/m);
  try {
    return veneraToJsSource(userCode, urlM ? urlM[1] : '');
  } catch (e) { return null; }
}
