/* ===== ThirdHub js/engine/worker.js — Web Worker 沙箱（修正版） ===== */
'use strict';

/* ---------- 哈希实现 ---------- */
function md5cycle(x, k) {
  let a = x[0], b = x[1], c = x[2], d = x[3];
  const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t);
  a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
  a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
  a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
  a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
  x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
}
function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
function add32(a, b) { return (a + b) & 0xffffffff; }
function md5blk(s) { const blocks = []; for (let i = 0; i < 64; i += 4) blocks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24); return blocks; }
function md5(s) {
  s = unescape(encodeURIComponent(s));
  const n = s.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
  s = s.substring(i - 64);
  const tail = new Array(16).fill(0);
  for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
  tail[i >> 2] |= 0x80 << ((i % 4) << 3);
  if (i > 55) { md5cycle(state, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
  tail[14] = n * 8;
  md5cycle(state, tail);
  return state.map((x) => { let h = ''; for (let j = 0; j < 4; j++) h += ('0' + ((x >> (j * 8)) & 255).toString(16)).slice(-2); return h; }).join('');
}
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 网络（三级代理回退） ---------- */
let PROXY = { backend: '', publics: [], mode: 'auto' };

async function rawFetch(url, options = {}) {
  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    redirect: 'follow',
  });
  const text = await resp.text();
  return { status: resp.status, body: text, url: resp.url };
}

async function httpRequest(url, options = {}) {
  if (PROXY.backend && PROXY.mode !== 'direct') {
    try {
      const resp = await fetch(PROXY.backend + (PROXY.backend.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url), {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/octet-stream' } : {},
        body: options.body ? JSON.stringify({ body: options.body, headers: options.headers }) : undefined,
      });
      if (resp.ok) return { status: resp.status, body: await resp.text(), url };
    } catch (e) {}
  }
  try { return await rawFetch(url, options); } catch (e) {}
  if (PROXY.mode !== 'direct') {
    for (const p of PROXY.publics) {
      try { return await rawFetch(p + encodeURIComponent(url), options); } catch (e) {}
    }
  }
  throw new Error('网络请求失败：' + url);
}

/* ---------- DOM 解析 ---------- */
const domApi = {
  parse(html) { return new DOMParser().parseFromString(String(html), 'text/html'); },
  select(doc, selector) { return doc.querySelector(selector); },
  selectAll(doc, selector) { return [...doc.querySelectorAll(selector)]; },
  text(el) { return el ? (el.textContent || '').trim() : ''; },
  html(el) { return el ? el.innerHTML : ''; },
  attr(el, name) { return el ? (el.getAttribute(name) || '') : ''; },
};

function jsonPath(obj, path) {
  try {
    const parts = String(path).replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) { if (cur == null) return null; cur = cur[p]; }
    return cur;
  } catch (e) { return null; }
}

/* ---------- legado API ---------- */
const legado = {
  http: {
    get: (url, headers) => httpRequest(url, { headers }).then((r) => r.body),
    post: (url, body, headers) => httpRequest(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers }).then((r) => r.body),
    request: (url, options) => httpRequest(url, options),
  },
  dom: domApi,
  base64Encode: (s) => btoa(unescape(encodeURIComponent(String(s)))),
  base64Decode: (s) => decodeURIComponent(escape(atob(String(s)))),
  md5, sha1, sha256,
  urlEncode: (s) => encodeURIComponent(String(s)),
  urlDecode: (s) => decodeURIComponent(String(s)),
  jsonPath,
  log: (msg) => postMessage({ type: 'log', msg: String(msg) }),
  config: {
    _mem: {},
    read(scope, key) { return (legado.config._mem[scope] || {})[key]; },
    write(scope, key, value) {
      legado.config._mem[scope] = legado.config._mem[scope] || {};
      legado.config._mem[scope][key] = value;
      postMessage({ type: 'config', scope, key, value });
    },
  },
};

/* ---------- 消息处理 ---------- */
let loaded = false;
const FN_NAMES = ['search', 'bookInfo', 'chapterList', 'chapterContent'];

onmessage = async (e) => {
  const { type, id } = e.data;
  try {
    if (type === 'init') {
      PROXY = e.data.proxy || PROXY;
      postMessage({ type: 'inited', id });
      return;
    }
    if (type === 'load') {
      const meta = {};
      String(e.data.code).split('\n').slice(0, 40).forEach((line) => {
        const m = line.match(/^\s*\/\/\s*@([\w-]+)\s+(.+)$/);
        if (m) meta[m[1].toLowerCase()] = m[2].trim();
      });
      // 在全局作用域执行，函数挂载到 self 上
      const runner = new Function('legado', 'self',
        e.data.code +
        '\n;self.__srcFns = {};' +
        FN_NAMES.map((n) => `if (typeof ${n} === 'function') self.__srcFns.${n} = ${n};`).join(''));
      runner(legado, self);
      if (!self.__srcFns || !self.__srcFns.search) throw new Error('连接器缺少 search() 函数');
      loaded = true;
      postMessage({ type: 'loaded', id, meta });
      return;
    }
    if (type === 'call') {
      if (!loaded) throw new Error('连接器未加载');
      const target = self.__srcFns[e.data.fn];
      if (typeof target !== 'function') throw new Error('连接器缺少函数：' + e.data.fn);
      const result = await target(...(e.data.args || []));
      postMessage({ type: 'result', id, result: result === undefined ? null : result });
      return;
    }
  } catch (err) {
    postMessage({ type: 'error', id, error: err.message || String(err) });
  }
};
