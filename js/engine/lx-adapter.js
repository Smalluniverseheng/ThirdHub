/* ===== ThirdHub js/engine/lx-adapter.js — LX Music（落雪）自定义源适配器（v4.1） =====
   用户导入落雪音乐自定义源 JS 脚本（globalThis.lx 规范），
   这里生成 ThirdHub 音乐连接器：脚本负责解析播放地址（musicUrl），
   平台搜索移植自 lx-music-desktop（Apache-2.0）musicSdk 的 kw/kg/tx/wy/mg 实现。 */

/* 检测是否为 LX 自定义源脚本 */
export function isLxSource(code) {
  const s = String(code || '');
  return /globalThis\.lx|lx\.on\s*\(|EVENT_NAMES/.test(s) && !/function\s+search\s*\(/.test(s);
}

/* 解析 LX 脚本头（`/*! @name … *!` 块注释或 // @name 行注释） */
export function parseLxMeta(code) {
  const meta = {};
  const head = String(code).slice(0, 3000);
  const re = /@(name|description|version|author|homepage)\s+([^\n*]+)/g;
  let m;
  while ((m = re.exec(head))) meta[m[1]] = m[2].trim();
  return meta;
}

/* ---------- 生成连接器代码（在 ThirdHub 源引擎沙箱内运行） ---------- */

const LX_RUNTIME = String.raw`
/* --- 纯 JS AES-128（ECB/CBC 加密，PKCS7，已与 Node crypto 逐字节校验） --- */
const __AES = (() => {
  const S = [99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
  const RCON = [1,2,4,8,16,32,64,128,27,54];
  function xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }
  function mul(a, b) { let r = 0; while (b) { if (b & 1) r ^= a; a = xtime(a); b >>= 1; } return r; }
  function keyExpand(key) {
    const w = Array.from(key);
    for (let i = 16; i < 176; i += 4) {
      let t = w.slice(i - 4, i);
      if (i % 16 === 0) { t = [t[1], t[2], t[3], t[0]].map((b) => S[b]); t[0] ^= RCON[i / 16 - 1]; }
      for (let j = 0; j < 4; j++) w.push(w[i - 16 + j] ^ t[j]);
    }
    return w;
  }
  function addRoundKey(s, w, r) { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; }
  function subBytes(s) { for (let i = 0; i < 16; i++) s[i] = S[s[i]]; }
  function shiftRows(s) { const t = s.slice(); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s[c * 4 + r] = t[((c + r) % 4) * 4 + r]; }
  function mixColumns(s) {
    for (let c = 0; c < 4; c++) {
      const i = c * 4, a = [s[i], s[i + 1], s[i + 2], s[i + 3]];
      s[i] = mul(a[0], 2) ^ mul(a[1], 3) ^ a[2] ^ a[3];
      s[i + 1] = a[0] ^ mul(a[1], 2) ^ mul(a[2], 3) ^ a[3];
      s[i + 2] = a[0] ^ a[1] ^ mul(a[2], 2) ^ mul(a[3], 3);
      s[i + 3] = mul(a[0], 3) ^ a[1] ^ a[2] ^ mul(a[3], 2);
    }
  }
  function encryptBlock(block, w) {
    const s = Array.from(block);
    addRoundKey(s, w, 0);
    for (let r = 1; r < 10; r++) { subBytes(s); shiftRows(s); mixColumns(s); addRoundKey(s, w, r); }
    subBytes(s); shiftRows(s); addRoundKey(s, w, 10);
    return s;
  }
  function pkcs7(bytes) { const p = 16 - (bytes.length % 16); return bytes.concat(Array(p).fill(p)); }
  return {
    ecb(data, key) { const w = keyExpand(key), b = pkcs7(Array.from(data)), out = []; for (let i = 0; i < b.length; i += 16) out.push.apply(out, encryptBlock(b.slice(i, i + 16), w)); return out; },
    cbc(data, key, iv) { const w = keyExpand(key), b = pkcs7(Array.from(data)), out = []; let prev = Array.from(iv); for (let i = 0; i < b.length; i += 16) { const blk = b.slice(i, i + 16).map((x, j) => x ^ prev[j]); const enc = encryptBlock(blk, w); out.push.apply(out, enc); prev = enc; } return out; },
  };
})();
function __sb(s) { return Array.from(new TextEncoder().encode(String(s))); }
function __hex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''); }
function __b64(b) { let s = ''; const a = Array.from(b); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.slice(i, i + 0x8000)); return btoa(s); }
function __bufLike(bytes) { /* 伪装成 Buffer：支持 toString('hex'|'base64'|'utf8') */
  const u = new Uint8Array(bytes);
  u.toString = (enc) => enc === 'hex' ? __hex(u) : enc === 'base64' ? __b64(u) : new TextDecoder().decode(u);
  return u;
}
function __bufFrom(data, enc) {
  if (typeof data !== 'string') return __bufLike(Array.from(data));
  if (enc === 'hex') { const a = []; for (let i = 0; i < data.length; i += 2) a.push(parseInt(data.substr(i, 2), 16)); return __bufLike(a); }
  if (enc === 'base64') { const s = atob(data); return __bufLike([...s].map((c) => c.charCodeAt(0))); }
  return __bufLike(__sb(data));
}
function __aesEnc(data, mode, key, iv) {
  const d = typeof data === 'string' ? __sb(data) : Array.from(data);
  const k = typeof key === 'string' ? __sb(key) : Array.from(key);
  if (/cbc/i.test(mode)) return __bufLike(__AES.cbc(d, k, typeof iv === 'string' ? __sb(iv) : Array.from(iv)));
  return __bufLike(__AES.ecb(d, k));
}

/* --- LX 自定义源运行时（globalThis.lx 规范） --- */
const __lxState = { sources: {}, handlers: {} };
globalThis.lx = {
  EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
  on(name, handler) { __lxState.handlers[name] = handler; },
  send(name, data) { if (name === 'inited' && data && data.sources) __lxState.sources = data.sources; },
  request(url, options, callback) {
    options = options || {};
    const opt = { method: (options.method || 'get').toUpperCase(), headers: options.headers || {} };
    if (options.body != null) opt.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    else if (options.form != null) {
      opt.body = Object.keys(options.form).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(options.form[k])).join('&');
      if (!opt.headers['Content-Type']) opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    legado.http.request(url, opt).then((resp) => {
      callback(null, { statusCode: resp.status, statusMessage: '', headers: resp.headers || {}, body: resp.body, bytes: null, raw: resp.body });
    }, (err) => callback(err, null));
  },
  utils: {
    buffer: { from: __bufFrom, bufToString: (b, enc) => __bufLike(b).toString(enc) },
    crypto: {
      md5: (s) => legado.md5(s),
      aesEncrypt: __aesEnc,
      aesDecrypt: () => { throw new Error('aesDecrypt 暂不支持'); },
      rsaEncrypt: () => { throw new Error('rsaEncrypt 暂不支持'); },
      randomBytes: (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return __bufLike(b); },
    },
    zlib: { inflate: () => Promise.reject(new Error('zlib 暂不支持')), gunzip: () => Promise.reject(new Error('zlib 暂不支持')) },
  },
  currentScriptInfo: null,
  version: '2.11.0',
};
function __decodeName(s) {
  if (!s) return '';
  const t = document.createElement('textarea');
  t.innerHTML = String(s);
  return t.value;
}
function __fmtTime(sec) { sec = parseInt(sec); if (isNaN(sec) || sec <= 0) return ''; const m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s); }
function __fmtSize(b) { b = parseInt(b); if (isNaN(b)) return ''; if (b > 1073741824) return (b / 1073741824).toFixed(2) + 'G'; if (b > 1048576) return (b / 1048576).toFixed(2) + 'M'; return (b / 1024).toFixed(2) + 'K'; }
`;

const LX_PLATFORMS = String.raw`
/* --- 平台搜索（移植自 lx-music-desktop src/renderer/utils/musicSdk，Apache-2.0） --- */
const __PLAT = {
  /* 酷我 kw：search.kuwo.cn 公开接口 */
  async kw(kw, page, limit) {
    limit = limit || 30;
    const body = await legado.http.get('http://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(kw) + '&pn=' + (page - 1) + '&rn=' + limit + '&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1');
    const j = JSON.parse(body);
    if (!j || (j.TOTAL !== '0' && j.SHOW === '0') || !j.abslist) return [];
    const rx = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;
    return j.abslist.filter((i) => i.N_MINFO).map((i) => {
      const types = {}, list = [];
      i.N_MINFO.split(';').forEach((raw) => {
        const m = raw.match(rx);
        if (!m) return;
        const q = { '4000': 'flac24bit', '2000': 'flac', '320': '320k', '128': '128k' }[m[2]];
        if (q && !types[q]) { types[q] = { size: m[4] }; list.push(q); }
      });
      return { name: __decodeName(i.SONGNAME), singer: __decodeName(i.ARTIST || '').replace(/&/g, '、'), source: 'kw', songmid: String(i.MUSICRID || '').replace('MUSIC_', ''), albumId: i.ALBUMID || '', albumName: __decodeName(i.ALBUM || ''), interval: __fmtTime(i.DURATION), img: null, types: list, _types: types };
    });
  },
  /* 酷狗 kg：songsearch.kugou.com 公开接口 */
  async kg(kw, page, limit) {
    limit = limit || 30;
    const body = await legado.http.get('https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent(kw) + '&page=' + page + '&pagesize=' + limit + '&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1');
    const j = JSON.parse(body);
    if (!j || j.error_code !== 0 || !j.data) return [];
    const map1 = (d) => {
      const types = {}, list = [];
      [['FileSize', 'FileHash', '128k'], ['HQFileSize', 'HQFileHash', '320k'], ['SQFileSize', 'SQFileHash', 'flac'], ['ResFileSize', 'ResFileHash', 'flac24bit']].forEach(([sk, hk, q]) => {
        if (d[sk]) { types[q] = { size: __fmtSize(d[sk]), hash: d[hk] }; list.push(q); }
      });
      return { name: __decodeName(d.SongName), singer: __decodeName((d.Singers || []).map((s) => s.name).join('、')), source: 'kg', songmid: d.Audioid, albumId: d.AlbumID, albumName: __decodeName(d.AlbumName || ''), interval: __fmtTime(d.Duration), img: null, hash: d.FileHash, types: list, _types: types };
    };
    const out = [], seen = new Set();
    (j.data.lists || []).forEach((d) => {
      [d].concat(d.Grp || []).forEach((x) => {
        const key = String(x.Audioid) + x.FileHash;
        if (seen.has(key)) return; seen.add(key); out.push(map1(x));
      });
    });
    return out;
  },
  /* 咪咕 mg：jadeite v3 接口，MD5 签名 */
  async mg(kw, page, limit) {
    limit = limit || 20;
    const time = Date.now().toString();
    const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
    const sign = legado.md5(String(kw) + '6cdc72a439cef99a3418d2a78aa28c73' + 'yyapp2d16148780a1dcc7408e06336b98cfd50' + deviceId + time);
    const body = await legado.http.get('https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=' + limit + '&text=' + encodeURIComponent(kw) + '&pageNo=' + page + '&sort=0&sid=USS', {
      uiVersion: 'A_music_3.6.1', deviceId, timestamp: time, sign, channel: '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    });
    const j = JSON.parse(body);
    if (!j || j.code !== '000000' || !j.songResultData) return [];
    const out = [], seen = new Set();
    (j.songResultData.resultList || []).forEach((grp) => (grp || []).forEach((d) => {
      if (!d.songId || !d.copyrightId || seen.has(d.copyrightId)) return;
      seen.add(d.copyrightId);
      const types = {}, list = [];
      (d.audioFormats || []).forEach((f) => {
        const q = { PQ: '128k', HQ: '320k', SQ: 'flac', ZQ24: 'flac24bit' }[f.formatType];
        if (q && !types[q]) { types[q] = { size: __fmtSize(f.asize || f.isize) }; list.push(q); }
      });
      let img = d.img3 || d.img2 || d.img1 || null;
      if (img && !/^https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img;
      out.push({ name: d.name, singer: (d.singerList || []).map((s) => s.name).join('、'), source: 'mg', songmid: d.songId, copyrightId: d.copyrightId, albumId: d.albumId, albumName: d.album || '', interval: __fmtTime(d.duration), img, lrcUrl: d.lrcUrl, types: list, _types: types });
    }));
    return out;
  },
  /* QQ 音乐 tx：musics.fcg，zzc 签名（SHA1 挑位 + 异或混淆） */
  async tx(kw, page, limit) {
    limit = limit || 30;
    const data = {
      comm: { ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic', phonetype: 'EBG-AN10', deviceScore: '553.47', devicelevel: '50', newdevicelevel: '20', rom: 'HuaWei/EMOTION/EmotionUI_14.2.0', os_ver: '12', OpenUDID: '0', OpenUDID2: '0', QIMEI36: '0', udid: '0', chid: '0', aid: '0', oaid: '0', taid: '0', tid: '0', wid: '0', uid: '0', sid: '0', modeSwitch: '6', teenMode: '0', ui_mode: '2', nettype: '1020', v4ip: '' },
      req: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicMobile', param: { search_type: 0, searchid: Math.random().toString().slice(2), query: String(kw), page_num: page, num_per_page: limit, highlight: 0, nqc_flag: 0, multi_zhida: 0, cat: 2, grp: 1, sin: 0, sem: 0 } },
    };
    const hash = await legado.sha1(JSON.stringify(data));
    const pick = (idxs) => idxs.map((i) => hash[i]).join('');
    const SCR = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
    const part3 = SCR.map((v, i) => v ^ parseInt(hash.substr(i * 2, 2), 16));
    const b64 = __b64(part3).replace(/[\/+=]/g, '');
    const sign = ('zzc' + pick([23, 14, 6, 36, 16, 40, 7, 19]) + b64 + pick([16, 1, 32, 12, 19, 27, 8, 5])).toLowerCase();
    const body = await legado.http.post('https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + sign, JSON.stringify(data), { 'User-Agent': 'QQMusic 14090508(android 12)' });
    const j = JSON.parse(body);
    if (!j || j.code !== 0 || !j.req || j.req.code !== 0 || !j.req.data) return [];
    return ((j.req.data.body && j.req.data.body.item_song) || []).filter((i) => i.file && i.file.media_mid).map((i) => {
      const types = {}, list = [];
      [['size_128mp3', '128k'], ['size_320mp3', '320k'], ['size_flac', 'flac'], ['size_hires', 'flac24bit']].forEach(([sk, q]) => {
        if (i.file[sk]) { types[q] = { size: __fmtSize(i.file[sk]) }; list.push(q); }
      });
      const albumMid = i.album ? i.album.mid : '';
      return { name: i.title, singer: (i.singer || []).map((s) => s.name).join('、'), source: 'tx', songmid: i.mid, songId: i.id, strMediaMid: i.file.media_mid, albumMid, albumName: i.album ? i.album.name : '', interval: __fmtTime(i.interval), img: albumMid ? 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + albumMid + '.jpg' : (i.singer && i.singer.length ? 'https://y.gtimg.cn/music/photo_new/T001R500x500M000' + i.singer[0].mid + '.jpg' : ''), types: list, _types: types };
    });
  },
  /* 网易云 wy：eapi 接口，AES-128-ECB 加密参数 */
  async wy(kw, page, limit) {
    limit = limit || 30;
    const url = '/api/search/song/list/page';
    const payload = { keyword: String(kw), needCorrect: '1', channel: 'typing', offset: limit * (page - 1), scene: 'normal', total: page === 1, limit };
    const text = JSON.stringify(payload);
    const digest = legado.md5('nobody' + url + 'use' + text + 'md5forencrypt');
    const enc = __AES.ecb(__sb(url + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest), __sb('e82ckenh8dichen8'));
    const params = __hex(enc).toUpperCase();
    const body = await legado.http.post('https://interface.music.163.com/eapi/batch', 'params=' + encodeURIComponent(params), {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      origin: 'https://music.163.com',
    });
    const j = JSON.parse(body);
    if (!j || j.code !== 200 || !j.data) return [];
    return (j.data.resources || []).map((r) => {
      const i = r.baseInfo && r.baseInfo.simpleSongData;
      if (!i) return null;
      const types = {}, list = [];
      const priv = i.privilege || {};
      if (priv.maxBrLevel === 'hires') { types.flac24bit = { size: i.hr ? __fmtSize(i.hr.size) : '' }; list.push('flac24bit'); }
      if (priv.maxbr >= 999000) { types.flac = { size: i.sq ? __fmtSize(i.sq.size) : '' }; list.push('flac'); }
      if (priv.maxbr >= 320000) { types['320k'] = { size: i.h ? __fmtSize(i.h.size) : '' }; list.push('320k'); }
      if (priv.maxbr >= 128000) { types['128k'] = { size: i.l ? __fmtSize(i.l.size) : '' }; list.push('128k'); }
      return { name: i.name, singer: (i.ar || []).map((s) => s.name).join('、'), source: 'wy', songmid: i.id, albumId: i.al && i.al.id, albumName: i.al ? i.al.name : '', interval: __fmtTime(i.dt / 1000), img: i.al && i.al.picUrl, types: list, _types: types };
    }).filter(Boolean);
  },
};

/* --- ThirdHub 连接器接口 --- */
const __LX_SRC_NAME = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' };
function __lxDeclared() {
  return ['kw', 'kg', 'tx', 'wy', 'mg'].filter((p) => __lxState.sources[p] && __lxState.sources[p].type === 'music');
}
async function search(keyword, page) {
  const plats = __lxDeclared();
  if (!plats.length) throw new Error('LX 源脚本未声明可用平台');
  const lists = await Promise.all(plats.map((p) => __PLAT[p](keyword, page || 1).catch(() => [])));
  const out = [];
  lists.flat().forEach((i) => out.push({
    name: i.name, author: i.singer, coverUrl: i.img || '', kind: __LX_SRC_NAME[i.source] || i.source,
    intro: [i.albumName, i.interval].filter(Boolean).join(' · '),
    bookUrl: JSON.stringify({ src: i.source, info: i }),
  }));
  return out;
}
function bookInfo(bookUrl) {
  const d = JSON.parse(bookUrl);
  return JSON.stringify({ name: d.info.name, author: d.info.singer, coverUrl: d.info.img || '', intro: (__LX_SRC_NAME[d.src] || d.src) + ' · ' + (d.info.albumName || ''), kind: '音乐' });
}
function chapterList(bookUrl) {
  const d = JSON.parse(bookUrl);
  return JSON.stringify([{ name: d.info.name + (d.info.singer ? ' - ' + d.info.singer : ''), url: bookUrl, duration: d.info.interval || '' }]);
}
async function chapterContent(chapterUrl) {
  const d = JSON.parse(chapterUrl);
  const handler = __lxState.handlers['request'];
  if (!handler) throw new Error('LX 源脚本未注册 request 处理');
  const declared = (__lxState.sources[d.src] && __lxState.sources[d.src].qualitys) || [];
  let qs = ['flac24bit', 'flac', '320k', '128k'].filter((q) => !declared.length || declared.includes(q));
  if (d.info._types && Object.keys(d.info._types).length) {
    const f = qs.filter((q) => d.info._types[q]);
    if (f.length) qs = f;
  }
  let lastErr = null;
  for (const q of qs) {
    try {
      const url = await handler({ source: d.src, action: 'musicUrl', info: { type: q, musicInfo: d.info } });
      if (url) return JSON.stringify({ title: d.info.name, url: String(url), coverUrl: d.info.img || '', duration: d.info.interval || '' });
    } catch (e) { lastErr = e; }
  }
  throw new Error('获取播放地址失败' + (lastErr && lastErr.message ? '：' + lastErr.message : ''));
}

/* --- 用户 LX 源脚本（原文嵌入） --- */
`;

/* 把用户导入的 LX 自定义源脚本转换成 ThirdHub 音乐连接器 */
export function lxToJsSource(code) {
  const meta = parseLxMeta(code);
  const name = (meta.name || 'LX 音乐源').replace(/[\r\n]/g, ' ').slice(0, 40);
  const header = [
    `// @name ${name}（LX源）`,
    '// @type music',
    `// @version ${meta.version || '1.0'}`,
    `// @author ${meta.author || '落雪自定义源'}`,
    meta.homepage ? `// @url ${meta.homepage}` : '',
    '/* ===== 由 lx-adapter 生成：LX 运行时 + 平台搜索（移植自落雪音乐） + 用户源脚本 ===== */',
  ].filter(Boolean).join('\n');
  return header + '\n' + LX_RUNTIME + LX_PLATFORMS + '\n' + String(code);
}
