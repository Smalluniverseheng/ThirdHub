/* ===== ThirdHub js/ai/model-selector.js — 模型选择器 v1.5（底部弹出 · 按厂商分组 · 类型过滤 · 同步模型合并） ===== */
import { PROVIDERS } from './ai-models.js';
import { vendorIcon } from './vendors.js';
import { modal, $, $$, esc, icon } from '../ui.js';
import { getApiKey, getSyncedModels } from './ai-api.js';

/* type: 'chat'（默认）| 'image' | 'video' */
export async function pickModel({ multi = false, selected = [], type = 'chat' } = {}) {
  const keys = {};
  for (const p of PROVIDERS) keys[p.id] = !!(await getApiKey(p.id));

  // 各类型可用模型
  const modelsOf = (p) => {
    if (type === 'image') return p.image || [];
    if (type === 'video') return p.video || [];
    return p.models || [];
  };
  // 聊天类型合并实时同步的模型（不含历史模型）
  const syncedMap = {};
  if (type === 'chat') {
    for (const p of PROVIDERS) {
      const synced = await getSyncedModels(p.id);
      if (synced.length) syncedMap[p.id] = synced.filter((m) => !(p.deprecated || []).includes(m) && !(p.models || []).includes(m));
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="ms-search"><input class="input" placeholder="搜索模型或厂商…"></div>
      <div class="ms-list"></div>
      ${multi ? '<div style="padding-top:10px"><button class="btn btn-primary btn-block" data-a="done">确定</button></div>' : ''}`;
    const listEl = $('.ms-list', body);
    const picked = new Set(selected);

    function render(filter = '') {
      const kw = filter.trim().toLowerCase();
      listEl.innerHTML = '';
      PROVIDERS.forEach((p) => {
        let models = modelsOf(p);
        if (syncedMap[p.id]) models = models.concat(syncedMap[p.id].map((m) => m + '::new'));
        models = models.filter((m) => { const name = m.replace('::new', ''); return !kw || name.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw); });
        if (!models.length) return;
        const group = document.createElement('div');
        group.className = 'ms-group';
        group.innerHTML = `
          <div class="ms-vendor">
            <span class="ms-vico">${vendorIcon(p.id)}</span>
            <span class="ms-vname">${esc(p.name)}</span>
            ${keys[p.id] ? '<span class="tag tag-green">已配置</span>' : '<span class="tag tag-gray">未配置 Key</span>'}
          </div>`;
        models.forEach((raw) => {
          const isNew = raw.endsWith('::new');
          const m = isNew ? raw.slice(0, -5) : raw;
          const id = p.id + '/' + m;
          const item = document.createElement('button');
          item.className = 'ms-item' + (picked.has(id) ? ' on' : '') + (keys[p.id] ? '' : ' dim');
          item.innerHTML = `<span class="ellipsis">${esc(m)}</span>${isNew ? '<span class="tag tag-blue">新上线</span>' : ''}${picked.has(id) ? icon('check') : ''}`;
          item.onclick = () => {
            if (multi) {
              picked.has(id) ? picked.delete(id) : picked.add(id);
              render(kw ? $('.ms-search input', body).value : '');
            } else {
              settle({ providerId: p.id, model: m });
              m2.mask.remove();
            }
          };
          group.appendChild(item);
        });
        listEl.appendChild(group);
      });
      if (!listEl.children.length) listEl.innerHTML = '<div class="empty"><div class="empty-title">没有匹配的模型</div></div>';
    }
    render();
    $('.ms-search input', body).addEventListener('input', (e) => render(e.target.value));
    const titles = { chat: multi ? '选择多个模型（对比/协同）' : '选择模型', image: '选择绘画模型', video: '选择视频模型' };
    const m2 = modal({ title: titles[type] || titles.chat, body, onClose: () => settle(multi ? [...picked].map(parseId) : null) });
    if (multi) {
      $('[data-a="done"]', body).onclick = () => { settle([...picked].map(parseId)); m2.mask.remove(); };
    }
    function parseId(s) { const i = s.indexOf('/'); return { providerId: s.slice(0, i), model: s.slice(i + 1) }; }
  });
}
