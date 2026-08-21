/* ===== ThirdHub js/ai/web-search.js — 内置联网搜索服务（v1.4） =====
   预置主流搜索 API，用户只需填入 Key 即可使用；
   对话页开启「联网搜索」后，先检索再把结果注入模型上下文。 */
import { kvGet, kvSet } from '../store.js';

export const SEARCH_SERVICES = [
  { id: 'tavily',  name: 'Tavily',            keyHint: 'tvly-...',            desc: '专为 AI 设计的搜索 API，每月有免费额度', needUrl: false, site: 'https://tavily.com', createUrl: 'https://app.tavily.com' },
  { id: 'brave',   name: 'Brave Search',      keyHint: 'BSA...',              desc: 'Brave 搜索引擎 API，免费额度 2000 次/月', needUrl: false, site: 'https://brave.com/search/api/', createUrl: 'https://brave.com/search/api/' },
  { id: 'serpapi', name: 'SerpAPI（Google）', keyHint: '一串十六进制 Key',     desc: 'Google 搜索结果 API',                    needUrl: false, site: 'https://serpapi.com', createUrl: 'https://serpapi.com/manage-api-key' },
  { id: 'searxng', name: 'SearXNG（自建）',   keyHint: '可留空',               desc: '自建搜索聚合引擎，填实例地址即可',       needUrl: true, site: 'https://docs.searxng.org', createUrl: '' },
  { id: 'exa',     name: 'Exa（AI 搜索）',   keyHint: 'exa_...',              desc: '专为 AI 构建的语义搜索 API，结果干净',    needUrl: false, site: 'https://exa.ai', createUrl: 'https://dashboard.exa.ai/api-keys' },
  { id: 'serper',  name: 'Serper（Google）', keyHint: '一串 Key',             desc: 'Google 搜索 API，单次查询低至 0.3 分',     needUrl: false, site: 'https://serper.dev', createUrl: 'https://serper.dev' },
  { id: 'bing',    name: 'Bing Web Search',  keyHint: 'Azure Key',            desc: '微软 Bing 网页搜索 API（Azure 资源）',      needUrl: false, site: 'https://www.microsoft.com/en-us/bing/apis/bing-web-search-api', createUrl: 'https://portal.azure.com/#create/Microsoft.BingSearch' },
  { id: 'perplexity', name: 'Perplexity（Sonar）', keyHint: 'pplx-...',       desc: 'AI 搜索模型，直接返回带引用的答案',        needUrl: false, site: 'https://www.perplexity.ai/settings/api', createUrl: 'https://www.perplexity.ai/settings/api' },
  { id: 'jina',    name: 'Jina Reader（免费）', keyHint: '可留空',            desc: '免费搜索 + 网页阅读，无需 Key',            needUrl: false, site: 'https://jina.ai', createUrl: 'https://jina.ai/reader' },
];

export async function getSearchConfig() {
  return {
    service: await kvGet('websearch:service', ''),
    key: await kvGet('websearch:key', ''),
    url: await kvGet('websearch:url', ''),
  };
}
export async function setSearchConfig(cfg) {
  await kvSet('websearch:service', cfg.service || '');
  await kvSet('websearch:key', (cfg.key || '').trim());
  await kvSet('websearch:url', (cfg.url || '').trim());
}
export async function hasSearchConfig() {
  const c = await getSearchConfig();
  return !!(c.service && (c.key || (c.service === 'searxng' && c.url)));
}

/* 统一搜索入口：返回 [{title, url, snippet}] */
export async function searchWeb(query, limit = 5) {
  const c = await getSearchConfig();
  if (!c.service) throw new Error('未配置联网搜索服务，请到「API 设置 → 联网搜索服务」配置');
  let items = [];
  if (c.service === 'tavily') {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: c.key, query, max_results: limit, search_depth: 'basic' }),
    });
    if (!r.ok) throw new Error('Tavily HTTP ' + r.status);
    const d = await r.json();
    items = (d.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  } else if (c.service === 'brave') {
    const r = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + limit, {
      headers: { 'X-Subscription-Token': c.key, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error('Brave HTTP ' + r.status);
    const d = await r.json();
    items = ((d.web && d.web.results) || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
  } else if (c.service === 'serpapi') {
    const r = await fetch('https://serpapi.com/search.json?engine=google&api_key=' + encodeURIComponent(c.key) + '&q=' + encodeURIComponent(query));
    if (!r.ok) throw new Error('SerpAPI HTTP ' + r.status);
    const d = await r.json();
    items = (d.organic_results || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet }));
  } else if (c.service === 'searxng') {
    const base = (c.url || '').replace(/\/$/, '');
    if (!base) throw new Error('请填写 SearXNG 实例地址');
    const r = await fetch(base + '/search?format=json&q=' + encodeURIComponent(query), {
      headers: c.key ? { Authorization: 'Bearer ' + c.key } : {},
    });
    if (!r.ok) throw new Error('SearXNG HTTP ' + r.status);
    const d = await r.json();
    items = (d.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  }
  return items.slice(0, limit).filter((x) => x.title || x.snippet);
}

/* 把搜索结果格式化为注入模型的上下文 */
export function resultsToContext(query, items) {
  const lines = items.map((x, i) => `[${i + 1}] ${x.title || ''}\n${x.snippet || ''}\n来源：${x.url || ''}`);
  return `以下是针对「${query}」的联网搜索结果，请结合搜索结果回答，并在引用处标注来源编号：\n\n${lines.join('\n\n')}`;
}
