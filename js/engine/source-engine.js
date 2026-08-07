/* ===== ThirdHub js/engine/source-engine.js — 连接器引擎（主线程侧） =====
   每个 SourceEngine 实例对应一个 Web Worker 沙箱，加载一份用户导入的 JS 连接器 */
import { kvGet } from '../store.js';

const DEFAULT_PUBLICS = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
];

export class SourceEngine {
  constructor(source) {
    this.source = source; // {id,name,url,type,code}
    this.worker = null;
    this.meta = null;
    this._id = 1;
    this._pending = new Map();
    this.logs = [];
  }

  async init() {
    if (this.worker) return;
    this.worker = new Worker('js/engine/worker.js');
    this.worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'log') { this.logs.push(d.msg); this.logs = this.logs.slice(-100); return; }
      if (d.type === 'config') return;
      const p = this._pending.get(d.id);
      if (!p) return;
      this._pending.delete(d.id);
      if (d.type === 'error') p.reject(new Error(d.error));
      else if (d.type === 'loaded') { this.meta = d.meta; p.resolve(d.meta); }
      else p.resolve(d.result);
    };
    const proxyCfg = {
      backend: await kvGet('proxy:backend', 'https://thirdhub-proxy.1829487897.workers.dev/'),
      publics: DEFAULT_PUBLICS,
      mode: await kvGet('proxy:mode', 'auto'),
    };
    await this._send({ type: 'init', proxy: proxyCfg });
    await this._send({ type: 'load', code: this.source.code });
  }

  _send(msg, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = this._id++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('执行超时'));
      }, timeout);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.worker.postMessage({ ...msg, id });
    });
  }

  async call(fn, args = [], timeout = 30000) {
    await this.init();
    return this._send({ type: 'call', fn, args }, timeout);
  }

  /* 标准接口 */
  async search(keyword, page = 1) { return this.call('search', [keyword, page]); }
  async bookInfo(bookUrl) { return this.call('bookInfo', [bookUrl]); }
  async chapterList(bookUrl) { return this.call('chapterList', [bookUrl]); }
  async chapterContent(chapterUrl) { return this.call('chapterContent', [chapterUrl], 45000); }

  destroy() { this.worker && this.worker.terminate(); this.worker = null; }
}

/* 引擎实例池 */
const pool = new Map();
export function getEngine(source) {
  if (pool.has(source.id)) {
    const e = pool.get(source.id);
    if (e.source.code === source.code) return e;
    e.destroy();
  }
  const e = new SourceEngine(source);
  pool.set(source.id, e);
  return e;
}
export function destroyEngines() { pool.forEach((e) => e.destroy()); pool.clear(); }
