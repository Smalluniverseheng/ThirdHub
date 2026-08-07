/* ===== ThirdHub js/ai/ai-pricing.js — 各厂商刊例价与花费估算（USD / 1M tokens） =====
   价格为各厂商公开刊例价的约值（输入 / 输出 / 缓存命中输入），仅供预算参考；
   实际以厂商账单为准。缓存命中未单独定价的按输入价 25% 估算。 */
import { kvGet, kvSet } from '../store.js';

export const MODEL_PRICES = {
  /* OpenAI */
  'openai/gpt-5': { in: 1.25, out: 10, cache: 0.125 },
  'openai/gpt-5-mini': { in: 0.25, out: 2, cache: 0.025 },
  'openai/gpt-5-nano': { in: 0.05, out: 0.4, cache: 0.005 },
  'openai/gpt-4o': { in: 2.5, out: 10, cache: 1.25 },
  'openai/gpt-4o-mini': { in: 0.15, out: 0.6, cache: 0.075 },
  'openai/gpt-4.1': { in: 2, out: 8, cache: 0.5 },
  'openai/gpt-4.1-mini': { in: 0.4, out: 1.6, cache: 0.1 },
  'openai/gpt-4.1-nano': { in: 0.1, out: 0.4, cache: 0.025 },
  'openai/o3': { in: 2, out: 8, cache: 0.5 },
  'openai/o4-mini': { in: 1.1, out: 4.4, cache: 0.275 },
  /* Anthropic */
  'anthropic/claude-opus-4-1': { in: 15, out: 75, cache: 1.5 },
  'anthropic/claude-opus-4': { in: 15, out: 75, cache: 1.5 },
  'anthropic/claude-sonnet-4-5': { in: 3, out: 15, cache: 0.3 },
  'anthropic/claude-sonnet-4': { in: 3, out: 15, cache: 0.3 },
  'anthropic/claude-haiku-4-5': { in: 1, out: 5, cache: 0.1 },
  /* Google */
  'google/gemini-3-pro-preview': { in: 2, out: 12, cache: 0.2 },
  'google/gemini-2.5-pro': { in: 1.25, out: 10, cache: 0.31 },
  'google/gemini-2.5-flash': { in: 0.3, out: 2.5, cache: 0.075 },
  'google/gemini-2.5-flash-lite': { in: 0.1, out: 0.4, cache: 0.025 },
  'google/gemini-2.0-flash': { in: 0.1, out: 0.4, cache: 0.025 },
  'google/gemini-2.0-flash-lite': { in: 0.075, out: 0.3, cache: 0.019 },
  /* xAI */
  'xai/grok-4-1-fast-reasoning': { in: 0.2, out: 0.5, cache: 0.05 },
  'xai/grok-4-1-fast-non-reasoning': { in: 0.2, out: 0.5, cache: 0.05 },
  'xai/grok-4': { in: 3, out: 15, cache: 0.75 },
  'xai/grok-4-fast': { in: 0.2, out: 0.5, cache: 0.05 },
  'xai/grok-3': { in: 3, out: 15, cache: 0.75 },
  'xai/grok-3-mini': { in: 0.3, out: 0.5, cache: 0.075 },
  /* DeepSeek（ off-peak 更低，此处取标准价 ） */
  'deepseek/deepseek-chat': { in: 0.27, out: 1.1, cache: 0.07 },
  'deepseek/deepseek-reasoner': { in: 0.55, out: 2.19, cache: 0.14 },
  /* 小米 MiMo */
  'xiaomi/mimo-v2.5-pro': { in: 0.55, out: 2.2, cache: 0.14 },
  'xiaomi/mimo-v2.5': { in: 0.27, out: 1.1, cache: 0.07 },
  'xiaomi/mimo-v2-flash': { in: 0.1, out: 0.4, cache: 0.025 },
  'xiaomi/mimo-v2-pro': { in: 0.4, out: 1.6, cache: 0.1 },
  'xiaomi/mimo-v2-omni': { in: 0.55, out: 2.2, cache: 0.14 },
  /* 阿里 通义 */
  'aliyun/qwen3-max': { in: 0.86, out: 3.45, cache: 0.17 },
  'aliyun/qwen3-coder-plus': { in: 0.86, out: 3.45, cache: 0.17 },
  'aliyun/qwen3-coder-flash': { in: 0.3, out: 1.2, cache: 0.06 },
  'aliyun/qwen-plus': { in: 0.4, out: 1.2, cache: 0.08 },
  'aliyun/qwen-turbo': { in: 0.05, out: 0.2, cache: 0.01 },
  'aliyun/qwen-long': { in: 0.05, out: 0.2, cache: 0.01 },
  'aliyun/qwen3-235b-a22b': { in: 0.7, out: 2.8, cache: 0.14 },
  'aliyun/qwen3-32b': { in: 0.2, out: 0.6, cache: 0.04 },
  'aliyun/qwen3-14b': { in: 0.15, out: 0.45, cache: 0.03 },
  'aliyun/qwen3-8b': { in: 0.1, out: 0.3, cache: 0.02 },
  'aliyun/qwen-vl-max': { in: 0.4, out: 1.2, cache: 0.08 },
  'aliyun/qwen-vl-plus': { in: 0.2, out: 0.6, cache: 0.04 },
  'aliyun/qwq-32b': { in: 0.2, out: 0.6, cache: 0.04 },
  /* 腾讯混元 */
  'tencent/hunyuan-t1-latest': { in: 0.55, out: 2.2, cache: 0.14 },
  'tencent/hunyuan-turbos-latest': { in: 0.55, out: 2.2, cache: 0.14 },
  'tencent/hunyuan-turbo': { in: 0.4, out: 1.6, cache: 0.1 },
  'tencent/hunyuan-pro': { in: 0.86, out: 3.45, cache: 0.17 },
  /* 百度文心 */
  'baidu/ernie-4.5-turbo-128k': { in: 0.4, out: 1.6, cache: 0.1 },
  'baidu/ernie-4.5-8k-preview': { in: 0.4, out: 1.6, cache: 0.1 },
  'baidu/ernie-x1-turbo-32k': { in: 0.55, out: 2.2, cache: 0.14 },
  'baidu/ernie-4.0-8k': { in: 0.86, out: 3.45, cache: 0.17 },
  'baidu/ernie-3.5-8k': { in: 0.3, out: 1.2, cache: 0.06 },
  /* 字节豆包 */
  'bytedance/doubao-seed-1-6': { in: 0.27, out: 1.1, cache: 0.07 },
  'bytedance/doubao-seed-1-6-flash': { in: 0.07, out: 0.3, cache: 0.018 },
  'bytedance/doubao-seed-1-6-thinking': { in: 0.27, out: 1.1, cache: 0.07 },
  'bytedance/doubao-1.5-pro-32k': { in: 0.11, out: 0.3, cache: 0.028 },
  'bytedance/doubao-1.5-pro-256k': { in: 0.7, out: 1.3, cache: 0.18 },
  'bytedance/doubao-1.5-lite-32k': { in: 0.04, out: 0.08, cache: 0.01 },
  'bytedance/deepseek-r1-250528': { in: 0.55, out: 2.19, cache: 0.14 },
  'bytedance/deepseek-v3-250324': { in: 0.27, out: 1.1, cache: 0.07 },
  /* Kimi */
  'moonshot/kimi-k2-thinking': { in: 0.55, out: 2.2, cache: 0.14 },
  'moonshot/kimi-k2-thinking-turbo': { in: 0.8, out: 3.2, cache: 0.2 },
  'moonshot/kimi-k2-0905-preview': { in: 0.55, out: 2.2, cache: 0.14 },
  'moonshot/kimi-latest': { in: 0.27, out: 1.1, cache: 0.07 },
  'moonshot/moonshot-v1-auto': { in: 0.27, out: 1.1, cache: 0.07 },
  'moonshot/moonshot-v1-8k': { in: 0.17, out: 0.55, cache: 0.043 },
  'moonshot/moonshot-v1-32k': { in: 0.34, out: 1.1, cache: 0.085 },
  'moonshot/moonshot-v1-128k': { in: 0.86, out: 2.75, cache: 0.22 },
  /* 智谱 */
  'zhipu/glm-4.6': { in: 0.55, out: 2.2, cache: 0.11 },
  'zhipu/glm-4.5': { in: 0.4, out: 1.6, cache: 0.08 },
  'zhipu/glm-4.5-air': { in: 0.14, out: 0.55, cache: 0.028 },
  'zhipu/glm-4-plus': { in: 0.7, out: 2.8, cache: 0.14 },
  'zhipu/glm-4-air': { in: 0.07, out: 0.14, cache: 0.014 },
  'zhipu/glm-4-flash': { in: 0, out: 0, cache: 0 },
  'zhipu/glm-z1-air': { in: 0.07, out: 0.14, cache: 0.014 },
  /* MiniMax */
  'minimax/MiniMax-M2': { in: 0.3, out: 1.2, cache: 0.06 },
  'minimax/MiniMax-M1': { in: 0.4, out: 2.2, cache: 0.08 },
  'minimax/MiniMax-Text-01': { in: 0.2, out: 1.1, cache: 0.04 },
  /* Mistral */
  'mistral/mistral-large-latest': { in: 2, out: 6, cache: 0.5 },
  'mistral/mistral-medium-latest': { in: 0.4, out: 2, cache: 0.1 },
  'mistral/mistral-small-latest': { in: 0.1, out: 0.3, cache: 0.025 },
  'mistral/codestral-latest': { in: 0.3, out: 0.9, cache: 0.075 },
  'mistral/pixtral-large-latest': { in: 2, out: 6, cache: 0.5 },
  /* Perplexity */
  'perplexity/sonar': { in: 1, out: 1, cache: 0.25 },
  'perplexity/sonar-pro': { in: 3, out: 15, cache: 0.75 },
  'perplexity/sonar-reasoning': { in: 1, out: 5, cache: 0.25 },
  'perplexity/sonar-reasoning-pro': { in: 2, out: 8, cache: 0.5 },
  /* Groq（按刊例） */
  'groq/llama-3.3-70b-versatile': { in: 0.59, out: 0.79, cache: 0.15 },
  'groq/llama-3.1-8b-instant': { in: 0.05, out: 0.08, cache: 0.013 },
  'groq/deepseek-r1-distill-llama-70b': { in: 0.75, out: 0.99, cache: 0.19 },
  /* 其他国产 */
  'yi/yi-lightning': { in: 0.14, out: 0.14, cache: 0.035 },
  'yi/yi-large': { in: 0.86, out: 2.75, cache: 0.22 },
  'baichuan/Baichuan4': { in: 0.86, out: 2.75, cache: 0.22 },
  'stepfun/step-2-16k': { in: 0.55, out: 2.2, cache: 0.14 },
  'stepfun/step-1-8k': { in: 0.07, out: 0.28, cache: 0.018 },
  'spark/4.0Ultra': { in: 0.86, out: 2.75, cache: 0.22 },
  'spark/generalv3.5': { in: 0.4, out: 1.6, cache: 0.1 },
  'sensechat/SenseChat-5': { in: 0.4, out: 1.6, cache: 0.1 },
};

