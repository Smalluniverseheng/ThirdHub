/* ===== ThirdHub js/token-meter.js — Token 用量实时统计 ===== */
import { kvGet, kvSet, emit } from './store.js';

let sessionStats = { prompt: 0, completion: 0, requests: 0 };

export function recordUsage(providerId, model, usage, ms = 0) {
  if (!usage) return;
  sessionStats.prompt += usage.prompt_tokens || 0;
  sessionStats.completion += usage.completion_tokens || 0;
  sessionStats.requests += 1;
  emit('token:update', { ...sessionStats });

  // 累计持久化（异步，不阻塞）
  (async () => {
    const today = new Date().toISOString().slice(0, 10);
    const all = await kvGet('token:total', { prompt: 0, completion: 0, requests: 0 });
    all.prompt += usage.prompt_tokens || 0;
    all.completion += usage.completion_tokens || 0;
    all.requests += 1;
    await kvSet('token:total', all);
    const daily = await kvGet('token:daily', {});
    if (!daily[today]) daily[today] = { prompt: 0, completion: 0, requests: 0 };
    daily[today].prompt += usage.prompt_tokens || 0;
    daily[today].completion += usage.completion_tokens || 0;
    daily[today].requests += 1;
    // 只保留最近 60 天
    const days = Object.keys(daily).sort().slice(-60);
    const trimmed = {};
    days.forEach((d) => (trimmed[d] = daily[d]));
    await kvSet('token:daily', trimmed);
    // 按模型统计
    const byModel = await kvGet('token:by-model', {});
    const key = providerId + '/' + model;
    if (!byModel[key]) byModel[key] = { prompt: 0, completion: 0, requests: 0 };
    byModel[key].prompt += usage.prompt_tokens || 0;
    byModel[key].completion += usage.completion_tokens || 0;
    byModel[key].requests += 1;
    await kvSet('token:by-model', byModel);
  })().catch(() => {});
}

export function getSessionStats() { return { ...sessionStats }; }
export async function getTotalStats() { return await kvGet('token:total', { prompt: 0, completion: 0, requests: 0 }); }
export async function getDailyStats() { return await kvGet('token:daily', {}); }
export async function getModelStats() { return await kvGet('token:by-model', {}); }
export function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}
