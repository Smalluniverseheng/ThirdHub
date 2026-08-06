/* ===== ThirdHub js/ai/custom-providers.js — 自定义提供商管理 ===== */
import { kvGet, kvSet } from '../store.js';
import { uid } from '../ui.js';

export async function listCustom() {
  return await kvGet('ai:custom-providers', []);
}
export async function addCustom({ name, base, key, models = [] }) {
  const list = await listCustom();
  const cp = { id: 'custom-' + uid(), name, base, models, createdAt: Date.now() };
  list.push(cp);
  await kvSet('ai:custom-providers', list);
  if (key) await kvSet('ai:key:' + cp.id, key);
  return cp;
}
export async function updateCustom(id, patch) {
  const list = await listCustom();
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) { Object.assign(list[i], patch); await kvSet('ai:custom-providers', list); }
}
export async function removeCustom(id) {
  await kvSet('ai:custom-providers', (await listCustom()).filter((x) => x.id !== id));
}