/* ===== v1.9：云端定价覆盖层（管理员后台维护，th_model_prices 表） =====
   云端价格优先于内置价目；键可以是「厂商/模型」或裸模型名；单位 USD / 1M tokens。
   本地缓存 6 小时内直接使用，离线也有上次的价格。 */
let CLOUD_PRICES = {};

export async function initPricing() {
  try {
    const c = await kvGet('price:cloud', null);
    if (c && c.map) CLOUD_PRICES = c.map;
  } catch (e) {}
}

export async function syncCloudPrices() {
  try {
    const { getSupabase, hasCloud } = await import('../supabase.js');
    if (!hasCloud()) return;
    const { data, error } = await getSupabase().from('th_model_prices').select('*');
    if (error || !data) return;
    const map = {};
    data.forEach((r) => { map[r.model] = { in: Number(r.input_price) || 0, out: Number(r.output_price) || 0 }; });
    CLOUD_PRICES = map;
    await kvSet('price:cloud', { at: Date.now(), map });
  } catch (e) {}
}

function cloudPriceOf(providerId, model) {
  if (!Object.keys(CLOUD_PRICES).length) return null;
  const key = providerId + '/' + model;
  if (CLOUD_PRICES[key]) return CLOUD_PRICES[key];
  if (CLOUD_PRICES[model]) return CLOUD_PRICES[model];
  // 云端前缀最长匹配
  let best = null, bestLen = 0;
  for (const k of Object.keys(CLOUD_PRICES)) {
    const slash = k.indexOf('/');
    const pm = slash >= 0 && k.slice(0, slash) === providerId ? k.slice(slash + 1) : k;
    if (model.startsWith(pm) && pm.length > bestLen) { best = CLOUD_PRICES[k]; bestLen = pm.length; }
  }
  return best;
}

