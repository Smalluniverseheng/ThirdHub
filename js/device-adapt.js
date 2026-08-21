/* ===== ThirdHub js/device-adapt.js — 多端屏幕自适应（v4.2） =====
   检测当前屏幕形态并给 <html data-device> 打标，CSS 按标记换布局：
   watch   手表/超小屏（≤300px 触屏）
   narrow  折叠屏外屏等窄长屏（301–420px 触屏）
   phone   普通直板手机（<768px）
   fold    折叠屏展开态（支持横向视口分段 media feature，或大屏近方形 + 触屏）
   tablet  平板（768–1023px）
   desktop 电脑（≥1024px 键鼠，或 ≥1200px 任意）
   窗口尺寸 / 折叠展开变化时实时重判，并触发 th:device 事件。 */
import { emit } from './store.js';

let current = '';

export function detectDevice() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches && window.matchMedia('(hover: hover)').matches;
  /* 折叠屏铰链分段（支持的浏览器：Android Chrome / Edge on Surface Duo 等） */
  let segments = 1;
  try { if (window.matchMedia('(horizontal-viewport-segments: 2)').matches) segments = 2; } catch (e) {}
  const nearSquare = Math.max(w, h) / Math.min(w, h) < 1.45;

  let dev;
  if (w <= 300 && coarse) dev = 'watch';
  else if (w <= 420 && coarse && h / w >= 2.2) dev = 'narrow'; /* 窄且特别长：折叠屏外屏（普通手机 16:9~20:9 均 <2.2） */
  else if (w < 768) dev = 'phone';
  else if (w < 1024 && coarse) dev = segments >= 2 || nearSquare ? 'fold' : 'tablet';
  else if (fine || w >= 1200) dev = 'desktop';
  else dev = 'tablet';
  return dev;
}

export function getDevice() { return current || detectDevice(); }

export function initDeviceAdapt() {
  const apply = () => {
    const dev = detectDevice();
    if (dev === current) return;
    current = dev;
    document.documentElement.dataset.device = dev;
    document.body && (document.body.dataset.device = dev);
    emit('th:device', dev);
  };
  apply();
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(apply, 120); });
  window.addEventListener('orientationchange', () => setTimeout(apply, 220));
  try {
    window.matchMedia('(horizontal-viewport-segments: 2)').addEventListener('change', apply);
  } catch (e) {}
  window.addEventListener('th:device:refresh', apply);
}
