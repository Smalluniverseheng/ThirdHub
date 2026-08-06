/* ===== ThirdHub js/modules/onboarding.js — 首次启动引导 =====
   陌生人首次进入（本地无任何记录）：
   ① 产品介绍的欢迎页 →「开始使用」
   ② 登录页（可跳过 = 游客模式）
   ③ 新注册用户 → 选择使用目的（即选择要启用的板块，至少 1 个、最多 5 个） */
import { $, $$, el, esc, icon, toast } from '../ui.js';
import { kvGet, kvSet } from '../store.js';
import { signIn, signUp } from '../auth.js';
import { hasCloud } from '../supabase.js';
import { BOARDS, MAX_TABS } from '../boards.js';

const INTRO_SLIDES = [
  {
    ico: 'robot', title: 'AI 助手', accent: '#3B5BFD',
    desc: '聚合全球主流大模型，打字机式流式输出，支持 MCP 工具接入与联网搜索。配置好厂商 API Key 即可使用，模型已预先配好，也可完全自定义。',
  },
  {
    ico: 'game', title: '娱乐板块', accent: '#F5A623',
    desc: '小说、漫画、音乐、有声、视频、游戏六大娱乐板块。软件不预置任何内容源，导入你自己的连接器后即可搜索、阅读、播放。',
  },
  {
    ico: 'cloud', title: '存储与云手机', accent: '#2ECC71',
    desc: '云存储多设备同步你的书架与进度；云手机（即将上线）提供 24 小时在线的云端安卓实例。每个板块完全独立，按需启用。',
  },
];

export async function maybeOnboard() {
  const done = await kvGet('onboard:done', false);
  if (done || /[?&]noob=1/.test(location.search || '')) return false;

  return new Promise((resolve) => {
    const ov = el(`<div class="ob"></div>`);
    document.body.appendChild(ov);
    const finish = async (tabs) => {
      if (tabs && tabs.length) await kvSet('ui:tabs', tabs.slice(0, MAX_TABS));
      await kvSet('onboard:done', true);
      ov.classList.add('ob-out');
      setTimeout(() => { ov.remove(); resolve(true); }, 260);
    };

    /* ---------- ① 介绍页 ---------- */
    function stepIntro(idx = 0) {
      const s = INTRO_SLIDES[idx];
      const last = idx === INTRO_SLIDES.length - 1;
      ov.innerHTML = `
        <div class="ob-inner">
          <div class="ob-hero" style="--ob-accent:${s.accent}">
            <div class="ob-hero-ico">${icon(s.ico)}</div>
          </div>
          <div class="ob-title">${s.title}</div>
          <div class="ob-desc">${s.desc}</div>
          <div class="ob-dots">${INTRO_SLIDES.map((_, i) => `<span class="ob-dot ${i === idx ? 'on' : ''}"></span>`).join('')}</div>
          <button class="btn btn-primary ob-btn" data-a="next">${last ? '开始使用' : '下一步'}</button>
          ${last ? '' : '<button class="ob-skip" data-a="skip">跳过介绍</button>'}
        </div>`;
      $('[data-a="next"]', ov).onclick = () => last ? stepAuth() : stepIntro(idx + 1);
      const skip = $('[data-a="skip"]', ov);
      if (skip) skip.onclick = () => stepAuth();
    }

    /* ---------- ② 登录页（可跳过） ---------- */
    function stepAuth() {
      ov.innerHTML = `
        <div class="ob-inner">
          <div class="ob-logo">${icon('rocket')}</div>
          <div class="ob-title">登录 ThirdHub</div>
          <div class="ob-desc">登录后可使用云端同步、会员存储与多设备互通。<br>也可以跳过，先以游客身份体验。</div>
          ${hasCloud() ? `
          <div class="ob-form">
            <input class="input" type="email" data-f="email" placeholder="邮箱">
            <input class="input" type="password" data-f="pwd" placeholder="密码（至少 6 位）">
            <div class="row gap8">
              <button class="btn grow" data-a="reg">注册</button>
              <button class="btn btn-primary grow" data-a="login">登录</button>
            </div>
          </div>` : '<div class="muted" style="font-size:12.5px;margin-bottom:14px">云端未配置，当前仅支持游客模式</div>'}
          <button class="ob-skip" data-a="guest">跳过，以游客身份进入 →</button>
        </div>`;
      const email = () => $('[data-f="email"]', ov).value.trim();
      const pwd = () => $('[data-f="pwd"]', ov).value;
      const loginBtn = $('[data-a="login"]', ov);
      if (loginBtn) loginBtn.onclick = async () => {
        try {
          await signIn(email(), pwd());
          toast('登录成功', 'ok');
          finish(await kvGet('ui:tabs', ['ai'])); // 老用户：沿用已有板块或默认 AI
        } catch (e) { toast(e.message || '登录失败', 'err'); }
      };
      const regBtn = $('[data-a="reg"]', ov);
      if (regBtn) regBtn.onclick = async () => {
        try {
          await signUp(email(), pwd());
          toast('注册成功', 'ok');
          stepPurpose(); // 新用户：选择使用目的
        } catch (e) { toast(e.message || '注册失败', 'err'); }
      };
      $('[data-a="guest"]', ov).onclick = () => finish(['ai']); // 游客默认 AI 板块
    }

    /* ---------- ③ 使用目的（新用户）= 选择启用的板块 ---------- */
    function stepPurpose() {
      const picked = new Set(['ai']);
      ov.innerHTML = `
        <div class="ob-inner ob-wide">
          <div class="ob-title">你想用 ThirdHub 做什么？</div>
          <div class="ob-desc">选择你感兴趣的板块，选中的板块会出现在底部导航栏。<br>至少 1 个、最多 ${MAX_TABS} 个，之后可随时在「我的 → 导航栏管理」中调整。</div>
          <div class="ob-grid">
            ${BOARDS.map((b) => `
              <button class="ob-board ${b.id === 'ai' ? 'on' : ''}" data-b="${b.id}">
                <span class="ob-board-ico">${icon(b.ico)}</span>
                <span class="ob-board-name">${b.name}</span>
                <span class="ob-board-desc">${esc(b.desc)}</span>
                <span class="ob-board-check">${icon('check')}</span>
              </button>`).join('')}
          </div>
          <div class="ob-count">已选 <b data-v="n">1</b> / ${MAX_TABS} 个板块</div>
          <button class="btn btn-primary ob-btn" data-a="done">完成，进入 ThirdHub</button>
        </div>`;
      $$('.ob-board', ov).forEach((b) => b.onclick = () => {
        const id = b.dataset.b;
        if (picked.has(id)) {
          if (picked.size <= 1) return toast('至少保留 1 个板块');
          picked.delete(id); b.classList.remove('on');
        } else {
          if (picked.size >= MAX_TABS) return toast(`最多选择 ${MAX_TABS} 个板块`);
          picked.add(id); b.classList.add('on');
        }
        $('[data-v="n"]', ov).textContent = picked.size;
      });
      $('[data-a="done"]', ov).onclick = () => finish([...picked]);
    }

    stepIntro();
  });
}
