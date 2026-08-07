/* ===== ThirdHub js/modules/splash.js — 开屏动画（v1.7，与 Android 版一致） =====
   首次访问 → 展示产品介绍落地页（onboarding）；
   之后每次打开 → 展示开屏动画（呼吸 Logo + 渐变 slogan，点击可跳过）
   可在「我的 → 设置 → 开屏动画」中关闭 */
import { el } from '../ui.js';
import { kvGet } from '../store.js';
import { APP_VERSION } from '../app.js';

export async function maybeSplash() {
  /* 首访用户走产品介绍页，不放开屏动画 */
  const onboardDone = await kvGet('onboard:done', false);
  if (!onboardDone) return;
  const on = await kvGet('splash:on', true);
  if (!on || /[?&]nosplash=1/.test(location.search || '')) return;

  const sp = el(`<div class="th-splash" id="th-splash">
    <div class="th-splash-glow g1"></div>
    <div class="th-splash-glow g2"></div>
    <div class="th-splash-inner">
      <div class="th-splash-card"><img src="icons/brand.jpg" alt="第三方科技"></div>
      <div class="th-splash-slogan">纵横四海·引领无限</div>
      <div class="th-splash-ver">v${APP_VERSION}</div>
    </div>
    <div class="th-splash-brand">第三方科技</div>
  </div>`);
  document.body.appendChild(sp);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    sp.classList.add('out');
    setTimeout(() => sp.remove(), 450);
  };
  sp.onclick = close;
  setTimeout(close, 2000);
}
