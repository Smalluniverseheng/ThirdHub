/* ===== ThirdHub js/engine/local-source.js — 本地书籍（TXT/EPUB 导入） ===== */
import { db } from '../store.js';
import { uid } from '../ui.js';

export const LOCAL_SOURCE = { id: 'local', name: '本地导入', type: 'novel', code: '', version: '1.0' };

let jszipLoader = null;
async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  if (!jszipLoader) {
    jszipLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js';
      s.onload = () => resolve(window.JSZip);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return jszipLoader;
}

/* 智能解码：UTF-8 优先，失败回退 GBK */
async function decodeText(buf) {
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return t;
  } catch (e) {
    try { return new TextDecoder('gbk').decode(buf); } catch (e2) { return new TextDecoder('utf-8').decode(buf); }
  }
}

/* TXT 章节切分 */
function splitTxtChapters(text) {
  const re = /^\s*(第[\d零一二三四五六七八九十百千]{1,10}[章节回卷部篇][^\n]{0,40}|序章|序|楔子|尾声|番外[^\n]{0,30})\s*$/gm;
  const matches = [...text.matchAll(re)];
  if (matches.length < 3) {
    // 无明显章节：按 ~40KB 分块
    const chunks = [];
    const size = 40000;
    for (let i = 0; i < text.length; i += size) {
      chunks.push({ name: `第 ${chunks.length + 1} 节`, content: text.slice(i, i + size) });
    }
    return chunks;
  }
  const chapters = [];
  if (matches[0].index > 200) chapters.push({ name: '卷首', content: text.slice(0, matches[0].index) });
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    chapters.push({ name: matches[i][1].trim(), content: text.slice(start + matches[i][0].length, end) });
  }
  return chapters;
}

/* EPUB 解析 */
async function parseEpub(buf) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(buf);
  // 找 OPF
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('不是有效的 EPUB 文件');
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB 缺少 OPF 索引');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfDoc = new DOMParser().parseFromString(await zip.file(opfPath).async('text'), 'application/xml');
  const title = opfDoc.querySelector('title')?.textContent || '未命名';
  const author = opfDoc.querySelector('creator')?.textContent || '';
  // manifest id → href
  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach((it) => { manifest[it.getAttribute('id')] = it.getAttribute('href'); });
  const chapters = [];
  const spine = [...opfDoc.querySelectorAll('spine itemref')];
  for (let i = 0; i < spine.length; i++) {
    const href = manifest[spine[i].getAttribute('idref')];
    if (!href) continue;
    const file = zip.file(opfDir + href) || zip.file(decodeURIComponent(opfDir + href));
    if (!file) continue;
    const html = await file.async('text');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style').forEach((n) => n.remove());
    const h = doc.querySelector('h1,h2,h3,title');
    const text = (doc.body ? doc.body.innerText : '').trim();
    if (text.length > 10) chapters.push({ name: (h ? h.textContent.trim() : '') || `第 ${chapters.length + 1} 章`, content: text });
  }
  if (!chapters.length) throw new Error('EPUB 内容为空');
  return { title, author, chapters };
}

/* 导入入口 */
export async function importLocalBook(file) {
  const buf = await file.arrayBuffer();
  const isEpub = /\.epub$/i.test(file.name);
  let title, author = '', chapters;
  if (isEpub) {
    const parsed = await parseEpub(buf);
    title = parsed.title; author = parsed.author; chapters = parsed.chapters;
  } else {
    const text = await decodeText(buf);
    if (!text.trim()) throw new Error('文件内容为空');
    title = file.name.replace(/\.\w+$/, '');
    chapters = splitTxtChapters(text);
  }
  const bookId = 'lb-' + uid();
  await db.put('cache', {
    k: 'localbook:' + bookId,
    v: { title, author, chapters, fileName: file.name },
    ts: Date.now(),
  });
  return {
    id: 'local:' + bookId,
    sourceId: 'local',
    type: 'novel',
    title, author,
    coverUrl: '',
    bookUrl: bookId,
    sourceName: '本地导入',
    addedAt: Date.now(),
    top: false,
  };
}

/* 本地书读取（供 content-service 路由） */
export async function getLocalBook(bookUrl) {
  const row = await db.get('cache', 'localbook:' + bookUrl.replace('local:', ''));
  if (!row) throw new Error('本地书籍不存在（可能已被清理缓存删除）');
  return row.v;
}
export async function localBookInfo(bookUrl) {
  const book = await getLocalBook(bookUrl);
  return { name: book.title, author: book.author || '', intro: '本地文件：' + (book.fileName || '未知文件'), lastUpdate: '' };
}
export async function localChapterList(bookUrl) {
  const book = await getLocalBook(bookUrl);
  return book.chapters.map((c, i) => ({ name: c.name, url: bookUrl + '#' + i, index: i }));
}
export async function localChapterContent(chapterUrl) {
  const hash = chapterUrl.lastIndexOf('#');
  const bookUrl = hash > -1 ? chapterUrl.slice(0, hash) : chapterUrl;
  const i = parseInt(hash > -1 ? chapterUrl.slice(hash + 1) : chapterUrl, 10);
  const book = await getLocalBook(bookUrl);
  if (!book.chapters[i]) throw new Error('章节不存在');
  return book.chapters[i].content;
}
export async function deleteLocalBook(bookUrl) {
  await db.del('cache', 'localbook:' + bookUrl.replace('local:', ''));
}
