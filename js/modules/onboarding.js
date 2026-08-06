/* ===== ThirdHub js/modules/onboarding.js — 首次启动引导（v1.5） =====
   陌生人首次进入（本地无任何记录）：
   ① 产品介绍落地页（ hero + 环绕模型 Logo + 能力 + 模型库 + FAQ ）
   ② 登录页（可跳过 = 游客模式；注册 → 独立子页面，昵称 + 真实邮箱验证码）
   ③ 新注册用户 → 选择使用目的（即选择要启用的板块，至少 1 个、最多 5 个） */
import { $, $$, el, esc, icon, toast } from '../ui.js';
import { kvGet, kvSet } from '../store.js';
import { signIn } from '../auth.js';
import { hasCloud } from '../supabase.js';
import { BOARDS, MAX_TABS } from '../boards.js';
import { vendorIcon } from '../ai/vendors.js';
import { showRegisterPage } from './register-page.js';

const ORBIT_VENDORS = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'moonshot', 'aliyun', 'zhipu'];
const ORBIT_VENDORS_2 = ['bytedance', 'xiaomi', 'minimax', 'tencent', 'groq'];

const FEATURES = [
  { ico: 'robot', title: 'AI 助手', desc: '聚合全球 33 家厂商 300+ 大模型，打字机流式输出、深度思考展示、MCP 工具与联网搜索。' },
  { ico: 'books', title: '娱乐聚合', desc: '小说、漫画、音乐、有声、视频、游戏。不预置任何内容源，导入你自己的连接器即可使用。' },
  { ico: 'cloud', title: '云端同步', desc: '书架、进度、会话多设备同步，注册即送免费云存储空间。' },
  { ico: 'shield', title: '隐私优先', desc: '数据默认保存在本地，API Key 只存在你的设备上，绝不上传。' },
];
const MODEL_CHIPS = ['GPT-5', 'Claude Opus 4.1', 'Gemini 3 Pro', 'Grok 4.1', 'DeepSeek V3.2', 'Kimi K2', 'Qwen3 Max', 'GLM-4.6', 'MiMo v2.5', '豆包 Seed 1.6', 'MiniMax M2', '混元 T1', 'Sora 2', 'Veo 3', 'Seedream 4.0', 'Hailuo 02', '万相 2.1', 'Suno'];
const FAQS = [
  { q: 'ThirdHub 是免费的吗？', a: '应用完全免费开源（MIT License）。AI 对话使用你自己的 API Key，费用与厂商直接结算；会员仅扩容云存储。' },
  { q: '为什么软件里没有任何内容？', a: 'ThirdHub 不预置任何内容源，这是一个设计原则。你可以在「连接器管理」中导入自己信任的内容连接器，导入后即可搜索、阅读、播放。' },
  { q: '我的 API Key 安全吗？', a: 'Key 只保存在你设备的本地数据库中，所有请求直接从你的浏览器发往厂商接口，不经过任何中间服务器。' },
  { q: '支持哪些设备？', a: '网页版支持桌面、手机、手表浏览器，另有 Android 客户端。添加到底层主屏幕后可作为 PWA 离线使用。' },
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

    /* ---------- ① 产品落地页 ---------- */
    function stepLanding() {
      const ring = (vendors, r, dur, rev) => `
        <div class="obl-ring" style="--r:${r}px;--dur:${dur}s">
          ${vendors.map((v, i) => `
            <span class="obl-badge ${rev ? 'rev' : ''}" style="--a0:${(360 / vendors.length) * i}deg;--r:${r}px;--dur:${dur}s">${vendorIcon(v)}</span>`).join('')}
        </div>`;
      ov.innerHTML = `
        <div class="ob-landing">
          <div class="obl-hero">
            <div class="obl-orbit">
              ${ring(ORBIT_VENDORS, 120, 36, false)}
              ${ring(ORBIT_VENDORS_2, 72, 24, true)}
              <div class="obl-core">${icon('robot')}</div>
            </div>
            <div class="obl-title">ThirdHub</div>
            <div class="obl-tag">一个入口 · 连接所有 AI 与内容</div>
            <div class="obl-cta">
              <button class="btn btn-primary ob-btn" data-a="go">开始体验</button>
              <button class="ob-skip" data-a="guest">先看看，不登录 →</button>
            </div>
          </div>
          <div class="obl-sec">
            <div class="obl-sec-title">能做什么</div>
            <div class="obl-feats">
              ${FEATURES.map((f) => `
                <div class="obl-feat">
                  <span class="obl-feat-ico">${icon(f.ico)}</span>
                  <div class="obl-feat-t">${f.title}</div>
                  <div class="obl-feat-d">${f.desc}</div>
                </div>`).join('')}
            </div>
          </div>
          <div class="obl-sec">
            <div class="obl-sec-title">模型库</div>
            <div class="obl-chips">${MODEL_CHIPS.map((m) => `<span class="obl-chip">${esc(m)}</span>`).join('')}</div>
            <div class="muted" style="font-size:12px;margin-top:8px">33 家厂商 · 300+ 模型 · 持续同步更新</div>
          </div>
          <div class="obl-sec">
            <div class="obl-sec-title">常见问题</div>
            ${FAQS.map((f) => `
              <details class="obl-faq"><summary>${esc(f.q)}</summary><div class="obl-faq-a">${esc(f.a)}</div></details>`).join('')}
          </div>
          <div class="obl-sec" style="text-align:center;padding-bottom:40px">
            <button class="btn btn-primary ob-btn" data-a="go2">立即开始</button>
            <div class="muted" style="font-size:12px;margin-top:14px">第三方科技 · MIT License · 不预置任何内容源</div>
          </div>
        </div>`;
      $('[data-a="go"]', ov).onclick = stepAuth;
      $('[data-a="go2"]', ov).onclick = stepAuth;
      $('[data-a="guest"]', ov).onclick = () => finish(['ai']);
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
              <button class="btn grow" data-a="reg">注册新账号</button>
              <button class="btn btn-primary grow" data-a="login">登录</button>
            </div>
          </div>` : '<div class="muted" style="font-size:12.5px;margin-bottom:14px">云端未配置，当前仅支持游客模式</div>'}
          <button class="ob-skip" data-a="guest">跳过，以游客身份进入 →</button>
        </div>`;
      const emailEl = $('[data-f="email"]', ov);
      const pwdEl = $('[data-f="pwd"]', ov);
      const loginBtn = $('[data-a="login"]', ov);
      if (loginBtn) loginBtn.onclick = async () => {
        try {
          await signIn(emailEl.value.trim(), pwdEl.value);
          toast('登录成功', 'ok');
          finish(await kvGet('ui:tabs', ['ai']));
        } catch (e) { toast(e.message || '登录失败', 'err'); }
      };
      const regBtn = $('[data-a="reg"]', ov);
      if (regBtn) regBtn.onclick = () => {
        showRegisterPage({ onDone: () => stepPurpose() });
      };
      $('[data-a="guest"]', ov).onclick = () => finish(['ai']);
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

    stepLanding();
  });
}
