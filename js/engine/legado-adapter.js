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
    },
    content: {
      rule: rc.content || (type === 'comic' ? 'img@src' : '#content@html'),
      next: rc.nextContentUrl || '',
      replace: rc.replaceRegex || '',
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
/* 规则求值：'css@attr'，多条备用 '||' 分隔；attr 支持 text/href/src/html/data-src，缺省 text */
function pickOne(el, rule) {
  if (!rule) return '';
  const alts = String(rule).split('||');
  for (let alt of alts) {
    alt = alt.trim();
    if (!alt) continue;
    const ai = alt.lastIndexOf('@');
    const sel = ai > 0 ? alt.slice(0, ai).trim() : (ai === 0 ? '' : alt.trim());
    const attr = ai >= 0 ? alt.slice(ai + 1).trim() : 'text';
    const t = sel ? el.querySelector(sel) : el;
    if (!t) continue;
    let v = '';
    if (attr === 'text') v = (t.textContent || '').trim();
    else if (attr === 'html') v = t.innerHTML || '';
    else v = t.getAttribute(attr) || t.getAttribute('data-' + attr) || '';
    if (v) return String(v).trim();
  }
  return '';
}
function pickAll(el, rule) {
  if (!rule) return [];
  const ai = String(rule).lastIndexOf('@');
  const sel = ai > 0 ? String(rule).slice(0, ai).trim() : String(rule).trim();
  const attr = ai >= 0 ? String(rule).slice(ai + 1).trim() : 'text';
  return [...el.querySelectorAll(sel || 'a')].map((t) => {
    if (attr === 'text') return (t.textContent || '').trim();
    if (attr === 'html') return t.innerHTML || '';
    return t.getAttribute(attr) || t.getAttribute('data-' + attr) || '';
  }).filter(Boolean);
}
async function fetchDoc(url) {
  const html = await legado.http.get(url, reqHeaders());
  return { doc: legado.dom.parse(html), html };
}

async function search(keyword, page) {
  if (!SRC.searchUrl) return [];
  const su = SRC.searchUrl
    .replace('{{key}}', legado.urlEncode(keyword))
    .replace('{{keyword}}', legado.urlEncode(keyword))
    .replace('{{page}}', String(page || 1));
  const url = absUrl(su, SRC.url.replace(/\\/$/, '') + '/');
  const { doc } = await fetchDoc(url);
  const rows = [...doc.querySelectorAll(SRC.search.list || 'div')].slice(0, 30);
  const out = [];
  for (const row of rows) {
    const name = pickOne(row, SRC.search.name);
    const bookUrl = absUrl(pickOne(row, SRC.search.bookUrl), url);
    if (!name || !bookUrl) continue;
    out.push({
      name,
      author: pickOne(row, SRC.search.author),
      coverUrl: absUrl(pickOne(row, SRC.search.cover), url),
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
    coverUrl: absUrl(pickOne(doc, I.cover), bookUrl),
    intro: pickOne(doc, I.intro),
    kind: pickOne(doc, I.kind),
    lastUpdate: pickOne(doc, I.lastUpdate),
  };
}

async function chapterList(bookUrl) {
  const list = [];
  let url = bookUrl;
  for (let depth = 0; depth < 4 && url; depth++) {
    const { doc } = await fetchDoc(url);
    const rows = [...doc.querySelectorAll(SRC.toc.list || 'a')];
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
      pickAll(doc, SRC.content.rule).forEach((u) => {
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
    parts.push(pickOne(doc, SRC.content.rule) || '');
    let next = '';
    if (SRC.content.next) next = absUrl(pickOne(doc, SRC.content.next), url);
    if (!next || next === url) break;
    url = next;
  }
  let text = parts.join('\\n');
  (SRC.content.filter || []).forEach((bad) => {
    try { text = text.replace(new RegExp(bad, 'gi'), ''); } catch (e) {}
  });
  if (SRC.content.replace) {
    try { text = text.replace(new RegExp(SRC.content.replace, 'gi'), ''); } catch (e) {}
  }
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
