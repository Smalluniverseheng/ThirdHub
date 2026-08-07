/* ===== ThirdHub js/i18n.js — 国际化（当前内置简体中文，预留扩展） ===== */
import { kvGet } from './store.js';

const STRINGS = {
  'zh-CN': {},
};

let lang = 'zh-CN';
export async function initI18n() {
  lang = await kvGet('setting:lang', 'zh-CN');
}
export function t(key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || key;
}
export function getLang() { return lang; }
