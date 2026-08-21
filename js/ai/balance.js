/* ===== ThirdHub js/ai/balance.js — 模型控制台（v6.0） =====
   按厂商查询 API Key 余额 / 用量（参考 openai-billing 等开源方案的端点适配） */
import { getApiKey } from './ai-api.js';

/* 各厂商余额查询端点定义（尽力而为：无公开端点的厂商返回 null） */
const BALANCE_ENDPOINTS = {
  deepseek: {
    name: 'DeepSeek',
    async query(key) {
      const r = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const b = (d.balance_infos || [])[0] || {};
      return { balance: b.total_balance, granted: b.granted_balance, toppedUp: b.topped_up_balance, currency: b.currency || 'CNY', isAvailable: d.is_available };
    },
  },
  zhipu: {
    name: '智谱',
    async query(key) {
      const r = await fetch('https://open.bigmodel.cn/api/paas/v4/balance', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const b = (d.balance || [])[0] || {};
      return { balance: b.total, used: b.used, currency: b.currency || 'CNY' };
    },
  },
  moonshot: {
    name: '月之暗面 Kimi',
    async query(key) {
      const r = await fetch('https://api.moonshot.cn/v1/users/me/balance', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = (await r.json()).data || {};
      return { balance: d.available_balance, used: d.used_balance, granted: d.voucher_balance, currency: 'CNY' };
    },
  },
  openai: {
    name: 'OpenAI',
    async query(key) {
      /* 官方 dashboard billing 端点（开源方案同款） */
      const r1 = await fetch('https://api.openai.com/v1/dashboard/billing/subscription', { headers: { Authorization: 'Bearer ' + key } });
      if (!r1.ok) throw new Error('HTTP ' + r1.status);
      const sub = await r1.json();
      const r2 = await fetch('https://api.openai.com/v1/dashboard/billing/credit_grants', { headers: { Authorization: 'Bearer ' + key } });
      const grants = r2.ok ? await r2.json() : {};
      const total = grants.total_granted != null ? grants.total_granted : null;
      const used = grants.total_used != null ? grants.total_used : null;
      const limit = sub.hard_limit_usd;
      return { balance: total != null && used != null ? Math.max(0, total - used) : null, used, total, limit, currency: 'USD' };
    },
  },
  siliconflow: {
    name: '硅基流动',
    async query(key) {
      const r = await fetch('https://api.siliconflow.cn/v1/user/info', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      return { balance: d.balance, currency: 'CNY' };
    },
  },
  xiaomi: {
    name: '小米 MiMo',
    async query(key) {
      const r = await fetch('https://api.xiaomimimo.com/v1/user/balance', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      return { balance: d.balance != null ? d.balance : d.total_balance, used: d.used_balance, currency: 'CNY' };
    },
  },
};

/* 通用 OpenAI 兼容：尝试常见余额端点（中转站也可用） */
async function queryGenericOpenAI(key, base) {
  const root = String(base || '').replace(/\/$/, '');
  const tries = [
    root + '/user/balance',
    root + '/dashboard/billing/credit_grants',
    root + '/v1/user/balance',
  ];
  for (const url of tries) {
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.balance != null || d.total_balance != null || d.total_granted != null) {
        const total = d.total_balance != null ? d.total_balance : (d.total_granted != null ? d.total_granted : d.balance);
        const used = d.used_balance != null ? d.used_balance : (d.total_used != null ? d.total_used : null);
        return { balance: used != null ? Math.max(0, total - used) : total, used, total, currency: d.currency || 'USD' };
      }
    } catch (e) { /* try next */ }
  }
  throw new Error('该接口无公开余额查询端点');
}

/* 查询单个厂商余额 */
export async function checkProviderBalance(providerId, { baseOverride = null } = {}) {
  const key = await getApiKey(providerId);
  if (!key) return { provider: providerId, ok: false, error: '未配置 API Key' };
  const def = BALANCE_ENDPOINTS[providerId];
  try {
    if (def) {
      const r = await def.query(key);
      return { provider: providerId, name: def.name, ok: true, ...r };
    }
    const base = baseOverride || '';
    const r = await queryGenericOpenAI(key, base);
    return { provider: providerId, name: providerId, ok: true, ...r };
  } catch (e) {
    return { provider: providerId, name: (def && def.name) || providerId, ok: false, error: e.message };
  }
}

/* 批量查询（并行），跳过未配置 key 的厂商 */
export async function checkAllBalances(providers) {
  const results = await Promise.all(providers.map(async (p) => {
    const key = await getApiKey(p.id).catch(() => '');
    if (!key) return null;
    const r = await checkProviderBalance(p.id).catch((e) => ({ provider: p.id, ok: false, error: e.message }));
    return { ...r, label: p.name };
  }));
  return results.filter(Boolean);
}

export function fmtMoney(v, currency = '') {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return (currency ? currency + ' ' : '') + n.toFixed(n >= 100 ? 0 : 2);
}
