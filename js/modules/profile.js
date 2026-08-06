/* ===== ThirdHub js/modules/profile.js — 我的页 ===== */
import { $, $$, el, esc, icon, toast, modal, actionSheet, confirmDialog, formRow, fmtBytes, fmtDate } from '../ui.js';
import { kvGet, kvSet, db, on, setSetting, getSetting } from '../store.js';
import { currentUser, signIn, signUp, signOut, redeemCard, levelById, LEVELS, isAdmin } from '../auth.js';
import { hasCloud, configureCloud } from '../supabase.js';
import { getTotalStats, getDailyStats, fmtTokens } from '../token-meter.js';
import { APP_VERSION } from '../app.js';
import { CHANGELOG } from '../changelog.js';
import { checkUpdate } from '../update-checker.js';
import { showKeySettings } from './ai-chat.js';

export async function renderProfile(page) {
  const user = await currentUser();
  const admin = await isAdmin();

  page.innerHTML = `
    <div class="page-head"><div class="page-title">我的</div></div>
    <div data-role="usercard"></div>

    <div class="profile-section">
      <div class="section-title">会员中心</div>
      <div data-role="member"></div>
    </div>

    <div class="profile-section">
      <div class="section-title">数据管理</div>
      <div data-role="data"></div>
    </div>

    <div class="profile-section">
      <div class="section-title">设置</div>
      <div data-role="settings"></div>
    </div>

    ${admin ? `<div class="profile-section"><div data-role="admin"></div></div>` : ''}

    <div class="profile-foot">第三方科技 · ThirdHub v${APP_VERSION}</div>`;

  renderUserCard();
  renderMember();
  renderData();
  renderSettings();
  if (admin) renderAdmin();
  on('auth:changed', () => { renderUserCard(); renderMember(); });

  /* ---------- 用户卡 ---------- */
  async function renderUserCard() {
    const u = await currentUser();
    const lv = levelById(u ? u.level : 'guest');
    const box = $('[data-role="usercard"]', page);
    box.innerHTML = `
      <div class="user-card card">
        <div class="user-avatar">${u && u.avatar ? `<img src="${esc(u.avatar)}">` : icon('user')}</div>
        <div class="grow" style="min-width:0">
          <div class="row gap8">
            <span style="font-size:17px;font-weight:800" class="ellipsis">${esc(u ? u.nickname : '未登录')}</span>
            <span class="tag ${lv.tag}">${lv.name}</span>
          </div>
          <div class="muted">${u ? esc(u.email || '') : '登录后可使用云端同步与会员功能'}</div>
          ${u ? `<div class="muted mt8">云存储：${fmtBytes(u.storageUsed || 0)} / ${lv.storage === Infinity ? '无限' : fmtBytes(lv.storage)}</div>
          <div class="storage-bar"><div class="storage-fill" style="width:${lv.storage === Infinity ? 0 : Math.min(100, ((u.storageUsed || 0) / lv.storage) * 100)}%"></div></div>` : ''}
        </div>
        <button class="btn btn-sm ${u ? '' : 'btn-primary'}" data-a="auth">${u ? '退出' : '登录'}</button>
      </div>`;
    $('[data-a="auth"]', box).onclick = () => u ? doSignOut() : showAuthDialog();
  }

  function showAuthDialog() {
    if (!hasCloud()) {
      modal({
        title: '云端未配置', center: true,
        body: '<p style="font-size:14px;line-height:1.8;color:var(--text-secondary)">当前为纯本地模式。配置 Supabase 云端后可使用登录、会员、卡密、多端同步功能。请在「数据管理 → 云端同步」中配置。</p>',
      });
      return;
    }
    const body = el(`<div>
      ${formRow('邮箱', '<input class="input" type="email" data-f="email" placeholder="you@example.com">')}
      ${formRow('密码', '<input class="input" type="password" data-f="pwd" placeholder="至少 6 位">')}
    </div>`);
    const m = modal({
      title: '登录 / 注册', body,
      footer: '<button class="btn grow" data-a="reg">注册</button><button class="btn btn-primary grow" data-a="login">登录</button>',
    });
    $('[data-a="login"]', m.mask).onclick = async () => {
      try {
        await signIn($('[data-f="email"]', body).value.trim(), $('[data-f="pwd"]', body).value);
        m.close(); toast('登录成功', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-a="reg"]', m.mask).onclick = async () => {
      try {
        await signUp($('[data-f="email"]', body).value.trim(), $('[data-f="pwd"]', body).value);
        m.close();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  async function doSignOut() {
    if (await confirmDialog('退出登录', '退出后云端同步将停止，本地数据保留。', '退出')) {
      await signOut();
      toast('已退出');
    }
  }

  /* ---------- 会员中心 ---------- */
  async function renderMember() {
    const u = await currentUser();
    const lv = levelById(u ? u.level : 'guest');
    const box = $('[data-role="member"]', page);
    box.innerHTML = `
      <div class="card member-card">
        <div class="row gap8 mb8">
          <span style="font-size:15px;font-weight:800" class="${lv.cls}">${lv.name}等级</span>
          ${lv.storage === Infinity ? '<span class="tag tag-gold">无限存储</span>' : `<span class="tag tag-blue">${fmtBytes(lv.storage)}</span>`}
        </div>
        <div class="muted" style="line-height:1.7;margin-bottom:12px">会员只扩容云存储，AI 对话使用你自己的 API Key。</div>
        <div class="row gap8">
          <button class="btn btn-primary btn-sm grow" data-a="levels">升级会员</button>
          <button class="btn btn-sm grow" data-a="card">${icon('ticket')} 卡密激活</button>
          <button class="btn btn-sm grow" data-a="agent">${icon('users')} 代理中心</button>
        </div>
      </div>
      <button class="list-item mt8" data-a="stats" style="width:100%">
        <span class="list-ico">${icon('chart')}</span>
        <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">数据统计</div><div class="muted">Token 用量 / 使用记录</div></div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`;
    $('[data-a="levels"]', box).onclick = showLevels;
    $('[data-a="card"]', box).onclick = showCardDialog;
    $('[data-a="agent"]', box).onclick = showAgent;
    $('[data-a="stats"]', box).onclick = showStats;
  }

  function showLevels() {
    const body = el('<div class="col gap8"></div>');
    LEVELS.forEach((l) => {
      body.appendChild(el(`
        <div class="list-item">
          <div class="grow">
            <div class="row gap8"><span style="font-weight:700" class="${l.cls}">${l.name}</span>
            <span class="tag ${l.tag}">${l.storage === Infinity ? '无限存储' : l.storage === 0 ? '仅本地' : fmtBytes(l.storage)}</span></div>
            <div class="muted">${l.price === 0 ? '免费' : '¥' + l.price + '/月'}</div>
          </div>
          ${l.price > 0 ? `<button class="btn btn-sm btn-accent" data-lv="${l.id}">升级</button>` : ''}
        </div>`));
    });
    const m = modal({ title: '会员等级', body });
    $$('[data-lv]', body).forEach((b) => b.onclick = () => {
      m.close();
      modal({ title: '开通会员', center: true, body: '<p style="font-size:14px;line-height:1.8;color:var(--text-secondary)">请联系代理或使用卡密激活对应等级。卡密可在「会员中心 → 卡密激活」中兑换。</p>' });
    });
  }

  function showCardDialog() {
    const body = el(`<div>
      ${formRow('卡密（50 位）', '<input class="input" data-f="card" placeholder="TP-XXXXXXXX-XXXXXXXX-..." style="font-family:monospace">')}
      <div class="muted">卡密仅兑换存储容量升级，不兑换 Token。</div>
    </div>`);
    const m = modal({
      title: '卡密激活', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">激活</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="ok"]', m.mask).onclick = async () => {
      try {
        const r = await redeemCard($('[data-f="card"]', body).value);
        m.close();
        toast('激活成功' + (r && r.level ? '：' + levelById(r.level).name : ''), 'ok');
        renderUserCard(); renderMember();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  function showAgent() {
    modal({
      title: '代理中心',
      body: `<div style="font-size:14px;line-height:2;color:var(--text-secondary)">
        <p>三级分润体系：一级 20% / 二级 5% / 三级 2%</p>
        <p>成为代理后可获得专属邀请码，下级充值自动分润。</p>
        <p class="muted">代理功能需要云端账号，请联系管理员开通。</p>
      </div>`,
    });
  }

  async function showStats() {
    const total = await getTotalStats();
    const daily = await getDailyStats();
    const days = Object.keys(daily).sort().slice(-14);
    const max = Math.max(1, ...days.map((d) => daily[d].prompt + daily[d].completion));
    modal({
      title: '数据统计',
      body: `
        <div class="row gap16 mb16">
          <div class="card grow" style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--primary)">${fmtTokens(total.prompt + total.completion)}</div><div class="muted">总 Tokens</div></div>
          <div class="card grow" style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--primary)">${total.requests}</div><div class="muted">总请求</div></div>
        </div>
        <div class="muted mb8">近 14 天用量</div>
        <div class="stats-chart">${days.map((d) => {
          const v = daily[d].prompt + daily[d].completion;
          return `<div class="stats-bar-wrap" title="${d}: ${fmtTokens(v)}"><div class="stats-bar" style="height:${Math.max(3, (v / max) * 100)}%"></div><div class="stats-day">${d.slice(8)}</div></div>`;
        }).join('')}</div>`,
    });
  }

  /* ---------- 数据管理 ---------- */
  function renderData() {
    const box = $('[data-role="data"]', page);
    box.innerHTML = [
      { a: 'cloud', ico: 'cloud', name: '云端同步', desc: hasCloud() ? '已配置' : '未配置（纯本地模式）' },
      { a: 'backup', ico: 'download', name: '本地备份 / 恢复', desc: '导出或导入全部本地数据' },
      { a: 'cache', ico: 'trash', name: '清理缓存', desc: '清空章节内容缓存' },
    ].map((m) => `
      <button class="list-item" style="margin-bottom:8px;width:100%" data-a="${m.a}">
        <span class="list-ico">${icon(m.ico)}</span>
        <div class="grow" style="text-align:left;min-width:0">
          <div style="font-size:14px;font-weight:600">${m.name}</div>
          <div class="muted">${m.desc}</div>
        </div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`).join('');

    $('[data-a="cloud"]', box).onclick = async () => {
      const url = await kvGet('cloud:url', '');
      const key = await kvGet('cloud:anonKey', '');
      const body = el(`<div>
        ${formRow('Supabase URL', `<input class="input" data-f="url" value="${esc(url)}" placeholder="https://xxx.supabase.co">`)}
        ${formRow('Anon Key', `<textarea class="input" rows="3" data-f="key">${esc(key)}</textarea>`)}
      </div>`);
      const m = modal({
        title: '云端同步配置', body,
        footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存并连接</button>',
      });
      $('[data-a="cancel"]', m.mask).onclick = m.close;
      $('[data-a="save"]', m.mask).onclick = async () => {
        const ok = await configureCloud($('[data-f="url"]', body).value, $('[data-f="key"]', body).value);
        m.close();
        toast(ok ? '云端已连接' : '连接失败，请检查配置', ok ? 'ok' : 'err');
        renderData();
      };
    };

    $('[data-a="backup"]', box).onclick = async () => {
      const v = await actionSheet('本地备份', [
        { label: '导出全部数据（JSON）', value: 'export', icon: 'export' },
        { label: '从备份文件恢复', value: 'import', icon: 'import' },
      ]);
      if (v === 'export') {
        const data = {};
        for (const s of ['kv', 'sources', 'shelf', 'history', 'favorites', 'chats']) data[s] = await db.all(s);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'thirdhub-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        toast('备份已导出', 'ok');
      } else if (v === 'import') {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = async () => {
          try {
            const data = JSON.parse(await input.files[0].text());
            for (const [store, rows] of Object.entries(data)) {
              if (!['kv', 'sources', 'shelf', 'history', 'favorites', 'chats'].includes(store)) continue;
              for (const row of rows) await db.put(store, row);
            }
            toast('恢复完成，即将刷新', 'ok');
            setTimeout(() => location.reload(), 800);
          } catch (e) { toast('备份文件无效', 'err'); }
        };
        input.click();
      }
    };

    $('[data-a="cache"]', box).onclick = async () => {
      if (await confirmDialog('清理缓存', '将清空所有章节内容缓存（不影响书架和进度），确定吗？', '清理', true)) {
        await db.clear('cache');
        toast('缓存已清理', 'ok');
      }
    };
  }

  /* ---------- 设置 ---------- */
  async function renderSettings() {
    const theme = await getSetting('theme');
    const box = $('[data-role="settings"]', page);
    box.innerHTML = [
      { a: 'tabs', ico: 'grid', name: '导航栏管理', desc: '选择底部导航显示的板块（1-5 个）' },
      { a: 'theme', ico: 'palette', name: '主题外观', desc: { dark: '深色', light: '浅色', auto: '跟随系统' }[theme] },
      { a: 'aikeys', ico: 'key', name: 'AI 设置 / API 管理', desc: '配置各厂商 API Key' },
      { a: 'sources', ico: 'plug', name: '连接器管理', desc: '导入 / 管理内容连接器' },
      { a: 'reader', ico: 'book', name: '阅读设置', desc: '翻页 / 字体 / 背景' },
      { a: 'update', ico: 'refresh', name: '检查更新', desc: '当前 v' + APP_VERSION },
      { a: 'changelog', ico: 'history', name: '历史版本', desc: '各版本更新日志' },
      { a: 'about', ico: 'info', name: '关于 ThirdHub', desc: '版本与许可' },
    ].map((m) => `
      <button class="list-item" style="margin-bottom:8px;width:100%" data-a="${m.a}">
        <span class="list-ico">${icon(m.ico)}</span>
        <div class="grow" style="text-align:left;min-width:0">
          <div style="font-size:14px;font-weight:600">${m.name}</div>
          <div class="muted">${m.desc}</div>
        </div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`).join('');

    $('[data-a="theme"]', box).onclick = async () => {
      const v = await actionSheet('主题外观', [
        { label: '深色', value: 'dark', icon: theme === 'dark' ? 'check' : undefined },
        { label: '浅色', value: 'light', icon: theme === 'light' ? 'check' : undefined },
        { label: '跟随系统', value: 'auto', icon: theme === 'auto' ? 'check' : undefined },
      ]);
      if (v) { await setSetting('theme', v); renderSettings(); }
    };
    $('[data-a="aikeys"]', box).onclick = () => showKeySettings();
    $('[data-a="tabs"]', box).onclick = showTabManager;
    $('[data-a="sources"]', box).onclick = async () => {
      const { openOverlay } = await import('../ui.js');
      const { renderCategory } = await import('./category.js');
      openOverlay({ title: '连接器管理', build: async (body) => { body.style.overflowY = 'auto'; await renderCategory(body); const h = body.querySelector('.page-head'); if (h) h.remove(); } });
    };
    $('[data-a="reader"]', box).onclick = async () => {
      const flip = await getSetting('readerFlip');
      const v = await actionSheet('默认翻页模式', [
        { label: '滑动翻页', value: 'slide', icon: flip === 'slide' ? 'check' : undefined },
        { label: '覆盖翻页', value: 'cover', icon: flip === 'cover' ? 'check' : undefined },
        { label: '仿真翻页', value: 'sim', icon: flip === 'sim' ? 'check' : undefined },
        { label: '连续滚动', value: 'scroll', icon: flip === 'scroll' ? 'check' : undefined },
      ]);
      if (v) { await setSetting('readerFlip', v); toast('已保存'); }
    };
    $('[data-a="update"]', box).onclick = () => checkUpdate(true);
    $('[data-a="changelog"]', box).onclick = showChangelog;
    $('[data-a="about"]', box).onclick = () => {
      modal({
        title: '关于 ThirdHub',
        body: `
          <div style="text-align:center;padding:12px 0 20px">
            <div style="font-size:18px;font-weight:800">第三方科技 · ThirdHub</div>
            <div class="muted mt8">v${APP_VERSION} · MIT License</div>
            <div class="muted mt8" style="max-width:300px;margin:8px auto 0;line-height:1.8">全平台智能聚合平台。软件不预置任何内容源，所有内容接入能力由用户自行导入配置后启用。</div>
          </div>`,
      });
    };
  }

  /* ---------- 导航栏板块管理（1-5 个，「我的」固定） ---------- */
  async function showTabManager() {
    const { BOARDS, MAX_TABS, MIN_TABS } = await import('../boards.js');
    const cur = await kvGet('ui:tabs', ['ai']);
    const picked = new Set(Array.isArray(cur) && cur.length ? cur : ['ai']);

    const body = el('<div></div>');
    function render() {
      body.innerHTML = `
        <div class="muted" style="margin-bottom:10px;line-height:1.7">勾选要显示在底部导航栏的板块（${MIN_TABS}-${MAX_TABS} 个）。未勾选的板块不会加载，勾选后首次打开时才下载。「我的」固定显示。</div>
        <div class="col gap8">
          ${BOARDS.map((b) => `
            <button class="list-item" style="width:100%" data-b="${b.id}">
              <span class="list-ico">${icon(b.ico)}</span>
              <div class="grow" style="text-align:left;min-width:0">
                <div style="font-size:14px;font-weight:600">${b.name}</div>
                <div class="muted ellipsis">${esc(b.desc)}</div>
              </div>
              <span class="ai-toggle ${picked.has(b.id) ? 'on' : ''}" data-tg="${b.id}"></span>
            </button>`).join('')}
        </div>
        <div class="muted" style="text-align:center;margin-top:10px">已选 ${picked.size} / ${MAX_TABS} 个板块</div>`;
    }
    render();
    body.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-b]');
      if (!row) return;
      const id = row.dataset.b;
      if (picked.has(id)) {
        if (picked.size <= MIN_TABS) return toast('至少保留 1 个板块');
        picked.delete(id);
      } else {
        if (picked.size >= MAX_TABS) return toast(`最多选择 ${MAX_TABS} 个板块`);
        picked.add(id);
      }
      await kvSet('ui:tabs', [...picked]);
      render();
      const { rebuildTabs } = await import('../app.js');
      rebuildTabs(currentTabId());
    });
    function currentTabId() {
      const on = document.querySelector('#tabbar .tab.on');
      return on ? on.dataset.tab : null;
    }
    modal({ title: '导航栏管理', body });
  }

  /* ---------- 历史版本（时间线，仅最新版展开） ---------- */
  function showChangelog() {
    const list = CHANGELOG.slice().reverse(); // 最新在前
    const body = el(`<div class="timeline">${list.map((c, idx) => `
      <div class="tl-item${idx === 0 ? ' major open' : ''}">
        <div class="tl-dot"></div>
        <div class="tl-card">
          <button class="tl-head tl-toggle">
            <span class="tl-ver">v${c.version}</span>
            ${idx === 0 ? '<span class="tl-badge">最新</span>' : ''}
            <span class="tl-date">${c.date}</span>
            <span class="tl-caret">${icon('arrowR')}</span>
          </button>
          <ul class="tl-list">${c.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>
      </div>`).join('')}</div>`);
    body.addEventListener('click', (e) => {
      const head = e.target.closest('.tl-toggle');
      if (head) head.closest('.tl-item').classList.toggle('open');
    });
    modal({ title: '历史版本', body });
  }

  /* ---------- 管理员入口 ---------- */
  function renderAdmin() {
    const box = $('[data-role="admin"]', page);
    box.innerHTML = `
      <button class="list-item" style="width:100%;border:1px solid rgba(255,199,0,.3)">
        <span class="list-ico" style="background:rgba(255,199,0,.12);color:#ffd54d">${icon('crown')}</span>
        <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:700;color:#ffd54d">管理后台</div><div class="muted">ThirdHub-Admin</div></div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`;
    box.firstElementChild.onclick = async () => {
      const url = await kvGet('admin:url', '');
      if (url) window.open(url, '_blank');
      else toast('未配置管理后台地址');
    };
  }
}
