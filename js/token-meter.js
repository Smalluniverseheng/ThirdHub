/* ===== ThirdHub js/token-meter.js — Token 用量 / 缓存命中 / 花费估算统计（v1.5） ===== */
import { kvGet, kvSet, emit } from './store.js';
import { estimateCost } from './ai/ai-pricing.js';

let sessionStats = { prompt: 0, completion: 0, requests: 0, cacheHit: 0, cost: 0 };

export function recordUsage(providerId, model, usage, ms = 0) {
  if (!usage) return;
  const cacheHit = usage.cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
  const cost = estimateCost(providerId, model, usage) || 0;

  sessionStats.prompt += usage.prompt_tokens || 0;
  sessionStats.completion += usage.completion_tokens || 0;
  sessionStats.requests += 1;
  sessionStats.cacheHit += cacheHit;
  sessionStats.cost += cost;
  emit('token:update', { ...sessionStats });

  // 累计持久化（异步，不阻塞）
  (async () => {
    const today = new Date().toISOString().slice(0, 10);
    const bump = (o) => {
      o.prompt += usage.prompt_tokens || 0;
      o.completion += usage.completion_tokens || 0;
      o.requests += 1;
      o.cacheHit = (o.cacheHit || 0) + cacheHit;
      o.cost = (o.cost || 0) + cost;
      return o;
    };
    const all = await kvGet('token:total', { prompt: 0, completion: 0, requests: 0, cacheHit: 0, cost: 0 });
    await kvSet('token:total', bump(all));

    const daily = await kvGet('token:daily', {});
    if (!daily[today]) daily[today] = { prompt: 0, completion: 0, requests: 0, cacheHit: 0, cost: 0 };
    bump(daily[today]);
    // 只保留最近 60 天
    const days = Object.keys(daily).sort().slice(-60);
    const trimmed = {};
    days.forEach((d) => (trimmed[d] = daily[d]));
    await kvSet('token:daily', trimmed);

    // 按模型统计
    const byModel = await kvGet('token:by-model', {});
    const key = providerId + '/' + model;
    if (!byModel[key]) byModel[key] = { prompt: 0, completion: 0, requests: 0, cacheHit: 0, cost: 0 };
    bump(byModel[key]);
    await kvSet('token:by-model', byModel);
  })().catch(() => {});
}

export function getSessionStats() { return { ...sessionStats }; }
export async function getTotalStats() { return await kvGet('token:total', { prompt: 0, completion: 0, requests: 0, cacheHit: 0, cost: 0 }); }
export async function getDailyStats() { return await kvGet('token:daily', {}); }
export async function getModelStats() { return await kvGet('token:by-model', {}); }

/* 花费估算汇总：{ usd, rows: [{key, prompt, completion, requests, cacheHit, cost, priced}] } */
export async function getCostBreakdown() {
  const byModel = await getModelStats();
  const rows = Object.entries(byModel).map(([key, v]) => ({
    key, ...v,
    cost: v.cost || 0,
    priced: !!estimateCost(key.split('/')[0], key.split('/').slice(1).join('/'), { prompt_tokens: 1, completion_tokens: 0 }),
  })).sort((a, b) => b.cost - a.cost);
  const usd = rows.reduce((n, r) => n + r.cost, 0);
  return { usd, rows };
}

export function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}
