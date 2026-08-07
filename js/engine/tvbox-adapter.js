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
  return (j.sites || []).filter((s) => s.api && s.name).map((s) => ({
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

async function search(keyword, page) {
  const url = API + (API.includes('?') ? '&' : '?') + 'ac=videolist&wd=' + legado.urlEncode(keyword) + '&pg=' + page;
  const text = await legado.http.get(url);
  const j = JSON.parse(text);
  return (j.list || []).map(v => ({
    name: v.vod_name,
    author: v.vod_actor || '',
    coverUrl: v.vod_pic || '',
    bookUrl: String(v.vod_id),
    intro: (v.vod_content || '').replace(/<[^>]+>/g, ''),
    type: 'video',
  }));
}

async function bookInfo(bookUrl) {
  const url = API + (API.includes('?') ? '&' : '?') + 'ac=detail&ids=' + bookUrl;
  const j = JSON.parse(await legado.http.get(url));
  const v = (j.list || [])[0] || {};
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
  const v = (j.list || [])[0] || {};
  const from = (v.vod_play_from || '默认').split('$$$');
  const urls = (v.vod_play_url || '').split('$$$');
  const chapters = [];
  urls.forEach((line, li) => {
    (line || '').split('#').forEach((ep) => {
      const parts = ep.split('$');
      if (parts.length >= 2) {
        chapters.push({ name: (from[li] ? '[' + from[li] + '] ' : '') + parts[0], url: parts[1], vip: false });
      }
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
