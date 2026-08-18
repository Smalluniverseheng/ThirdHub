/* ===== ThirdHub js/engine/legado-adapter.js — 阅读APP（Legado）/ 基础CSS选择器书源适配器 =====
   零内置原则不变：书源全部由用户自行导入。
   把社区主流的两种 JSON 书源格式转换为统一连接器 JS 代码（内存生成，在 Worker 沙箱执行）：
   1. 阅读APP（Legado）书源：JSON 数组，ruleSearch / ruleBookInfo / ruleToc / ruleContent 规则
   2. 基础 CSS 选择器书源：单个 JSON 对象，searchList / searchName / content / images 字段
   规则语法子集：CSS选择器@text|href|src|html|data-src，多条备用规则用 || 分隔 */

/* ---------- 格式检测 ---------- */
export function isLegadoJson(text) {
  try {
    const j = JSON.parse(String(text).trim());
    const arr = Array.isArray(j) ? j : [j];
    return arr.length > 0 && arr.every((it) => it && typeof it === 'object' && (it.bookSourceUrl || it.bookSourceName));
  } catch (e) { return false; }
}

export function isBasicJson(text) {
  try {
    const j = JSON.parse(String(text).trim());
    const arr = Array.isArray(j) ? j : [j];
    return arr.length > 0 && arr.every((it) =>
      it && typeof it === 'object' && it.name && it.url && it.searchUrl &&
      (it.searchList || it.searchName || it.content || it.images || it.chapterList));
  } catch (e) { return false; }
}

/* ---------- Legado JSON → 统一规则 ---------- */
function legadoRules(item) {
  const rs = item.ruleSearch || {};
  const ri = item.ruleBookInfo || {};
  const rt = item.ruleToc || {};
  const rc = item.ruleContent || {};
  const type = (item.bookSourceType === 2 || item.bookSourceType === '2') ? 'comic' : 'novel';
  return {
    name: item.bookSourceName || item.bookSourceUrl,
    url: item.bookSourceUrl,
    type,
    searchUrl: String(item.searchUrl || ''),
    header: item.header || '',
    search: {
      list: rs.bookList || '',
      name: rs.name || 'a@text',
      author: rs.author || '',
      cover: rs.coverUrl || '',
      bookUrl: rs.bookUrl || 'a@href',
      intro: rs.intro || '',
      kind: rs.kind || '',
    },
    info: {
      name: ri.name || '', author: ri.author || '', intro: ri.intro || '',
      cover: ri.coverUrl || '', kind: ri.kind || '', lastUpdate: ri.lastUpdate || '',
    },
    toc: {
      list: rt.chapterList || 'a',
      name: rt.chapterName || '@text',
      url: rt.chapterUrl || 'a@href',
      next: rt.nextTocUrl || '',
      tocUrl: ri.tocUrl || '',
    },
    content: {
      rule: rc.content || (type === 'comic' ? 'img@src' : '#content@html'),
      next: rc.nextContentUrl || '',
      replace: Array.isArray(rc.replaceRegex) ? rc.replaceRegex : (rc.replaceRegex ? [rc.replaceRegex] : []),
    },
  };
}

/* ---------- 基础 CSS 选择器 JSON → 统一规则 ---------- */
function basicRules(item) {
  const type = item.type === 'comic' || item.images ? 'comic' : 'novel';
  return {
    name: item.name,
    url: item.url,
    type,
    searchUrl: String(item.searchUrl || ''),
    header: item.header || '',
    search: {
      list: item.searchList || 'div',
      name: item.searchName || 'a',
      author: item.searchAuthor || '',
      cover: item.searchCover || '',
      bookUrl: item.searchUrl2 || item.searchLink || 'a@href',
      intro: item.searchIntro || '',
      kind: '',
    },
    info: {
      name: item.infoName || '', author: item.infoAuthor || '', intro: item.infoIntro || item.intro || '',
      cover: item.infoCover || '', kind: '', lastUpdate: '',
    },
    toc: { list: item.chapterList || 'a', name: '@text', url: 'a@href', next: '' },
    content: {
      rule: type === 'comic' ? (item.images || 'img@src') : (item.content || '#content'),
      next: '',
      replace: '',
      filter: Array.isArray(item.contentFilter) ? item.contentFilter : [],
    },
  };
}

/* ---------- 统一规则 → 连接器 JS 代码 ----------
   生成的代码在 js/engine/worker.js 沙箱中运行，可用 API：
   legado.http.get(url, headers) / legado.dom.parse / selectAll / text / html / attr / urlEncode */