/* 前缀模糊匹配价格（如同族小版本号差异）；云端价目优先 */
export function priceOf(providerId, model) {
  const cp = cloudPriceOf(providerId, model);
  if (cp) return cp;
  const key = providerId + '/' + model;
  if (MODEL_PRICES[key]) return MODEL_PRICES[key];
  // 同厂商内前缀最长匹配
  let best = null, bestLen = 0;
  for (const k of Object.keys(MODEL_PRICES)) {
    const slash = k.indexOf('/');
    if (k.slice(0, slash) !== providerId) continue;
    const pm = k.slice(slash + 1);
    if (model.startsWith(pm) && pm.length > bestLen) { best = MODEL_PRICES[k]; bestLen = pm.length; }
  }
  return best;
}

/* 估算单次对话花费（USD）。usage 支持 cache_hit_tokens / prompt_tokens_details.cached_tokens */
export function estimateCost(providerId, model, usage) {
  if (!usage) return null;
  const price = priceOf(providerId, model);
  if (!price) return null;
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  const cacheHit = usage.cache_hit_tokens || (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
  const fresh = Math.max(0, prompt - cacheHit);
  const cacheRate = price.cache != null ? price.cache : price.in * 0.25;
  return (fresh * price.in + cacheHit * cacheRate + completion * price.out) / 1e6;
}

/* USD → CNY 实时汇率（6 小时缓存，失败回退 7.2） */
export async function usdToCnyRate() {
  const cached = await kvGet('fx:usd-cny', null);
  if (cached && Date.now() - cached.at < 6 * 3600 * 1000) return cached.rate;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    const rate = j && j.rates && j.rates.CNY;
    if (rate) {
      await kvSet('fx:usd-cny', { at: Date.now(), rate });
      return rate;
    }
  } catch (e) {}
  return cached ? cached.rate : 7.2;
}

export function fmtUsd(n) {
  if (n == null) return '—';
  if (n >= 100) return '$' + n.toFixed(0);
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}
