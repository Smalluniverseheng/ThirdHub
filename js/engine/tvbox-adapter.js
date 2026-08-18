/* ===== ThirdHub js/engine/tvbox-adapter.js — TVbox JSON 源适配器 =====
   将 TVbox 格式视频源转换为统一连接器接口（内存中生成 JS 代码，不落盘） */
import { httpGet } from './proxy.js';

export function isTvboxConfig(text) {
  try {
    const j = JSON.parse(text);
    return !!(j && (j.sites || j.spider));
  } catch (e) { return false; }
}

export async function loadTvboxSites(text) {
  const j = JSON.parse(text);
  /* v3.8：只收 http(s) 接口站点（csp_* 等依赖 App 内置爬虫的站点无法适配，直接跳过） */
  return (j.sites || []).filter((s) => s.api && s.name && /^https?:\/\//i.test(String(s.api))).map((s) => ({
    key: s.key || s.name,
    name: s.name,
    api: s.api,
    searchable: s.searchable !== 0,
  }));
}

/* 生成等效 JS 连接器代码 */
export function tvboxToJsSource(site) {
  const api = site.api.replace(/'/g, "\\'");
  return `// @name        ${site.name}
// @version     1.0
// @author      TVbox 适配
// @url         ${site.api}
// @type        video
// @enabled     true

const API = '${api}';

function pickList(j) {
  if (!j) return [];
  if (Array.isArray(j.list)) return j.list;
  if (j.data && Array.isArray(j.data.list)) return j.data.list;
  return [];
}

async function search(keyword, page) {
  /* v3.8：部分苹果CMS站点只在 ac=list / ac=detail 下支持搜索，逐个尝试 */
  const acs = ['videolist', 'list', 'detail'];
  for (const ac of acs) {
    try {
      const url = API + (API.includes('?') ? '&' : '?') + 'ac=' + ac + '&wd=' + legado.urlEncode(keyword) + '&pg=' + page;
      const j = JSON.parse(await legado.http.get(url));
      const list = pickList(j);
      if (list.length) return list.map(v => ({
        name: v.vod_name,
        author: v.vod_actor || '',
        coverUrl: v.vod_pic || '',
        bookUrl: String(v.vod_id),
        intro: (v.vod_content || '').replace(/<[^>]+>/g, ''),
        type: 'video',
      }));
    } catch (e) {}
  }
  return [];
}

async function bookInfo(bookUrl) {
  const url = API + (API.includes('?') ? '&' : '?') + 'ac=detail&ids=' + bookUrl;
  const j = JSON.parse(await legado.http.get(url));
  const v = pickList(j)[0] || {};
  return {
    name: v.vod_name,
    author: v.vod_actor || '',
    coverUrl: v.vod_pic || '',
    intro: (v.vod_content || '').replace(/<[^>]+>/g, ''),
    lastUpdate: v.vod_time || '',
    _raw: { playFrom: (v.vod_play_from || '').split('$$$'), playUrl: (v.vod_play_url || '').split('$$$') },
  };
}

async function chapterList(bookUrl) {
  const url = API + (API.includes('?') ? '&' : '?') + 'ac=detail&ids=' + bookUrl;
  const j = JSON.parse(await legado.http.get(url));
  const v = pickList(j)[0] || {};
  const from = (v.vod_play_from || '默认').split('$$$');
  const urls = (v.vod_play_url || '').split('$$$');
  const chapters = [];
  urls.forEach((line, li) => {
    let epNo = 0;
    (line || '').split('#').forEach((ep) => {
      ep = (ep || '').trim();
      if (!ep) return;
      epNo++;
      /* v3.8：兼容没有「名称$地址」分隔、只有裸地址的站点 */
      const parts = ep.split('$');
      let name, u;
      if (parts.length >= 2 && /^https?:/i.test(parts[parts.length - 1])) {
        u = parts[parts.length - 1];
        name = parts.slice(0, -1).join('$') || ('第' + epNo + '集');
      } else if (/^https?:/i.test(ep)) {
        u = ep; name = '第' + epNo + '集';
      } else return;
      chapters.push({ name: (from[li] ? '[' + from[li] + '] ' : '') + name, url: u, vip: false });
    });
  });
  return chapters;
}

async function chapterContent(chapterUrl) {
  return JSON.stringify({ title: '', urls: [{ name: '线路1', url: chapterUrl }] });
}
`;
}

export { httpGet };