function rulesToCode(R) {
  const SRC = JSON.stringify(R).replace(/<\/script/gi, '<\\/script');
  return `// @name        ${R.name}
// @version     1.0
// @author      ${R.type === 'comic' ? '图源' : '书源'}适配（社区格式）
// @url         ${R.url}
// @type        ${R.type}
// @enabled     true

const SRC = ${SRC};

function absUrl(u, base) {
  u = (u || '').trim();
  if (!u) return '';
  try { return new URL(u, base).href; } catch (e) { return u; }
}
function reqHeaders() {
  const h = {};
  if (SRC.header) {
    try { Object.assign(h, typeof SRC.header === 'string' ? JSON.parse(SRC.header) : SRC.header); } catch (e) {}
  }
  return h;
}
/* 规则引擎（v3.0 重写，兼容阅读APP语法）：
   - 列表/链式规则用 @ 分段：'ul.1@a' = 第 2 个 ul 内的所有 a（.N 为 0 起索引）
   - 前缀：id.xxx / class.a b / tag.a / text.文本（按自身文本匹配元素）
   - 排除：'tag.tr!0' 排除第 1 个，'li!0:2' 排除区间
   - 净化：规则后接 '##正则' 删除、'##正则##替换' 替换
   - 叶规则 'h3@text' / 'img@src'：尾段是属性关键字则提取属性，否则视为链式段
   - 多条备用规则用 || 分隔 */
const RULE_ATTRS = ['text', 'html', 'href', 'src', 'ownText', 'textNodes', 'alt', 'title', 'value', 'id', 'class', 'style'];
/* v3.5：规则类型前缀归一化 —— '@css:'/'@CSS:' 直接剥掉（墨坛文学等大量书源在用） */
function normRule(rule) {
  return String(rule || '').trim().replace(/^@css:/i, '');
}
function parseSeg(seg) {
  seg = String(seg).trim();
  let exclude = null;
  const em = seg.match(/!(\\d+(:\\d+)?)$/);
  if (em) { exclude = em[1]; seg = seg.slice(0, seg.length - em[0].length); }
  let index = null;
  const im = seg.match(/^(.*)\\.(\\d+)$/);
  if (im && im[1] && !/^(id|class|tag|text)$/.test(im[1])) { index = parseInt(im[2], 10); seg = im[1]; }
  return { sel: seg, index: index, exclude: exclude };
}
function segToCss(sel) {
  if (sel.indexOf('id.') === 0) return '#' + sel.slice(3).trim();
  if (sel.indexOf('class.') === 0) return sel.slice(6).trim().split(/\\s+/).map(function (c) { return '.' + c; }).join('');
  if (sel.indexOf('tag.') === 0) return sel.slice(4).trim();
  return sel;
}
function ownTextOf(el) { return [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(); }
function querySeg(roots, seg) {
  const p = parseSeg(seg);
  if (!p.sel) return roots;
  const out = [];
  roots.forEach((r) => {
    let els = [];
    if (p.sel.indexOf('text.') === 0) {
      const want = p.sel.slice(5).trim();
      try { els = [...r.querySelectorAll('*')].filter((el) => ownTextOf(el).indexOf(want) >= 0); } catch (e) { els = []; }
    } else {
      let css = segToCss(p.sel);
      /* v3.5：jQuery/阅读APP 方言兼容 —— :eq(N) 转为索引，:not(first-child) 补冒号 */
      let eqIdx = null;
      const eqm = css.match(/:eq\\((\\d+)\\)/);
      if (eqm) { eqIdx = parseInt(eqm[1], 10); css = css.replace(/:eq\\(\\d+\\)/g, ''); }
      css = css.replace(/:not\\((first|last)-child\\)/g, ':not(:$1-child)');
      try { els = [...r.querySelectorAll(css)]; } catch (e) { els = []; }
      if (eqIdx != null && p.index == null) p.index = eqIdx;
    }
    if (p.exclude) {
      const parts = p.exclude.split(':').map(Number);
      els = els.filter((_, i) => (parts.length === 2 ? (i < parts[0] || i >= parts[1]) : i !== parts[0]));
    }
    if (p.index != null) { if (els[p.index]) out.push(els[p.index]); }
    else out.push(...els);
  });
  return out;
}
function selectChain(root, rule) {
  let cur = [root];
  const segs = normRule(rule).split('@').map((x) => x.trim()).filter(Boolean);
  for (const seg of segs) {
    cur = querySeg(cur, seg);
    if (!cur.length) break;
  }
  return cur;
}
function extractAttr(t, attr) {
  if (!t) return '';
  if (attr === 'text') return (t.textContent || '').trim();
  if (attr === 'html') return t.innerHTML || '';
  if (attr === 'ownText') return ownTextOf(t);
  if (attr === 'textNodes') return ownTextOf(t);
  return t.getAttribute(attr) || t.getAttribute('data-' + attr) || '';
}
function applyPurify(v, segs) {
  let s = String(v);
  for (let i = 0; i < segs.length; i += 2) {
    const pat = segs[i];
    const rep = segs[i + 1] || '';
    if (!pat) continue;
    try { s = s.replace(new RegExp(pat, 'g'), rep); } catch (e) { s = s.split(pat).join(rep); }
  }
  return s;
}
function pickOne(el, rule, defaultAttr) {
  if (!rule) return '';
  const alts = normRule(rule).split('||');
  for (let alt of alts) {
    alt = alt.trim();
    if (!alt) continue;
    const hash = alt.split('##');
    alt = hash[0].trim();
    const psegs = hash.slice(1);
    const ai = alt.lastIndexOf('@');
    const tail = ai >= 0 ? alt.slice(ai + 1).trim() : '';
    let chain = alt, attr = defaultAttr || 'text';
    if (ai > 0 && (RULE_ATTRS.includes(tail) || tail.startsWith('data-'))) { chain = alt.slice(0, ai); attr = tail; }
    else if (ai === 0) { chain = ''; attr = tail || attr; }
    const els = chain ? selectChain(el, chain) : [el];
    if (!els.length) continue;
    const v = applyPurify(extractAttr(els[0], attr), psegs);
    if (v) return String(v).trim();
  }
  return '';
}
function pickAll(el, rule, defaultAttr) {
  if (!rule) return [];
  const hash = normRule(rule).split('##');
  const body = hash[0].trim();
  const psegs = hash.slice(1);
  const ai = body.lastIndexOf('@');
  const tail = ai >= 0 ? body.slice(ai + 1).trim() : '';
  let chain = body, attr = defaultAttr || 'text';
  if (ai > 0 && (RULE_ATTRS.includes(tail) || tail.startsWith('data-'))) { chain = body.slice(0, ai); attr = tail; }
  return selectChain(el, chain).map((t) => applyPurify(extractAttr(t, attr), psegs).trim()).filter(Boolean);
}
async function fetchDoc(url, opts, fill) {
  opts = opts || {};
  const method = String(opts.method || 'GET').toUpperCase();
  const body = opts.body ? (fill ? fill(opts.body) : opts.body) : null;
  const headers = reqHeaders();
  let html;
  if (method === 'POST' || body || opts.charset) {
    const r = await legado.http.request(url, { method: body ? 'POST' : method, body: body, headers: headers, charset: opts.charset || '' });
    html = r.body;
  } else {
    html = await legado.http.get(url, headers);
  }
  return { doc: legado.dom.parse(html), html };
}
/* v3.1：封面/插图统一走中转并带 referer，规避书源站防盗链 */
function covUrl(u, ref) {
  if (!u || u.indexOf('data:') === 0) return u || '';
  return legado.proxyUrl(u, { referer: ref });
}
/* 正文 HTML 后处理：相对地址转绝对、插图统一中转（保留 <img>，支持有插图的小说） */
function fixContentHtml(html, pageUrl) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('img').forEach((im) => {
    const raw = im.getAttribute('src') || im.getAttribute('data-src') || im.getAttribute('data-original') || '';
    const au = absUrl(raw, pageUrl);
    if (au) im.setAttribute('src', covUrl(au, pageUrl));
    im.removeAttribute('data-src');
    im.removeAttribute('data-original');
    im.setAttribute('style', 'max-width:100%;height:auto');
  });
  return tmp.innerHTML;
}

async function search(keyword, page) {
  if (!SRC.searchUrl) return [];
  const enc = legado.urlEncode(keyword);
  /* v3.5：搜索地址可带 '##{json}' 后缀声明 POST/编码：search.php##{"method":"POST","body":"q={{key}}","charset":"gbk"} */
  let su = SRC.searchUrl;
  let opts = {};
  const hm = su.match(/##(\{[\s\S]*\})$/);
  if (hm) { su = su.slice(0, hm.index); try { opts = JSON.parse(hm[1]); } catch (e) {} }
  const fill = (x) => String(x || '').replace('{{key}}', enc).replace('{{keyword}}', enc).replace('{{page}}', String(page || 1));
  const url = absUrl(fill(su), SRC.url.replace(/\\/$/, '') + '/');
  const { doc } = await fetchDoc(url, opts, fill);
  const rows = selectChain(doc, SRC.search.list || 'div').slice(0, 50);
  const out = [];
  for (const row of rows) {
    const name = pickOne(row, SRC.search.name);
    const bookUrl = absUrl(pickOne(row, SRC.search.bookUrl), url);
    if (!name || !bookUrl) continue;
    out.push({
      name,
      author: pickOne(row, SRC.search.author),
      coverUrl: covUrl(absUrl(pickOne(row, SRC.search.cover), url), url),
      bookUrl,
      intro: pickOne(row, SRC.search.intro),
      kind: pickOne(row, SRC.search.kind),
      type: SRC.type,
    });
  }
  return out;
}

async function bookInfo(bookUrl) {
  const { doc } = await fetchDoc(bookUrl);
  const I = SRC.info;
  return {
    name: pickOne(doc, I.name) || '',
    author: pickOne(doc, I.author),
    coverUrl: covUrl(absUrl(pickOne(doc, I.cover), bookUrl), bookUrl),
    intro: pickOne(doc, I.intro),
    kind: pickOne(doc, I.kind),
    lastUpdate: pickOne(doc, I.lastUpdate),
  };
}

async function chapterList(bookUrl) {
  const list = [];
  let url = bookUrl;
  /* v3.5：目录在独立页面时（ruleBookInfo.tocUrl）先解析目录页地址 */
  if (SRC.toc.tocUrl) {
    try {
      const r0 = await fetchDoc(bookUrl);
      const tu = absUrl(pickOne(r0.doc, SRC.toc.tocUrl), bookUrl);
      if (tu) url = tu;
    } catch (e) {}
  }
  for (let depth = 0; depth < 4 && url; depth++) {
    const { doc } = await fetchDoc(url);
    const rows = selectChain(doc, SRC.toc.list || 'a');
    let next = '';
    if (SRC.toc.next) next = absUrl(pickOne(doc, SRC.toc.next), url);
    rows.forEach((row) => {
      const name = pickOne(row, SRC.toc.name) || (row.textContent || '').trim();
      const cu = absUrl(pickOne(row, SRC.toc.url) || row.getAttribute('href') || '', url);
      if (name && cu) list.push({ name, url: cu, vip: false });
    });
    if (!next || next === url) break;
    url = next;
  }
  return list;
}

async function chapterContent(chapterUrl) {
  if (SRC.type === 'comic') {
    /* 漫画：收集全部图片地址，返回 {images:[...]}（漫画阅读器约定格式） */
    const images = [];
    let url = chapterUrl;
    for (let depth = 0; depth < 5 && url; depth++) {
      const { doc } = await fetchDoc(url);
      pickAll(doc, SRC.content.rule, 'src').forEach((u) => {
        const au = absUrl(u, url);
        if (/^https?:\\/\\//i.test(au)) images.push(au);
      });
      let next = '';
      if (SRC.content.next) next = absUrl(pickOne(doc, SRC.content.next), url);
      if (!next || next === url) break;
      url = next;
    }
    return JSON.stringify({ images });
  }
  /* 小说：正文 HTML，支持分页正文拼接与广告过滤 */
  const parts = [];
  let url = chapterUrl;
  for (let depth = 0; depth < 5 && url; depth++) {
    const { doc } = await fetchDoc(url);
    parts.push(fixContentHtml(pickOne(doc, SRC.content.rule, 'html'), url));
    let next = '';
    if (SRC.content.next) next = absUrl(pickOne(doc, SRC.content.next), url);
    if (!next || next === url) break;
    url = next;
  }
  let text = parts.join('\\n');
  (SRC.content.filter || []).forEach((bad) => {
    try { text = text.replace(new RegExp(bad, 'gi'), ''); } catch (e) {}
  });
  (SRC.content.replace || []).forEach((rr) => {
    const ps = String(rr).split('##');
    try { text = text.replace(new RegExp(ps[0], 'gi'), ps.length > 1 ? ps[1] : ''); } catch (e) {}
  });
  return text || '<p>未找到正文内容</p>';
}
`;
}

