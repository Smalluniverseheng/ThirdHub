/* ===== ThirdHub js/ai/vendors.js — 30+ 厂商图标（自制 SVG 徽标，统一风格） =====
   每个厂商一个徽标：圆形渐变底 + 品牌字母/缩写，不引用任何外部品牌资源 */

function badge(letters, c1, c2, fs = 11) {
  return `<svg viewBox="0 0 32 32" class="vendor-ico"><defs><linearGradient id="vg-${letters}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="url(#vg-${letters})"/><text x="16" y="${fs >= 10 ? 20.5 : 21}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">${letters}</text></svg>`;
}

export const VENDOR_ICONS = {
  openai: badge('AI', '#10a37f', '#0d8a6c'),
  anthropic: badge('C', '#d97757', '#b85c3e'),
  google: badge('G', '#4285f4', '#3367d6'),
  xai: badge('𝕏', '#000000', '#333333'),
  deepseek: badge('DS', '#4d6bfe', '#2f4bd8'),
  aliyun: badge('QY', '#ff6a00', '#e65c00'),
  tencent: badge('HY', '#00a3ff', '#0077d9'),
  baidu: badge('WX', '#2932e1', '#1a23b8'),
  bytedance: badge('DB', '#325ab4', '#24418c'),
  moonshot: badge('K', '#111827', '#374151'),
  zhipu: badge('GLM', '#7c3aed', '#5b21b6', 9),
  yi: badge('Yi', '#0ea5e9', '#0369a1'),
  sensechat: badge('SL', '#0052cc', '#003d99'),
  minimax: badge('MM', '#e11d48', '#9f1239'),
  siliconflow: badge('SF', '#059669', '#047857'),
  baichuan: badge('BC', '#f59e0b', '#d97706'),
  stepfun: badge('JY', '#8b5cf6', '#6d28d9'),
  spark: badge('XF', '#2563eb', '#1e40af'),
  tiangong: badge('TG', '#14b8a6', '#0f766e'),
  qihoo: badge('360', '#22c55e', '#15803d', 9),
  mistral: badge('M', '#ff7000', '#e05d00'),
  cohere: badge('Co', '#39594d', '#253f36'),
  perplexity: badge('P', '#20808d', '#175f68'),
  groq: badge('GQ', '#f55036', '#d13c26'),
  together: badge('T', '#0f6fde', '#0a56ad'),
  fireworks: badge('FW', '#6720ff', '#4c15c9'),
  replicate: badge('R', '#1f2937', '#111827'),
  stability: badge('S', '#a855f7', '#7e22ce'),
  midjourney: badge('MJ', '#1e293b', '#0f172a'),
  openrouter: badge('OR', '#6366f1', '#4338ca'),
  azure: badge('Az', '#0078d4', '#005ba1'),
  nvidia: badge('NV', '#76b900', '#5a8f00'),
  cloudflare: badge('CF', '#f6821f', '#d96a0e'),
  custom: badge('…', '#64748b', '#475569'),
};

export function vendorIcon(id) {
  return VENDOR_ICONS[id] || VENDOR_ICONS.custom;
}
