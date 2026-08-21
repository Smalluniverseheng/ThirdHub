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

/* 安卓 App 内隐藏「下载安卓版」入口 */
const IN_APP = (() => { try { return !!(window.ThirdHubNative && window.ThirdHubNative.isNative && window.ThirdHubNative.isNative()); } catch (e) { return false; } })();

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

  async function showAuthDialog() {
    /* v3.1：云端库可能因弱网尚未就绪，点击登录时先补一次初始化再判断 */
    if (!hasCloud()) {
      try { const { initCloud } = await import('../supabase.js'); await initCloud(); } catch (e) {}
    }
    if (!hasCloud()) {
      modal({
        title: '云端连接失败', center: true,
        body: '<p style="font-size:14px;line-height:1.8;color:var(--text-secondary)">云端服务暂时连不上，请检查网络后重试。仍失败可到「数据管理 → 云端同步」检查配置。</p>',
      });
      return;
    }
    const body = el(`<div>
      ${formRow('邮箱', '<input class="input" type="email" data-f="email" placeholder="you@example.com">')}
      ${formRow('密码', '<input class="input" type="password" data-f="pwd" placeholder="至少 6 位">')}
      <div style="display:flex;justify-content:flex-end;margin:-2px 0 8px">
        <button class="login-forgot" data-a="forgot">忘记密码？</button>
      </div>
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
    /* v2.x：忘记密码 → 邮箱验证码找回子页面 */
    $('[data-a="forgot"]', m.mask).onclick = () => {
      m.close();
      showForgotPage();
    };
  }

  /* ================= 忘记密码：邮箱验证码找回子页面 ================= */
  function showForgotPage() {
    const body = el(`<div>
      <div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:12px">输入注册邮箱，获取验证码验证身份后，系统会向该邮箱发送密码重置链接。</div>
      <div class="col gap8">
        <input class="input" type="email" data-f="email" placeholder="注册邮箱">
        <div class="row gap8">
          <input class="input grow" data-f="code" placeholder="6 位验证码" maxlength="6" inputmode="numeric">
          <button class="btn" data-a="send" style="flex:none;min-width:88px">获取验证码</button>
        </div>
        <button class="btn btn-primary" data-a="go">验证并发送重置链接</button>
      </div>
    </div>`);
    const ref = modal({ title: '找回密码', body });
    const sendBtn = $('[data-a="send"]', body);
    const goBtn = $('[data-a="go"]', body);
    const emailOk = () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test($('[data-f="email"]', body).value.trim());
    sendBtn.onclick = async () => {
      if (!emailOk()) return toast('请先填写正确的邮箱', 'err');
      sendBtn.disabled = true; sendBtn.textContent = '发送中…';
      try {
        const { sendEmailCode } = await import('../email-code.js');
        await sendEmailCode($('[data-f="email"]', body).value.trim());
        toast('验证码已发送', 'ok');
        let n = 59;
        const t = setInterval(() => {
          sendBtn.textContent = n > 0 ? `重新发送（${n}s）` : '重新发送';
          sendBtn.disabled = n > 0;
          if (n <= 0) clearInterval(t);
          n--;
        }, 1000);
      } catch (e) { sendBtn.disabled = false; sendBtn.textContent = '获取验证码'; toast(e.message || '发送失败', 'err'); }
    };
    goBtn.onclick = async () => {
      if (!emailOk()) return toast('请先填写正确的邮箱', 'err');
      goBtn.disabled = true; goBtn.textContent = '验证中…';
      try {
        const { verifyEmailCode } = await import('../email-code.js');
        await verifyEmailCode($('[data-f="email"]', body).value.trim(), $('[data-f="code"]', body).value.trim());
        const { sendPasswordReset } = await import('../auth.js');
        await sendPasswordReset($('[data-f="email"]', body).value.trim());
        ref.close();
        modal({
          title: '重置链接已发送', center: true,
          body: '<p style="font-size:14px;line-height:1.8;color:var(--text-secondary)">邮箱验证通过！密码重置链接已发送至你的邮箱，请查收邮件并点击链接设置新密码。</p>',
        });
      } catch (e) { goBtn.disabled = false; goBtn.textContent = '验证并发送重置链接'; toast(e.message || '验证失败', 'err'); }
    };
  }

  /* ================= 个人资料子页面（含会员中心） ================= */
  async function showProfileSubpage() {
    const u = await currentUser();
    if (!u) return;
    const lv = levelById(u.level);
    const ref = openOverlay({
      title: '个人资料',
      float: true, /* v5.9：桌面端呈居中浮窗（背景模糊 + 圆角面板 + 配套返回键），移动端保持全屏 */
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

        /* v6.0：头像选择器（官方内置 10 款 + 本地上传） */
        $('#pf-avatar', body).onclick = () => showAvatarPicker(body, u);
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


/* v6.0：官方内置头像（SVG data URI，离线可用）+ 本地上传 */
const OFFICIAL_AVATARS = [{"id":"brand","bg":"#3b5bfd","label":"品牌"},{"id":"cosmos","bg":"#7c3aed","label":"星云"},{"id":"sunset","bg":"#f97316","label":"落日"},{"id":"ocean","bg":"#0ea5e9","label":"海洋"},{"id":"forest","bg":"#22c55e","label":"森林"},{"id":"rose","bg":"#ec4899","label":"玫瑰"},{"id":"amber","bg":"#f59e0b","label":"琥珀"},{"id":"slate","bg":"#64748b","label":"石墨"},{"id":"crimson","bg":"#ef4444","label":"绯红"},{"id":"teal","bg":"#14b8a6","label":"青碧"}].map((a) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" rx="28" fill="' + a.bg + '"/>' +
    '<circle cx="64" cy="50" r="24" fill="rgba(255,255,255,.85)"/>' +
    '<path d="M22 118c4-26 20-38 42-38s38 12 42 38" fill="rgba(255,255,255,.85)"/>' +
    '</svg>';
  return { id: a.id, label: a.label, url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
});
function showAvatarPicker(body, u) {
  const m = modal({
    title: '选择头像',
    body: el('<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:4px"></div>'),
  });
  const grid = m.bodyEl;
  OFFICIAL_AVATARS.forEach((a) => {
    const b = el('<button class="vip-card" style="border-radius:50%;overflow:hidden;padding:0;aspect-ratio:1;border:2px solid var(--border);cursor:pointer" title="' + esc(a.label) + '"><img src="' + a.url + '" style="width:100%;height:100%;display:block"></button>');
    b.onclick = async () => {
      await updateProfile({ avatar: a.url });
      u.avatar = a.url;
      $('#pf-avatar', body).innerHTML = '<img src="' + a.url + '"><span class="avatar-edit-badge">' + icon('camera') + '</span>';
      m.close();
      toast('头像已更新', 'ok');
    };
    grid.appendChild(b);
  });
  const up = el('<button class="vip-card" style="border-radius:14px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer"><span style="font-size:26px">📷</span><span class="muted" style="font-size:11px">上传图片</span></button>');
  up.onclick = () => {
    m.close();
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const url = await downscaleImage(f, 128);
        await updateProfile({ avatar: url });
        u.avatar = url;
        $('#pf-avatar', body).innerHTML = '<img src="' + url + '"><span class="avatar-edit-badge">' + icon('camera') + '</span>';
        toast('头像已更新', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    input.click();
  };
  grid.appendChild(up);
}
  /* ================= 数据管理 ================= */
  function renderData() {
    const box = $('[data-role="data"]', page);
    box.innerHTML = [
      { a: 'storage', ico: 'hdd', name: '存储管理', desc: '本地 / 云端同步 / 备份恢复 · 回收站' },
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
      ...(IN_APP ? [] : [{ a: 'apk', ico: 'download', name: '下载 APP', desc: '安卓 / 桌面 / 插件安装包' }]),
      { a: 'about', ico: 'info', name: '关于 ThirdHub', desc: '版本 / 更新 / 许可' },
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
    $('[data-a="apk"]', box).onclick = () => { const ob = document.getElementById('overlay-root'); showDownloadPage(); };

    $('[data-a="about"]', box).onclick = () => showAboutPage();

    /* v5.3：关于页（模块介绍 / 开源致谢 / 云存储实时用量） */
    function showAboutPage() {
      openOverlay({
        title: '关于 ThirdHub',
        build: async (body) => {
          const u = await currentUser();
          const lv = levelById(u ? u.level : 'guest');
          body.innerHTML = `
            <div style="text-align:center;padding:14px 0 6px">
              <img src="icons/launcher.png" style="width:64px;height:64px;border-radius:18px;box-shadow:var(--shadow-card)">
              <div style="font-size:18px;font-weight:800;margin-top:10px">第三方科技 · ThirdHub</div>
              <div class="muted">v${APP_VERSION} · MIT License</div>
              <div class="muted" style="max-width:320px;margin:8px auto 0;line-height:1.8">全平台智能聚合平台。软件不预置任何内容源，所有内容接入能力由用户自行导入配置后启用。</div>
            </div>
            <div class="col gap8" style="margin-top:16px">
              <button class="list-item" style="width:100%" data-a="storage">
                <span class="list-ico">${icon('cloud')}</span>
                <div class="grow" style="text-align:left;min-width:0">
                  <div style="font-size:14px;font-weight:600">云存储用量</div>
                  <div class="muted" data-role="storage-text">${u ? fmtBytes(u.storageUsed || 0) + ' / ' + (lv.storage === Infinity ? '无限' : fmtBytes(lv.storage)) : '未登录'}</div>
                </div>
                <span class="list-arrow">${icon('refresh')}</span>
              </button>
              <button class="list-item" style="width:100%" data-a="checkupd">
                <span class="list-ico">${icon('refresh')}</span>
                <div class="grow" style="text-align:left;min-width:0">
                  <div style="font-size:14px;font-weight:600">检查更新</div>
                  <div class="muted" data-role="curver">当前 v${APP_VERSION}</div>
                </div>
                <span class="list-arrow">${icon('arrowR')}</span>
              </button>
              <button class="list-item" style="width:100%" data-a="version">
                <span class="list-ico">${icon('sync')}</span>
                <div class="grow" style="text-align:left;min-width:0">
                  <div style="font-size:14px;font-weight:600">版本与更新设置</div>
                  <div class="muted">自动检查开关 · 当前版本号 · 更新说明</div>
                </div>
                <span class="list-arrow">${icon('arrowR')}</span>
              </button>
              <button class="list-item" style="width:100%" data-a="modules">
                <span class="list-ico">${icon('grid')}</span>
                <div class="grow" style="text-align:left;min-width:0">
                  <div style="font-size:14px;font-weight:600">模块介绍</div>
                  <div class="muted">AI 对话 / 阅读 / 算力 / 社区 / 搜索 / 存储…</div>
                </div>
                <span class="list-arrow">${icon('arrowR')}</span>
              </button>
              <button class="list-item" style="width:100%" data-a="credits">
                <span class="list-ico">${icon('heart')}</span>
                <div class="grow" style="text-align:left;min-width:0">
                  <div style="font-size:14px;font-weight:600">开源致谢</div>
                  <div class="muted">向我们借鉴与集成的开源项目致敬</div>
                </div>
                <span class="list-arrow">${icon('arrowR')}</span>
              </button>
              <button class="list-item" style="width:100%" data-a="changelog">
                <span class="list-ico">${icon('history')}</span>
                <div class="grow" style="text-align:left;min-width:0">
                  <div style="font-size:14px;font-weight:600">版本历史</div>
                  <div class="muted">从 v1.0 到 v${APP_VERSION}</div>
                </div>
                <span class="list-arrow">${icon('arrowR')}</span>
              </button>
            </div>`;
          $('[data-a="storage"]', body).onclick = async () => {
            toast('正在刷新用量…');
            try { const { refreshProfile } = await import('../auth.js'); const nu = await refreshProfile(); if (nu) toast('云存储：' + fmtBytes(nu.storageUsed || 0), 'ok'); } catch (e) { toast('刷新失败：' + e.message, 'err'); }
          };
          $('[data-a="modules"]', body).onclick = async () => {
            const { BOARDS, PROFILE_BOARD } = await import('../boards.js');
            openOverlay({
              title: '模块介绍',
              build: (b2) => {
                const all = [...BOARDS, PROFILE_BOARD];
                b2.innerHTML = `<div class="col gap8">${all.map((b) => `
                  <div class="card" style="padding:12px">
                    <div style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px">${icon(b.ico)}<span>${b.name}</span></div>
                    <div class="muted" style="font-size:12.5px;margin-top:4px;line-height:1.7">${esc(b.desc || '')}</div>
                  </div>`).join('')}</div>`;
              },
            });
          };
          $('[data-a="credits"]', body).onclick = () => {
            const CREDITS = [
              ['DeepSeek Harness', '本地算力内核：Agent 运行时、工具链与 MCP 客户端（MIT）', 'https://github.com/deepseek-ai/deepseek-harness'],
              ['Supabase', '云端同步与实时能力（开源 PostgreSQL 后端，Apache-2.0）', 'https://supabase.com'],
              ['LobeHub Icons', '厂商品牌图标库（MIT）', 'https://github.com/lobehub/lobe-icons'],
              ['Simple Icons', '品牌图标（CC0）', 'https://simpleicons.org'],
              ['Phosphor Icons', '界面图标（MIT）', 'https://phosphoricons.com'],
              ['Cloudflare Pages', '全球 CDN 静态托管与边缘计算', 'https://pages.cloudflare.com'],
              ['MCP 协议', '模型上下文协议（Model Context Protocol）', 'https://modelcontextprotocol.io'],
            ];
            openOverlay({
              title: '开源致谢',
              build: (b2) => {
                b2.innerHTML = `<div class="col gap8">${CREDITS.map(([n, d, u]) => `
                  <div class="card" style="padding:12px">
                    <div style="font-size:14px;font-weight:700">${esc(n)}</div>
                    <div class="muted" style="font-size:12px;line-height:1.6;margin-top:2px">${esc(d)}</div>
                    ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--primary)">${esc(u)} ↗</a>` : ''}
                  </div>`).join('')}</div>`;
              },
            });
          };
          $('[data-a="checkupd"]', body).onclick = () => checkUpdate(true);
          /* v5.6：进入关于页自动对比版本并显示状态 */
          (async () => {
            const cv = $('[data-role="curver"]', body);
            if (!cv) return;
            try {
              const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
              if (r.ok) {
                const vj = await r.json();
                if (vj && vj.version && vj.version !== '${APP_VERSION}') {
                  cv.innerHTML = '发现新版本 v' + esc(vj.version) + '！点击查看更新';
                  cv.style.color = 'var(--primary)';
                } else cv.textContent = '当前已是最新版本 v${APP_VERSION}';
              }
            } catch (e) {}
          })();
          $('[data-a="version"]', body).onclick = () => {
            openOverlay({
              title: '版本与更新设置',
              build: (b2) => {
                kvGet('update:auto', true).then((on) => {
                  b2.innerHTML = `
                    <div class="card" style="padding:14px;margin-bottom:12px">
                      <div style="font-size:14px;font-weight:700">当前版本</div>
                      <div style="font-size:28px;font-weight:800;margin:8px 0 2px">v${APP_VERSION}</div>
                      <div class="muted" style="font-size:12px">ThirdHub · 第三方科技</div>
                    </div>
                    <div class="nr-set-row"><span>启动时自动检查更新</span><button class="ai-toggle ${on ? 'on' : ''}" data-v="sw"></button></div>
                    <div class="muted" style="font-size:12px;line-height:1.7;margin:8px 2px 14px">开启后每次打开应用后台检查新版本；发现新版会弹出更新公告并提示刷新。</div>
                    <button class="btn btn-primary" style="width:100%" data-a="now">${icon('refresh')} 立即检查更新</button>
                    <button class="btn" style="width:100%;margin-top:8px" data-a="hist">${icon('history')} 历史版本</button>
                  `;
                  $('[data-v="sw"]', b2).onclick = async (e) => {
                    const nxt = !e.target.classList.contains('on');
                    e.target.classList.toggle('on', nxt);
                    await kvSet('update:auto', nxt);
                    toast(nxt ? '自动检查已开启' : '自动检查已关闭', 'ok');
                  };
                  $('[data-a="now"]', b2).onclick = () => checkUpdate(true);
                  $('[data-a="hist"]', b2).onclick = showChangelog;
                });
              },
            });
          };
          $('[data-a="changelog"]', body).onclick = showChangelog;
        },
      });
    }
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
          ${group('桌面端导航栏', 'navDesktop', navD, [['bottom', '左侧导航（默认）'], ['top', '顶部导航'], ['fold', '可折叠导航']])}
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

  /* ================= 阅读设置（v5.6：小说 / 漫画分设 + 连接器管理 + 更多） ================= */
  async function showReaderSettings() {
    openOverlay({
      title: '阅读设置',
      build: (body) => {
        body.innerHTML = `<div class="col gap8">
          <button class="list-item" style="width:100%" data-a="novel">
            <span class="list-ico">${icon('book')}</span>
            <div class="grow" style="text-align:left;min-width:0"><div style="font-size:14px;font-weight:600">小说设置</div><div class="muted">翻页 / 字体 / 主题 / 连接器管理 / 历史记录</div></div>
            <span class="list-arrow">${icon('arrowR')}</span>
          </button>
          <button class="list-item" style="width:100%" data-a="comic">
            <span class="list-ico">${icon('comic')}</span>
            <div class="grow" style="text-align:left;min-width:0"><div style="font-size:14px;font-weight:600">漫画设置</div><div class="muted">布局 / 翻向 / 适配 / 留白</div></div>
            <span class="list-arrow">${icon('arrowR')}</span>
          </button>
        </div>`;
        $('[data-a="novel"]', body).onclick = () => showNovelSettings();
        $('[data-a="comic"]', body).onclick = () => showComicSettings();
      },
    });
  }
  async function showNovelSettings() {
    const keys = ['readerFlip', 'readerFont', 'readerFontSize', 'readerLineHeight', 'readerTheme', 'readerIllust', 'readerTapFlip', 'readerVolumeFlip', 'readerInfoBar', 'readerAutoScroll'];
    const S = {};
    for (const k of keys) S[k] = await getSetting(k);
    const histMax = await kvGet('history:max', 100);
    openOverlay({
      title: '小说设置',
      build: (body) => {
        const chipRow = (label, key, opts) => `
          <div class="muted mb8">${label}</div>
          <div class="nr-chip-row mb16" data-g="${key}">
            ${opts.map(([v, name]) => `<button class="ai-chip ${String(S[key]) === String(v) ? 'on' : ''}" data-v="${v}">${name}</button>`).join('')}
          </div>`;
        const tog = (label, key) => `
          <div class="nr-set-row"><span>${label}</span><button class="ai-toggle ${S[key] ? 'on' : ''}" data-tog="${key}"></button></div>`;
        body.innerHTML = `
          <div class="section-title">阅读</div>
          ${chipRow('默认翻页方式', 'readerFlip', [['scroll', '滚动'], ['slide', '左右滑动'], ['cover', '覆盖'], ['sim', '仿真'], ['none', '无动画']])}
          ${chipRow('字体', 'readerFont', [['system', '系统默认'], ['serif', '衬线'], ['sans', '无衬线'], ['kai', '楷体']])}
          ${chipRow('背景主题', 'readerTheme', [['day', '白天'], ['night', '夜间'], ['eye', '护眼'], ['paper', '羊皮纸'], ['blue', '浅蓝'], ['green', '竹绿']])}
          ${tog('显示正文插图（插图小说）', 'readerIllust')}
          ${tog('点按翻页', 'readerTapFlip')}
          ${tog('音量键翻页', 'readerVolumeFlip')}
          ${tog('底部信息栏', 'readerInfoBar')}
          <div class="muted" style="font-size:12px;margin:6px 0 8px">字号 / 行距 / 段距 / 边距 / 亮度 / 自动滚动等细项可在阅读器内「设置」中实时调整。</div>
          <div class="section-title">数据</div>
          <button class="list-item" style="width:100%;margin-bottom:8px" data-a="conn">
            <span class="list-ico">${icon('plug')}</span>
            <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">连接器管理</div><div class="muted">导入 / 管理小说等连接器</div></div>
            <span class="list-arrow">${icon('arrowR')}</span>
          </button>
          <div class="nr-set-row"><span>历史记录最多保存</span><span class="row gap8">${[50, 100, 200, 500].map((v) => `<button class="ai-chip ${histMax === v ? 'on' : ''}" data-hist="${v}">${v} 条</button>`).join('')}</span></div>
        `;
        $$('[data-g]', body).forEach((g) => {
          const key = g.dataset.g;
          $$('.ai-chip', g).forEach((b) => b.onclick = async () => { S[key] = b.dataset.v; await setSetting(key, S[key]); $$('.ai-chip', g).forEach((x) => x.classList.toggle('on', x === b)); });
        });
        $$('[data-tog]', body).forEach((t2) => t2.onclick = async () => { const key = t2.dataset.tog; S[key] = !S[key]; t2.classList.toggle('on', S[key]); await setSetting(key, S[key]); });
        $('[data-a="conn"]', body).onclick = async () => {
          const { renderCategory } = await import('./category.js');
          openOverlay({ title: '连接器管理', build: async (b2) => { b2.style.overflowY = 'auto'; await renderCategory(b2); const h = b2.querySelector('.page-head'); if (h) h.remove(); } });
        };
        $$('[data-hist]', body).forEach((b) => b.onclick = async () => {
          await kvSet('history:max', +b.dataset.hist);
          $$('[data-hist]', body).forEach((x) => x.classList.toggle('on', x === b));
          toast('历史记录上限已设为 ' + b.dataset.hist + ' 条', 'ok');
        });
      },
    });
  }
  async function showComicSettings() {
    const keys = ['comicLayout', 'comicDir', 'comicFit', 'comicGap', 'comicBrightness', 'comicCropBorder', 'comicPreload'];
    const S = {};
    for (const k of keys) S[k] = await getSetting(k);
    openOverlay({
      title: '漫画设置',
      build: (body) => {
        const chipRow = (label, key, opts) => `
          <div class="muted mb8">${label}</div>
          <div class="nr-chip-row mb16" data-g="${key}">
            ${opts.map(([v, name]) => `<button class="ai-chip ${String(S[key]) === String(v) ? 'on' : ''}" data-v="${v}">${name}</button>`).join('')}
          </div>`;
        const tog = (label, key) => `
          <div class="nr-set-row"><span>${label}</span><button class="ai-toggle ${S[key] ? 'on' : ''}" data-tog="${key}"></button></div>`;
        body.innerHTML = `
          ${chipRow('默认布局', 'comicLayout', [['paged', '单页'], ['double', '双页'], ['webtoon', '条漫（上下滚动）']])}
          ${chipRow('翻页方向', 'comicDir', [['ltr', '左翻（国漫）'], ['rtl', '右翻（日漫）']])}
          ${chipRow('图片适配', 'comicFit', [['width', '适应宽度'], ['height', '适应高度'], ['original', '原始大小']])}
          ${tog('页间留白', 'comicGap')}
          ${tog('切除白边', 'comicCropBorder')}
          ${chipRow('预加载页数', 'comicPreload', [[1, '1 页'], [3, '3 页'], [5, '5 页'], [10, '10 页']])}
        `;
        $$('[data-g]', body).forEach((g) => {
          const key = g.dataset.g;
          $$('.ai-chip', g).forEach((b) => b.onclick = async () => { S[key] = b.dataset.v; await setSetting(key, S[key]); $$('.ai-chip', g).forEach((x) => x.classList.toggle('on', x === b)); });
        });
        $$('[data-tog]', body).forEach((t2) => t2.onclick = async () => { const key = t2.dataset.tog; S[key] = !S[key]; t2.classList.toggle('on', S[key]); await setSetting(key, S[key]); });
      },
    });
  }

  /* ================= 导航栏板块管理（v6.1：分端设置 + 数量不限，「我的」固定） ================= */
  async function showTabManager() {
    const { MIN_TABS } = await import('../boards.js');
    const DEV_TABS = [
      { id: 'mobile', name: '📱 移动端', key: 'nav:tabs-mobile', desc: '手机 / 折叠屏外屏' },
      { id: 'desktop', name: '🖥️ 桌面端', key: 'nav:tabs-desktop', desc: '电脑 / 平板（宽屏）' },
      { id: 'watch', name: '⌚ 手表端', key: 'nav:tabs-watch', desc: '超小屏触屏设备' },
    ];
    let curDev = 'mobile';
    const picked = new Map(); // dev -> Set

    const body = el('<div></div>');
    async function render() {
      const { BOARDS: B } = await import('../boards.js');
      const list = B.filter((b) => !['novel', 'comic', 'audio'].includes(b.id));
      const active = DEV_TABS.find((d) => d.id === curDev);
      const set = picked.get(curDev) || new Set();
      body.innerHTML = `
        <div class="muted" style="margin-bottom:10px;line-height:1.7">为不同设备分别设置导航栏板块（数量不限，导航可滑动 / 滚动）。未勾选的板块不加载。「我的」固定显示。</div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          ${DEV_TABS.map((d) => `<button class="ai-chip ${d.id === curDev ? 'on' : ''}" data-dev="${d.id}">${d.name}</button>`).join('')}
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">${esc(active.desc)} · 已选 <b data-v="n">${set.size}</b> 个板块</div>
        <div class="col gap8">
          ${list.map((b) => `
            <button class="list-item" style="width:100%" data-b="${b.id}">
              <span class="list-ico">${icon(b.ico)}</span>
              <div class="grow" style="text-align:left;min-width:0">
                <div style="font-size:14px;font-weight:600">${b.name}</div>
                <div class="muted ellipsis">${esc(b.desc)}</div>
              </div>
              <span class="ai-toggle ${set.has(b.id) ? 'on' : ''}"></span>
            </button>`).join('')}
        </div>`;
      $$('[data-dev]', body).forEach((d) => d.onclick = () => { curDev = d.dataset.dev; render(); });
      $$('[data-b]', body).forEach((b) => b.onclick = async () => {
        const id = b.dataset.b;
        const s = picked.get(curDev) || new Set();
        if (s.has(id)) {
          if (s.size <= MIN_TABS) return toast('至少保留 1 个板块');
          s.delete(id);
        } else s.add(id);
        picked.set(curDev, s);
        await kvSet(active.key, [...s]);
        render();
        const { rebuildTabs } = await import('../app.js');
        const onTab = document.querySelector('#tabbar .tab.on');
        rebuildTabs(onTab ? onTab.dataset.tab : null);
      });
    }
    /* 预载当前各端配置后弹窗 */
    (async () => {
      const legacy = await kvGet('ui:tabs', ['ai', 'search', 'read']);
      for (const d of DEV_TABS) {
        const v = await kvGet(d.key, null);
        picked.set(d.id, new Set(Array.isArray(v) ? v : legacy));
      }
      const { getDevice } = await import('../device-adapt.js');
      const dev = getDevice();
      curDev = dev === 'watch' ? 'watch' : (dev === 'desktop' ? 'desktop' : 'mobile');
      await render();
      modal({ title: '导航栏管理', body });
    })();
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
