/* ===== ThirdHub js/modules/board-game.js — 游戏板块（H5 小游戏，用户自行添加） ===== */
import { $, $$, el, esc, icon, toast, modal, formRow, uid } from '../ui.js';
import { kvGet, kvSet } from '../store.js';

export async function renderGameBoard(page) {
  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">游戏</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="add" title="添加游戏">${icon('plus')}</button>
    </div>
    <div data-role="list" style="padding:4px 16px 24px"></div>`;

  const listEl = $('[data-role="list"]', page);

  async function render() {
    const games = await kvGet('games:list', []);
    if (!games.length) {
      listEl.innerHTML = `<div class="empty" style="margin-top:44px">
        <div class="empty-ico">${icon('game')}</div>
        <div class="empty-title">还没有游戏</div>
        <div class="muted" style="max-width:280px;line-height:1.8">ThirdHub 不预置任何游戏。<br>点右上角「＋」添加你自己收藏的 H5 小游戏链接，即点即玩。</div>
      </div>`;
      return;
    }
    listEl.innerHTML = `<div class="result-grid">${games.map((g) => `
      <button class="content-card card-press" data-id="${g.id}">
        <div class="content-cover">${g.iconUrl ? `<img src="${esc(g.iconUrl)}" loading="lazy" onerror="this.remove()">` : icon('game')}</div>
        <div class="content-name ellipsis">${esc(g.name)}</div>
        <div class="content-sub ellipsis">${esc(g.url)}</div>
      </button>`).join('')}
    </div>
    <div class="muted" style="text-align:center;padding:14px 0;font-size:11.5px">长按卡片可删除</div>`;

    $$('[data-id]', listEl).forEach((b) => {
      b.onclick = async () => {
        const g = (await kvGet('games:list', [])).find((x) => x.id === b.dataset.id);
        if (!g) return;
        const { openOverlay } = await import('../ui.js');
        openOverlay({
          title: g.name,
          build: (body) => {
            body.innerHTML = `<iframe src="${esc(g.url)}" style="flex:1;border:none;width:100%;height:100%;background:#000" allowfullscreen></iframe>`;
          },
        });
      };
      let timer = null;
      b.addEventListener('touchstart', () => { timer = setTimeout(() => delGame(b.dataset.id), 600); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(timer));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); delGame(b.dataset.id); });
    });
  }

  async function delGame(id) {
    const games = (await kvGet('games:list', [])).filter((x) => x.id !== id);
    await kvSet('games:list', games);
    toast('已删除');
    render();
  }

  $('[data-a="add"]', page).onclick = () => {
    const body = el(`<div>
      ${formRow('游戏名称', '<input class="input" data-f="name" placeholder="例如：2048">')}
      ${formRow('游戏链接（H5 页面地址）', '<input class="input" data-f="url" placeholder="https://…">')}
      ${formRow('图标链接（可选）', '<input class="input" data-f="icon" placeholder="https://…/icon.png">')}
    </div>`);
    const m = modal({
      title: '添加游戏', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">添加</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="ok"]', m.mask).onclick = async () => {
      const name = $('[data-f="name"]', body).value.trim();
      const url = $('[data-f="url"]', body).value.trim();
      if (!name || !/^https?:\/\//.test(url)) return toast('请填写名称和有效链接', 'err');
      const games = await kvGet('games:list', []);
      games.push({ id: uid(), name, url, iconUrl: $('[data-f="icon"]', body).value.trim() });
      await kvSet('games:list', games);
      m.close(); toast('已添加', 'ok');
      render();
    };
  };

  await render();
}
