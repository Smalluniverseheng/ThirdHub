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
import { PROVIDERS } from '../ai/ai-models.js';
import { showRegisterPage } from './register-page.js';

const ORBIT_VENDORS = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'moonshot', 'aliyun', 'zhipu'];
const ORBIT_VENDORS_2 = ['bytedance', 'xiaomi', 'minimax', 'tencent', 'groq'];

const HERO_STATS = [
  { n: 33, suf: '+', label: '模型厂商' },
  { n: 300, suf: '+', label: 'AI 模型' },
  { n: 6, suf: ' 类', label: '内容板块' },
  { n: 0, suf: '', label: '预置内容源' },
];
const CAPABILITIES = [
  { no: '01', t: '即换即用', d: '同一个对话里随时切换 GPT、Claude、Gemini、DeepSeek……上下文不断，答案好坏当场对照。' },
  { no: '02', t: 'Key 自持', d: 'API Key 只保存在你的设备本地，请求从浏览器直连厂商接口，不经过任何中间服务器。' },
  { no: '03', t: '只属于你', d: '数据本地优先、云端同步可选。对话与书架仅自己可见，随时可以彻底删除。' },
];
const CREATE_CARDS = [
  { no: '01', ico: 'robot', t: 'AI 对话', d: '写作、编程、翻译、学习提问。流式回复、深度思考展示、联网搜索与 MCP 工具，随时切换模型对照答案。',
    chips: ['GPT-5.1', 'Claude Opus 4.5', 'Gemini 3 Pro', 'DeepSeek V3.2', 'Kimi K2', 'Qwen3 Max'] },
  { no: '02', ico: 'brush', t: 'AI 绘画', d: '一句话直接出图。多个主流绘画模型同台可选，风格、比例自由控制，提示词灵感广场一键复用。',
    chips: ['GPT-Image', 'Seedream 4.0', 'Imagen 3', '万相 2.1', 'Kolors'] },
  { no: '03', ico: 'film', t: 'AI 视频', d: '文生视频，多档时长与比例可选。分镜脚本智能体先写脚本再出片，成片在线预览、直接下载。',
    chips: ['Sora 2', 'Veo 3', 'Seedance', '可灵', 'Hailuo 02'] },
];
const FAQS = [
  { q: 'ThirdHub 是免费的吗？', a: '应用完全免费。AI 对话使用你自己的 API Key，费用与厂商直接结算；会员仅扩容云存储。' },
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

    /* ---------- ① 产品落地页（流光风格重制：滚动显现 / 流光标题 / 跑马灯 / 数字动画） ---------- */
    function stepLanding() {
      const ring = (vendors, r, dur, rev) => `
        <div class="obl-ring" style="--r:${r}px;--dur:${dur}s">
          ${vendors.map((v, i) => `
            <span class="obl-badge ${rev ? 'rev' : ''}" style="--a0:${(360 / vendors.length) * i}deg;--r:${r}px;--dur:${dur}s">${vendorIcon(v)}</span>`).join('')}
        </div>`;
      // 跑马灯内容（模型名，双份无缝循环）
      const marqueeModels = [];
      PROVIDERS.forEach((p) => (p.models || []).slice(0, 2).forEach((m) => marqueeModels.push(m)));
      const marquee = marqueeModels.map((m) => `<span class="obl-mq-chip">${esc(m)}</span>`).join('');
      // 模型库：按厂商分组（取模型数最多的 12 家）
      const libVendors = [...PROVIDERS].filter((p) => (p.models || []).length)
        .sort((a, b) => (b.models.length + (b.image || []).length + (b.video || []).length) - (a.models.length + (a.image || []).length + (a.video || []).length))
        .slice(0, 12);

      ov.innerHTML = `
        <div class="ob-landing">
          <div class="obl-hero">
            <div class="obl-orbit">
              ${ring(ORBIT_VENDORS, 120, 36, false)}
              ${ring(ORBIT_VENDORS_2, 72, 24, true)}
              <div class="obl-core">${icon('robot')}</div>
            </div>
            <div class="obl-kicker">第三方科技</div>
            <div class="obl-title obl-shine">ThirdHub</div>
            <div class="obl-tag">一个入口 · 连接所有 AI 与内容</div>
            <div class="obl-stats">
              ${HERO_STATS.map((s) => `<div class="obl-stat"><div class="obl-stat-n" data-n="${s.n}" data-suf="${s.suf}">0${s.suf}</div><div class="obl-stat-l">${s.label}</div></div>`).join('')}
            </div>
            <div class="obl-cta">
              <button class="btn btn-primary ob-btn" data-a="go">开始体验</button>
              <button class="ob-skip" data-a="guest">先看看，不登录 →</button>
              <a class="ob-skip" href="https://github.com/Smalluniverseheng/ThirdHub-Android/releases/latest" target="_blank" rel="noopener" style="text-decoration:none">下载安卓版 App ↗</a>
            </div>
          </div>
          <div class="obl-marquee"><div class="obl-mq-track">${marquee}${marquee}</div></div>

          <div class="obl-sec rv">
            <div class="obl-sec-kicker">CAPABILITIES</div>
            <div class="obl-sec-big">聚合不是把模型堆在一起，<br>是把体验做到顺滑无感</div>
            <div class="obl-caps">
              ${CAPABILITIES.map((c) => `
                <div class="obl-cap">
                  <div class="obl-cap-no">${c.no}</div>
                  <div class="obl-cap-t">${c.t}</div>
                  <div class="obl-cap-d">${c.d}</div>
                </div>`).join('')}
            </div>
          </div>

          <div class="obl-sec rv">
            <div class="obl-sec-kicker">CREATE ANYTHING</div>
            <div class="obl-sec-big">一个对话框，三种创作</div>
            <div class="obl-creates">
              ${CREATE_CARDS.map((c) => `
                <div class="obl-create">
                  <div class="obl-create-head"><span class="obl-create-ico">${icon(c.ico)}</span><span class="obl-create-no">${c.no}</span></div>
                  <div class="obl-cap-t">${c.t}</div>
                  <div class="obl-cap-d">${c.d}</div>
                  <div class="obl-chips">${c.chips.map((m) => `<span class="obl-chip">${esc(m)}</span>`).join('')}</div>
                </div>`).join('')}
            </div>
          </div>

          <div class="obl-sec rv">
            <div class="obl-sec-kicker">MODEL LIBRARY</div>
            <div class="obl-sec-big">33 家厂商 · 300+ 模型</div>
            <div class="obl-lib">
              ${libVendors.map((p) => `
                <div class="obl-lib-row">
                  <div class="obl-lib-v">${vendorIcon(p.id)}<span class="obl-lib-name">${esc(p.name)}</span><span class="obl-lib-count">${(p.models || []).length + (p.image || []).length + (p.video || []).length}</span></div>
                  <div class="obl-lib-models">${[...(p.models || []), ...(p.image || []), ...(p.video || [])].slice(0, 6).map((m) => `<span class="obl-chip sm">${esc(m)}</span>`).join('')}</div>
                </div>`).join('')}
            </div>
            <div class="muted" style="font-size:12px;margin-top:10px">更多厂商与模型在应用内「模型设置」中查看 · 支持从厂商接口实时同步新模型</div>
          </div>

          <div class="obl-sec rv">
            <div class="obl-sec-kicker">FAQ</div>
            <div class="obl-sec-big">常见问题</div>
            ${FAQS.map((f) => `
              <details class="obl-faq"><summary>${esc(f.q)}</summary><div class="obl-faq-a">${esc(f.a)}</div></details>`).join('')}
          </div>

          <div class="obl-sec rv" style="text-align:center;padding-bottom:44px">
            <button class="btn btn-primary ob-btn" data-a="go2">立即开始</button>
            <div style="margin-top:12px"><a class="ob-skip" href="https://github.com/Smalluniverseheng/ThirdHub-Android/releases/latest" target="_blank" rel="noopener" style="text-decoration:none">下载安卓版 App ↗</a></div>
            <div class="muted" style="font-size:12px;margin-top:14px">第三方科技 · 不预置任何内容源</div>
          </div>
        </div>`;
      $('[data-a="go"]', ov).onclick = stepAuth;
      $('[data-a="go2"]', ov).onclick = stepAuth;
      $('[data-a="guest"]', ov).onclick = () => finish(['ai']);

      /* 滚动显现 + 数字动画 */
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.12, root: ov });
      $$('.rv', ov).forEach((x) => io.observe(x));
      $$('.obl-stat-n', ov).forEach((x) => {
        const target = +x.dataset.n, suf = x.dataset.suf || '';
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0) / 1200);
          x.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suf;
          if (p < 1) requestAnimationFrame(step);
        };
        setTimeout(() => requestAnimationFrame(step), 350);
      });
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