/* ---------- 对外：文本 → 连接器代码数组 ---------- */
export function legadoToJsSources(text) {
  const j = JSON.parse(String(text).trim());
  const arr = Array.isArray(j) ? j : [j];
  return arr
    .filter((it) => it && it.bookSourceUrl && it.searchUrl && it.enabled !== false)
    .map((it) => rulesToCode(legadoRules(it)));
}

export function basicToJsSources(text) {
  const j = JSON.parse(String(text).trim());
  const arr = Array.isArray(j) ? j : [j];
  return arr
    .filter((it) => it && it.name && it.url && it.searchUrl)
    .map((it) => rulesToCode(basicRules(it)));
}

/* v2.9：旧版适配器生成的连接器代码存在用户本地库中，规则引擎 bug 也一起被存了下来。
   这里从旧代码里提取内嵌的 SRC 规则 JSON，用新版引擎重新生成代码（返回 null 表示无需升级）。 */
const NEW_ENGINE_MARK = '规则引擎（v3.0';
export function regenLegacyCode(code) {
  const text = String(code || '');
  if (!text.includes('const SRC = ')) return null;      // 不是适配器生成的连接器
  if (text.includes(NEW_ENGINE_MARK)) return null;      // 已是新版引擎
  const m = text.match(/const SRC = (\{[\s\S]*?\});\n/);
  if (!m) return null;
  let R = null;
  try { R = JSON.parse(m[1]); } catch (e) { return null; }
  if (!R || !R.name || !R.url) return null;
  return rulesToCode(R);
}
