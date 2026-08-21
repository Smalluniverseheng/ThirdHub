/* ===== ThirdHub js/engine/image-modify.js — Venera modifyImage 浏览器端运行时（v4.0） =====
   官方 Venera 图源可在 onImageLoad 里下发 modifyImage 脚本（如禁漫的图片切块混淆），
   官方 App 用 Flutter 图像 API 执行还原。这里用 Canvas 实现同一套 Image 接口：
   - Image.empty(w, h)                      创建空白图像
   - image.width / image.height             尺寸
   - res.fillImageRangeAt(x, y, src, sx, sy, w, h)   把 src 的指定区域绘制到 (x, y)
   脚本执行结果转为 blob: 对象地址供 <img> 使用；任何失败都回退原图，保证有图可看。 */

class ImgWrap {
  constructor(src, w, h) {
    this._c = document.createElement('canvas');
    this._c.width = Math.max(1, Math.round(w));
    this._c.height = Math.max(1, Math.round(h));
    this._x = this._c.getContext('2d');
    if (src) this._x.drawImage(src, 0, 0);
  }
  get width() { return this._c.width; }
  get height() { return this._c.height; }
  /* 官方签名：fillImageRangeAt(x, y, image, sx, sy, w, h) */
  fillImageRangeAt(dx, dy, src, sx, sy, w, h) {
    const s = (src && src._c) || src;
    this._x.drawImage(s, sx, sy, w, h, dx, dy, w, h);
  }
}
const ImageAPI = { empty: (w, h) => new ImgWrap(null, w, h) };

const cache = new Map(); /* url → Promise<objectURL> */

export async function runModifyImage(url, script) {
  if (!script) return url;
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    /* v4.5：直连失败（防盗链/CORS）时自动改走本站中转再试一次 */
    let resp = await fetch(url).catch(() => null);
    if (!resp || !resp.ok) {
      try {
        const { getBackendProxy } = await import('./proxy.js');
        const backend = await getBackendProxy();
        if (backend && !String(url).includes('/api/proxy')) {
          resp = await fetch(backend + (backend.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(url)).catch(() => null);
        }
      } catch (e) {}
    }
    if (!resp || !resp.ok) throw new Error('HTTP ' + (resp ? resp.status : 'failed'));
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    const src = new ImgWrap(bmp, bmp.width, bmp.height);
    try { bmp.close && bmp.close(); } catch (e) {}
    /* 脚本内容形如：let modifyImage = (image) => { ... return res } */
    const factory = new Function('Image', String(script) + '\n;return (typeof modifyImage === "function") ? modifyImage : null;');
    const mod = factory(ImageAPI);
    if (!mod) return url;
    const out = await mod(src);
    const cvs = (out && out._c) || src._c;
    const png = await new Promise((res, rej) => cvs.toBlob((b) => (b ? res(b) : rej(new Error('toBlob 失败'))), 'image/png'));
    return URL.createObjectURL(png);
  })();
  cache.set(url, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(url);
    return url; /* 还原失败回退原图 */
  }
}

/* 预取并还原（预加载用），不返回结果 */
export function warmModifyImage(url, script) {
  if (script) runModifyImage(url, script).catch(() => {});
}
