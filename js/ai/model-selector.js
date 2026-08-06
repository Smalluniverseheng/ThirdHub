/* ===== ThirdHub js/ai/model-selector.js — 模型选择器（底部弹出，按厂商分组，含图标） ===== */
import { PROVIDERS } from './ai-models.js';
import { vendorIcon } from './vendors.js';
import { modal, $, $$, esc, icon } from '../ui.js';
import { kvGet, kvSet } from '../store.js';
import { getApiKey } from './ai-api.js';

export async function pickModel({ multi = false, selected = [] } = {}) {
  const keys = {};
  for (const p of PROVIDERS) keys[p.id] = !!(await getApiKey(p.id));

  return new Promise((resolve) => {
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
        const models = (p.models || []).filter((m) => !kw || m.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw));
        if (!models.length && kw) return;
        const group = document.createElement('div');
        group.className = 'ms-group';
        group.innerHTML = `
          <div class="ms-vendor">
            <span class="ms-vico">${vendorIcon(p.id)}</span>
            <span class="ms-vname">${esc(p.name)}</span>
            ${keys[p.id] ? '<span class="tag tag-green">已配置</span>' : '<span class="tag tag-gray">未配置 Key</span>'}
          </div>`;
        models.forEach((m) => {
          const id = p.id + '/' + m;
          const item = document.createElement('button');
          item.className = 'ms-item' + (picked.has(id) ? ' on' : '') + (keys[p.id] ? '' : ' dim');
          item.innerHTML = `<span class="ellipsis">${esc(m)}</span>${picked.has(id) ? icon('check') : ''}`;
          item.onclick = () => {
            if (multi) {
              picked.has(id) ? picked.delete(id) : picked.add(id);
              render(kw ? $('.ms-search input', body).value : '');
            } else { m2.close(); resolve({ providerId: p.id, model: m }); }
          };
          group.appendChild(item);
        });
        listEl.appendChild(group);
      });
      if (!listEl.children.length) listEl.innerHTML = '<div class="empty"><div class="empty-title">没有匹配的模型</div></div>';
    }
    render();
    $('.ms-search input', body).addEventListener('input', (e) => render(e.target.value));
    const m2 = modal({ title: multi ? '选择多个模型（对比/协同）' : '选择模型', body, onClose: () => resolve(multi ? [...picked].map(parseId) : null) });
    if (multi) {
      $('[data-a="done"]', body).onclick = () => { m2.close(); };
    }
    function parseId(s) { const i = s.indexOf('/'); return { providerId: s.slice(0, i), model: s.slice(i + 1) }; }
  });
}
