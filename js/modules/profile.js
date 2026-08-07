/* ===== ThirdHub js/modules/profile.js — 我的页（v1.5 全量重写） =====
   用户卡 → 个人资料子页面（头像/昵称/邮箱/手机号/简介 + 会员中心）
   个性化设置（桌面/移动/手表导航）· 完整阅读设置（小说 + 漫画）· 数据统计（含花费估算） */
import { $, $$, el, esc, icon, toast, modal, actionSheet, confirmDialog, openOverlay, formRow, fmtBytes } from '../ui.js';
import { kvGet, kvSet, db, on, setSetting, getSetting } from '../store.js';
import { currentUser, signIn, signOut, redeemCard, levelById, LEVELS, isAdmin, updateProfile, changeEmail } from '../auth.js';
import { hasCloud } from '../supabase.js';
import { getTotalStats, getDailyStats, getCostBreakdown, fmtTokens } from '../token-meter.js';
import { fmtUsd, usdToCnyRate } from '../ai/ai-pricing.js';
import { APP_VERSION } from '../app.js';
import { CHANGELOG } from '../changelog.js';
import { checkUpdate } from '../update-checker.js';
import { showKeySettings } from './ai-chat.js';
import { showRegisterPage } from './register-page.js';

export async function renderProfile(page) {
  const admin = await isAdmin();

  page.innerHTML = `
    <div class="page-head"><div class="page-title">我的</div></div>
    <div data-role="usercard"></div>

    <div class="profile-section">
      <div class="section-title">数据管理</div>
      <div data-role="data"></div>
    </div>

    <div class="profile-section">
      <div class="section-title">服务与安全</div>
      <div data-role="services"></div>
    </div>

    <div class="profile-section">
      <div class="section-title">设置</div>
      <div data-role="settings"></div>
    </div>

    ${admin ? `<div class="profile-section"><div data-role="admin"></div></div>` : ''}

    <div class="profile-foot">第三方科技 · ThirdHub v${APP_VERSION}</div>`;

  renderUserCard();
  renderData();
  renderServices();
  renderSettings();
  if (admin) renderAdmin();
  on('auth:changed', renderUserCard);

  /* ================= 用户卡（点击 → 个人资料子页面） ================= */
  async function renderUserCard() {
    const u = await currentUser();
    const lv = levelById(u ? u.level : 'guest');
    const box = $('[data-role="usercard"]', page);
    box.innerHTML = `
      <div class="user-card card" data-a="profile" style="cursor:pointer">
        <div class="user-avatar">${u && u.avatar ? `<img src="${esc(u.avatar)}">` : '<img src="icons/brand.jpg" style="object-fit:cover">'}</div>
        <div class="grow" style="min-width:0">
          <div class="row gap8">
            <span style="font-size:17px;font-weight:800" class="ellipsis">${esc(u ? u.nickname : '未登录')}</span>
            <span class="tag ${lv.tag}">${lv.name}</span>
          </div>
          <div class="muted">${u ? esc(u.email || '') : '登录后可使用云端同步与会员功能'}</div>
          ${u ? `<div class="muted mt8">云存储：${fmtBytes(u.storageUsed || 0)} / ${lv.storage === Infinity ? '无限' : fmtBytes(lv.storage)}</div>
          <div class="storage-bar"><div class="storage-fill" style="width:${lv.storage === Infinity ? 0 : Math.min(100, ((u.storageUsed || 0) / lv.storage) * 100)}%"></div></div>` : ''}
        </div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </div>`;
    $('[data-a="profile"]', box).onclick = () => u ? showProfileSubpage() : showAuthDialog();
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
      title: '登录', body,
      footer: '<button class="btn grow" data-a="goreg">注册新账号</button><button class="btn btn-primary grow" data-a="login">登录</button>',
    });
    $('[data-a="login"]', m.mask).onclick = async () => {
      try {
        await signIn($('[data-f="email"]', body).value.trim(), $('[data-f="pwd"]', body).value);
        m.close(); toast('登录成功', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-a="goreg"]', m.mask).onclick = () => {
      m.close();
      showRegisterPage({});
    };
  }

  /* ================= 个人资料子页面（含会员中心） ================= */
  async function showProfileSubpage() {
    const u = await currentUser();
    if (!u) return;
    const lv = levelById(u.level);
    const ref = openOverlay({
      title: '个人资料',
      build: (body) => {
        body.innerHTML = `
          <div class="profile-hero">
            <div class="user-avatar lg" id="pf-avatar" style="position:relative">
              ${u.avatar ? `<img src="${esc(u.avatar)}">` : '<img src="icons/brand.jpg" style="object-fit:cover">'}
              <span class="avatar-edit-badge">${icon('camera')}</span>
            </div>
            <div style="font-size:17px;font-weight:800">${esc(u.nickname)}</div>
            <div class="muted">${esc(u.email || '')}</div>
            <span class="tag ${lv.tag}">${lv.name}</span>
          </div>
          <div class="profile-section">
            <div class="section-title">账号资料</div>
            <div id="pf-rows"></div>
          </div>
          <div class="profile-section">
            <div class="section-title">会员中心</div>
            <div id="pf-member"></div>
          </div>
          <div class="profile-section">
            <button class="btn btn-block" id="pf-logout" style="color:var(--danger)">${icon('logout')} 退出登录</button>
          </div>`;
        renderRows();
        renderMemberBox($('#pf-member', body));
        /* v1.7：退出登录移入头像资料页 */
        $('#pf-logout', body).onclick = async () => {
          if (await confirmDialog('退出登录', '退出后云端同步将停止，本地数据保留。', '退出')) {
            await signOut();
            ref.close();
            toast('已退出');
          }
        };

        function renderRows() {
          const rows = [
            { k: 'nickname', name: '昵称', val: u.nickname || '未设置' },
            { k: 'email', name: '邮箱', val: u.email || '未设置' },
            { k: 'phone', name: '手机号', val: u.phone || '未设置' },
            { k: 'bio', name: '简介', val: u.bio || '这个人很懒，什么都没写' },
          ];
          $('#pf-rows', body).innerHTML = rows.map((r) => `
            <button class="profile-row" data-k="${r.k}">
              <span class="profile-row-name">${r.name}</span>
              <span class="profile-row-val ellipsis">${esc(r.val)}</span>
              <span class="list-arrow">${icon('arrowR')}</span>
            </button>`).join('');
          $$('.profile-row', body).forEach((b) => b.onclick = () => {
            const k = b.dataset.k;
            if (k === 'email') editEmail();
            else editField(k, rows.find((x) => x.k === k).name);
          });
        }

        function editField(k, name) {
          const long = k === 'bio';
          const b2 = el(`<div>${formRow(name, long
            ? `<textarea class="input" rows="3" data-f="v" maxlength="120">${esc(u[k] || '')}</textarea>`
            : `<input class="input" data-f="v" value="${esc(u[k] || '')}" maxlength="${k === 'phone' ? 15 : 24}">`)}</div>`);
          const m2 = modal({
            title: '修改' + name, body: b2,
            footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">保存</button>',
          });
          $('[data-a="c"]', m2.mask).onclick = m2.close;
          $('[data-a="ok"]', m2.mask).onclick = async () => {
            const v = $('[data-f="v"]', b2).value.trim();
            if (!v && k !== 'bio') { toast(name + '不能为空'); return; }
            if (k === 'phone' && v && !/^1\d{10}$/.test(v)) { toast('手机号格式不正确'); return; }
            try {
              await updateProfile({ [k]: v });
              u[k] = v;
              m2.close();
              toast('已保存', 'ok');
              renderRows();
            } catch (e) { toast(e.message, 'err'); }
          };
        }

        function editEmail() {
          const b2 = el(`<div>
            ${formRow('新邮箱', '<input class="input" type="email" data-f="v" placeholder="new@example.com">')}
            <div class="muted">修改后需到新邮箱中点击确认链接才会生效。</div>
          </div>`);
          const m2 = modal({
            title: '修改邮箱', body: b2,
            footer: '<button class="btn grow" data-a="c">取消</button><button class="btn btn-primary grow" data-a="ok">发送确认邮件</button>',
          });
          $('[data-a="c"]', m2.mask).onclick = m2.close;
          $('[data-a="ok"]', m2.mask).onclick = async () => {
            const v = $('[data-f="v"]', b2).value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast('邮箱格式不正确'); return; }
            try {
              await changeEmail(v);
              m2.close();
              toast('确认邮件已发送，请查收', 'ok');
            } catch (e) { toast(e.message, 'err'); }
          };
        }

        $('#pf-avatar', body).onclick = () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async () => {
            const f = input.files[0];
            if (!f) return;
            try {
              const url = await downscaleImage(f, 128);
              await updateProfile({ avatar: url });
              u.avatar = url;
              $('#pf-avatar', body).innerHTML = `<img src="${url}"><span class="avatar-edit-badge">${icon('camera')}</span>`;
              toast('头像已更新', 'ok');
            } catch (e) { toast(e.message, 'err'); }
          };
          input.click();
        };
      },
    });
  }

  function downscaleImage(file, size) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = size; cv.height = size;
          const ctx = cv.getContext('2d');
          const s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          resolve(cv.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = rd.result;
      };
      rd.onerror = reject;
      rd.readAsDataURL(file);
    });
  }

  /* ================= 会员中心（渲染到指定容器） ================= */
  function renderMemberBox(box) {
    const u2p = currentUser();
    box.innerHTML = '';
    u2p.then((u) => {
      const lv = levelById(u ? u.level : 'guest');
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
        </div>`;
      $('[data-a="levels"]', box).onclick = async () => (await import('./vip.js')).showVipCenter();
      $('[data-a="card"]', box).onclick = showCardDialog;
      $('[data-a="agent"]', box).onclick = showAgent;
    });
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
        renderUserCard();
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

  /* ================= 数据统计（Token + 缓存 + 花费估算） ================= */
  async function showStats() {
    const total = await getTotalStats();
    const daily = await getDailyStats();
    const { usd, rows } = await getCostBreakdown();
    const rate = await usdToCnyRate().catch(() => 7.2);
    const days = Object.keys(daily).sort().slice(-14);
    const max = Math.max(1, ...days.map((d) => daily[d].prompt + daily[d].completion));
    const cacheTotal = total.prompt || 0;
    const cacheRate = cacheTotal ? Math.round(((total.cacheHit || 0) / cacheTotal) * 100) : 0;
    openOverlay({
      title: '数据统计',
      build: (body) => {
        body.innerHTML = `
          <div class="row gap8 mb16">
            <div class="card grow" style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--primary)">${fmtTokens(total.prompt + total.completion)}</div><div class="muted">总 Tokens</div></div>
            <div class="card grow" style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--primary)">${total.requests}</div><div class="muted">总请求</div></div>
            <div class="card grow" style="text-align:center"><div style="font-size:20px;font-weight:800;color:#3dd68c">${cacheRate}%</div><div class="muted">缓存命中率</div></div>
          </div>
          <div class="section-title">花费估算</div>
          <div class="card mb16">
            <div class="row gap16" style="align-items:baseline">
              <div><div style="font-size:24px;font-weight:800;color:var(--primary)">${fmtUsd(usd)}</div><div class="muted">累计估算（美元）</div></div>
              <div><div style="font-size:18px;font-weight:700">≈ ¥${(usd * rate).toFixed(2)}</div><div class="muted">按实时汇率 ${rate.toFixed(4)} 折算</div></div>
            </div>
            <div class="muted mt8" style="font-size:12px">按各厂商公开报价估算（输入 / 输出 / 缓存命中分别计价），仅供参考，实际以厂商账单为准。</div>
          </div>
          ${rows.length ? `<div class="section-title">分模型明细</div>
          <div class="col gap8 mb16">${rows.slice(0, 12).map((r) => `
            <div class="list-item">
              <div class="grow" style="min-width:0">
                <div style="font-size:13px;font-weight:600" class="ellipsis">${esc(r.key)}</div>
                <div class="muted">${fmtTokens(r.prompt)} 入 · ${fmtTokens(r.completion)} 出 · ${r.requests} 次${r.cacheHit ? ' · 缓存 ' + fmtTokens(r.cacheHit) : ''}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:13px;font-weight:700;color:var(--primary)">${r.priced ? fmtUsd(r.cost) : '—'}</div>
                ${r.priced ? `<div class="muted" style="font-size:11px">≈¥${(r.cost * rate).toFixed(3)}</div>` : '<div class="muted" style="font-size:11px">暂无报价</div>'}
              </div>
            </div>`).join('')}</div>` : ''}
          <div class="section-title">近 14 天用量</div>
          <div class="card"><div class="stats-chart">${days.map((d) => {
            const v = daily[d].prompt + daily[d].completion;
            return `<div class="stats-bar-wrap" title="${d}: ${fmtTokens(v)}"><div class="stats-bar" style="height:${Math.max(3, (v / max) * 100)}%"></div><div class="stats-day">${d.slice(8)}</div></div>`;
          }).join('')}</div></div>`;
      },
    });
  }

  /* ================= 数据管理 ================= */
  function renderData() {
    const box = $('[data-role="data"]', page);
    box.innerHTML = [
      { a: 'storage', ico: 'hdd', name: '存储管理', desc: '本地 / 云端 / 自有服务器 · 回收站' },
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

    $('[data-a="storage"]', box).onclick = async () => {
      const st = await import('./storage.js');
      st.showStorageManagement();
    };

    $('[data-a="cloud"]', box).onclick = async () => {
      const url = await kvGet('cloud:url', '');
      const key = await kvGet('cloud:key', '');
      const body = el(`<div>
        ${formRow('Supabase URL', `<input class="input" data-f="url" value="${esc(url)}" placeholder="https://xxx.supabase.co">`)}
        ${formRow('Anon Key', `<input class="input" data-f="key" value="${esc(key)}" placeholder="eyJ...">`)}
        <div class="muted">配置后重启应用生效。留空则保持纯本地模式。</div>
      </div>`);
      const m = modal({
        title: '云端同步配置', body,
        footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存</button>',
      });
      $('[data-a="cancel"]', m.mask).onclick = m.close;
      $('[data-a="save"]', m.mask).onclick = async () => {
        await kvSet('cloud:url', $('[data-f="url"]', body).value.trim());
        await kvSet('cloud:key', $('[data-f="key"]', body).value.trim());
        m.close();
        toast('已保存，即将刷新', 'ok');
        setTimeout(() => location.reload(), 800);
      };
    };

    $('[data-a="backup"]', box).onclick = async () => {
      const v = await actionSheet('本地备份 / 恢复', [
        { label: '导出备份（JSON）', value: 'export', icon: 'download' },
        { label: '从备份恢复', value: 'import', icon: 'import' },
      ]);
      if (v === 'export') {
        const data = {};
        for (const store of ['kv', 'sources', 'shelf', 'history', 'favorites', 'chats']) {
          data[store] = await db.all(store);
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `thirdhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        toast('备份已导出', 'ok');
      } else if (v === 'import') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
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

  /* ================= 服务与安全（v1.7） ================= */
  function renderServices() {
    const box = $('[data-role="services"]', page);
    box.innerHTML = [
      { a: 'vip', ico: 'crown', name: '会员中心', desc: '套餐 / 额度 / 发票 · 会员云端代理' },
      { a: 'devices', ico: 'devices', name: '多设备管理', desc: '已登录的设备与浏览器（上限 20 台）' },
      { a: 'applock', ico: 'lock', name: '应用锁', desc: '6 位数字密码或九宫格图案，进入应用需验证' },
      { a: 'secpwd', ico: 'lock', name: '二级密码', desc: '加密 API 密钥等隐私信息，丢失无法解密' },
      { a: 'devlog', ico: 'bug', name: '设备日志管理', desc: '本机运行日志抓取，用于排查 Bug' },
      { a: 'feedback', ico: 'message', name: '意见反馈', desc: '提建议 / 报 Bug，可公开讨论或仅管理员可见' },
    ].map((m) => `
      <button class="list-item" style="margin-bottom:8px;width:100%" data-a="${m.a}">
        <span class="list-ico">${icon(m.ico)}</span>
        <div class="grow" style="text-align:left;min-width:0">
          <div style="font-size:14px;font-weight:600">${m.name}</div>
          <div class="muted">${m.desc}</div>
        </div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`).join('');
    $('[data-a="vip"]', box).onclick = async () => (await import('./vip.js')).showVipCenter();
    $('[data-a="devices"]', box).onclick = async () => (await import('./devices.js')).showDevices();
    $('[data-a="applock"]', box).onclick = async () => (await import('./applock.js')).showAppLockSettings();
    $('[data-a="secpwd"]', box).onclick = async () => (await import('./keyvault.js')).showSecPwdSettings();
    $('[data-a="devlog"]', box).onclick = async () => (await import('./devlog.js')).showDevLogs();
    $('[data-a="feedback"]', box).onclick = async () => (await import('./feedback.js')).showFeedback();
  }

  /* ================= 设置 ================= */
  async function renderSettings() {
    const theme = await getSetting('theme');
    const box = $('[data-role="settings"]', page);
    const splashOn = await kvGet('splash:on', true);
    box.innerHTML = [
      { a: 'personalize', ico: 'palette', name: '个性化设置', desc: '桌面 / 移动 / 手表端导航栏样式' },
      { a: 'tabs', ico: 'grid', name: '导航栏管理', desc: '选择底部导航显示的板块（1-5 个）' },
      { a: 'theme', ico: 'moon', name: '主题外观', desc: { dark: '深色', light: '浅色', auto: '跟随系统' }[theme] || '跟随系统' },
      { a: 'splash', ico: 'splash', name: '开屏动画', desc: splashOn ? '已启用（打开应用时展示品牌动画）' : '已关闭' },
      { a: 'proxy', ico: 'globe', name: '模块代理设置', desc: '各模块独立选择直连 / 自有代理 / 云端代理' },
      { a: 'sources', ico: 'plug', name: '连接器管理', desc: '导入 / 管理内容连接器' },
      { a: 'update', ico: 'refresh', name: '检查更新', desc: '当前 v' + APP_VERSION },
      { a: 'autoupdate', ico: 'sync', name: '自动检查更新', desc: '开启后每次启动自动检查并下载新版本' },
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

    $('[data-a="personalize"]', box).onclick = showPersonalize;
    $('[data-a="theme"]', box).onclick = async () => {
      const cur = await getSetting('theme');
      const v = await actionSheet('主题外观', [
        { label: '跟随系统（默认）', value: 'auto', icon: cur === 'auto' ? 'check' : undefined },
        { label: '深色', value: 'dark', icon: cur === 'dark' ? 'check' : undefined },
        { label: '浅色', value: 'light', icon: cur === 'light' ? 'check' : undefined },
      ]);
      if (v) { await setSetting('theme', v); renderSettings(); }
    };
    $('[data-a="tabs"]', box).onclick = showTabManager;
    $('[data-a="splash"]', box).onclick = async () => {
      const cur = await kvGet('splash:on', true);
      const v = await actionSheet('开屏动画', [
        { label: '启用加载动画（每次打开展示品牌开屏）', value: 'on', icon: cur ? 'check' : undefined },
        { label: '不启用加载动画', value: 'off', icon: !cur ? 'check' : undefined },
      ]);
      if (v) { await kvSet('splash:on', v === 'on'); renderSettings(); toast(v === 'on' ? '开屏动画已启用' : '开屏动画已关闭', 'ok'); }
    };
    $('[data-a="proxy"]', box).onclick = async () => {
      const px = await import('./proxy-settings.js');
      px.showProxySettings();
    };
    $('[data-a="sources"]', box).onclick = async () => {
      const { renderCategory } = await import('./category.js');
      openOverlay({ title: '连接器管理', build: async (body) => { body.style.overflowY = 'auto'; await renderCategory(body); const h = body.querySelector('.page-head'); if (h) h.remove(); } });
    };
    $('[data-a="update"]', box).onclick = () => checkUpdate(true);
    $('[data-a="autoupdate"]', box).onclick = async () => {
      const cur = await kvGet('update:auto', true);
      const b2 = el(`<div>
        <div class="row gap8" style="align-items:center;margin-bottom:12px">
          <div class="grow"><div style="font-weight:600;font-size:14px">启动时自动检查更新</div>
          <div class="muted">每次打开应用时后台检查新版本；发现新版会自动下载安装包，下载完成后提示你安装。</div></div>
          <button class="ai-toggle ${cur ? 'on' : ''}" data-v="sw"></button>
        </div>
        <button class="btn btn-block" data-a="now">${icon('refresh')} 立即检查更新</button>
      </div>`);
      const m2 = modal({ title: '自动检查更新', body: b2, footer: '<button class="btn btn-block" data-a="c">关闭</button>' });
      $('[data-a="c"]', m2.mask).onclick = m2.close;
      $('[data-v="sw"]', b2).onclick = async (e) => {
        const on = !e.target.classList.contains('on');
        e.target.classList.toggle('on', on);
        await kvSet('update:auto', on);
        toast(on ? '已开启自动检查更新' : '已关闭自动检查更新', 'ok');
      };
      $('[data-a="now"]', b2).onclick = () => { m2.close(); checkUpdate(true); };
    };
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

  /* ================= 个性化设置（多端导航栏） ================= */
  async function showPersonalize() {
    const navD = await getSetting('navDesktop');
    const navM = await getSetting('navMobile');
    const navW = await getSetting('navWatch');
    const drawerSide = await getSetting('aiDrawerSide');
    openOverlay({
      title: '个性化设置',
      build: (body) => {
        const group = (title, key, cur, opts) => `
          <div class="section-title">${title}</div>
          <div class="nr-chip-row mb16" data-g="${key}">
            ${opts.map(([v, name]) => `<button class="ai-chip ${cur === v ? 'on' : ''}" data-v="${v}">${name}</button>`).join('')}
          </div>`;
        body.innerHTML = `
          <div class="muted" style="margin-bottom:14px;line-height:1.7">为不同设备分别设置导航栏样式，即时生效并云端同步。</div>
          ${group('桌面端导航栏', 'navDesktop', navD, [['bottom', '底部导航'], ['top', '顶部导航'], ['fold', '可折叠导航']])}
          ${group('移动端导航栏', 'navMobile', navM, [['bottom', '底部导航'], ['top', '顶部导航']])}
          ${group('手表端导航栏', 'navWatch', navW, [['bottom', '底部导航'], ['top', '顶部导航']])}
          ${group('AI 抽屉方向', 'aiDrawerSide', drawerSide, [['left', '左侧'], ['right', '右侧']])}
          <div class="muted" style="font-size:12px">手表端为屏幕宽度 &lt; 380px 的触屏设备，自动识别。</div>`;
        $$('[data-g]', body).forEach((g) => {
          const key = g.dataset.g;
          $$('.ai-chip', g).forEach((b) => b.onclick = async () => {
            await setSetting(key, b.dataset.v);
            $$('.ai-chip', g).forEach((x) => x.classList.toggle('on', x === b));
            if (key.startsWith('nav')) window.dispatchEvent(new CustomEvent('th:navpos'));
            toast('已保存');
          });
        });
      },
    });
  }

  /* ================= 阅读设置（小说 + 漫画） ================= */
  async function showReaderSettings() {
    const keys = ['readerFlip', 'readerFont', 'readerFontSize', 'readerLineHeight', 'readerTheme',
      'readerIllust', 'readerTapFlip', 'readerVolumeFlip', 'readerInfoBar', 'readerAutoScroll',
      'comicLayout', 'comicDir', 'comicFit', 'comicGap', 'comicBrightness', 'comicCropBorder', 'comicPreload'];
    const S = {};
    for (const k of keys) S[k] = await getSetting(k);
    openOverlay({
      title: '阅读设置',
      build: (body) => {
        const chipRow = (label, key, opts) => `
          <div class="muted mb8">${label}</div>
          <div class="nr-chip-row mb16" data-g="${key}">
            ${opts.map(([v, name]) => `<button class="ai-chip ${String(S[key]) === String(v) ? 'on' : ''}" data-v="${v}">${name}</button>`).join('')}
          </div>`;
        const tog = (label, key) => `
          <div class="nr-set-row"><span>${label}</span><button class="ai-toggle ${S[key] ? 'on' : ''}" data-tog="${key}"></button></div>`;
        body.innerHTML = `
          <div class="section-title">小说阅读</div>
          ${chipRow('默认翻页方式', 'readerFlip', [['scroll', '滚动'], ['slide', '左右滑动'], ['cover', '覆盖'], ['sim', '仿真'], ['none', '无动画']])}
          ${chipRow('字体', 'readerFont', [['system', '系统默认'], ['serif', '衬线'], ['sans', '无衬线'], ['kai', '楷体']])}
          ${chipRow('背景主题', 'readerTheme', [['day', '白天'], ['night', '夜间'], ['eye', '护眼'], ['paper', '羊皮纸'], ['blue', '浅蓝'], ['green', '竹绿']])}
          ${tog('显示正文插图（插图小说）', 'readerIllust')}
          ${tog('点按翻页', 'readerTapFlip')}
          ${tog('音量键翻页', 'readerVolumeFlip')}
          ${tog('底部信息栏', 'readerInfoBar')}
          <div class="muted" style="font-size:12px;margin:6px 0 16px">字号 / 行距 / 段距 / 边距 / 亮度 / 自动滚动等细项可在阅读器内「设置」中实时调整。</div>
          <div class="section-title">漫画阅读</div>
          ${chipRow('默认布局', 'comicLayout', [['paged', '单页'], ['double', '双页'], ['webtoon', '条漫（上下滚动）']])}
          ${chipRow('翻页方向', 'comicDir', [['ltr', '左翻（国漫）'], ['rtl', '右翻（日漫）']])}
          ${chipRow('图片适配', 'comicFit', [['width', '适应宽度'], ['height', '适应高度'], ['original', '原始大小']])}
          ${tog('页间留白', 'comicGap')}
          ${tog('切除白边', 'comicCropBorder')}`;
        $$('[data-g]', body).forEach((g) => {
          const key = g.dataset.g;
          $$('.ai-chip', g).forEach((b) => b.onclick = async () => {
            S[key] = b.dataset.v;
            await setSetting(key, S[key]);
            $$('.ai-chip', g).forEach((x) => x.classList.toggle('on', x === b));
          });
        });
        $$('[data-tog]', body).forEach((t) => t.onclick = async () => {
          const key = t.dataset.tog;
          S[key] = !S[key];
          t.classList.toggle('on', S[key]);
          await setSetting(key, S[key]);
        });
      },
    });
  }

  /* ================= 导航栏板块管理（1-5 个，「我的」固定） ================= */
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
              <span class="ai-toggle ${picked.has(b.id) ? 'on' : ''}"></span>
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
      const onTab = document.querySelector('#tabbar .tab.on');
      rebuildTabs(onTab ? onTab.dataset.tab : null);
    });
    modal({ title: '导航栏管理', body });
  }

  /* ================= 历史版本（时间线，仅最新版展开） ================= */
  function showChangelog() {
    const list = CHANGELOG.slice().reverse();
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

  /* ================= 管理员入口 ================= */
  function renderAdmin() {
    const box = $('[data-role="admin"]', page);
    box.innerHTML = `
      <button class="list-item" style="width:100%;border:1px solid rgba(255,199,0,.3)">
        <span class="list-ico" style="background:rgba(255,199,0,.12);color:#ffd54d">${icon('crown')}</span>
        <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:700;color:#ffd54d">管理后台</div><div class="muted">ThirdHub-Admin</div></div>
        <span class="list-arrow">${icon('arrowR')}</span>
      </button>`;
    box.firstElementChild.onclick = () => {
      window.open('admin.html', '_blank');
    };
  }
}
