/* ===== ThirdHub js/modules/devlog.js — 设备日志管理（v1.7） =====
   自动抓取本机运行日志（JS 错误 / Promise 异常 / 网络失败 / 手动标记）
   仅保存在本机，最多保留 300 条；可筛选、复制、导出、清空，用于排查 Bug */
import { $, $$, el, esc, icon, toast, openOverlay, confirmDialog, fmtDate, uid } from '../ui.js';
import { kvGet, kvSet } from '../store.js';

const MAX_LOGS = 300;
let installed = false;


/* v6.0：常见错误中文解释 */
const LOG_HINTS = [
  [/Failed to fetch|NetworkError|网络请求失败/i, '网络请求失败：可能是断网、跨域或服务端不可达'],
  [/ERR_CONNECTION/i, '连接失败：目标地址不可达'],
  [/ERR_TIMED_OUT|timeout/i, '请求超时：服务端响应过慢'],
  [/ERR_CERT/i, '证书错误：HTTPS 证书无效或过期'],
  [/CORS/i, '跨域被拦截：接口未允许浏览器跨域访问'],
  [/401/i, '认证失败（401）：API Key 无效或已过期'],
  [/403/i, '无权限（403）：接口拒绝了访问'],
  [/404/i, '接口不存在（404）：地址写错或服务已下线'],
  [/429/i, '请求过于频繁（429）：触发限流，请稍后再试'],
  [/500|502|503|504/i, '服务端错误（5xx）：厂商服务异常，请稍后重试'],
  [/insufficient|quota|balance|余额/i, '额度不足：API 余额或配额已用尽'],
  [/Invalid API key|apikey/i, 'API Key 无效：请检查密钥是否正确'],
  [/AbortError/i, '请求被中止：用户取消或页面关闭'],
  [/IndexedDB|IDB/i, '本地数据库异常：浏览器存储不可用或已满'],
  [/quota_exceeded/i, '存储超限：浏览器本地空间不足'],
  [/Failed to load module script/i, '模块加载失败：脚本文件缺失、路径错误或网络中断，可尝试刷新或重新部署'],
  [/Unexpected identifier|SyntaxError/i, '脚本语法错误：代码格式异常，属于程序缺陷，可反馈给开发者'],
  [/TypeError|undefined is not|is not a function/i, '类型错误：调用了不存在的属性或函数，多为版本不匹配'],
  [/ReferenceError|is not defined/i, '变量未定义：代码引用了不存在的名称，属于程序缺陷'],
  [/RangeError/i, '范围错误：数值超出允许范围（如数组长度、栈溢出）'],
  [/NS_ERROR|DOMException/i, '浏览器 API 异常：权限、配额或浏览器限制导致'],
  [/ERR_BLOCKED_BY_CLIENT/i, '请求被浏览器拦截：广告拦截插件或隐私设置阻止了资源'],
  [/ERR_CERT|SSL|TLS/i, '证书错误：HTTPS 证书无效、过期或不受信任'],
  [/ERR_ABORTED/i, '请求被中止：页面切换、用户取消或超时'],
  [/ERR_CONNECTION_REFUSED/i, '连接被拒绝：服务端未启动或防火墙拦截'],
  [/net::ERR_/i, '网络错误：详见错误码，多为断网、代理或服务端问题'],
  [/ChunkLoadError/i, '代码分包加载失败：新版本发布后缓存未更新，刷新页面即可'],
  [/Loading chunk/i, '分包加载失败：同上，刷新可解决'],
  [/ResizeObserver/i, '布局监听异常：界面尺寸变化触发的循环，不影响功能'],
  [/Script error/i, '脚本错误：跨域脚本的通用报错，需结合控制台定位'],
  [/SecurityError/i, '安全错误：跨域、沙箱或权限限制'],
  [/NotAllowedError/i, '操作被拒绝：浏览器权限（麦克风/相机/通知）未授予'],
  [/AbortError/i, '操作被中止：请求或操作被取消'],
  [/ECONNRESET|Connection reset/i, '连接被重置：服务端主动断开或网络波动'],
  [/ERR_HTTP2|HTTP\/2/i, 'HTTP/2 协议错误：服务端或代理配置异常'],
  [/ERR_INVALID_URL/i, 'URL 格式无效：地址拼写错误或缺少协议头'],
  [/ERR_NAME_NOT_RESOLVED/i, '域名解析失败：地址不存在或 DNS 异常'],
  [/ERR_PROXY_CONNECTION_FAILED/i, '代理连接失败：代理服务器不可达或未启动'],
  [/Mixed Content/i, '混合内容被拦截：HTTPS 页面禁止请求 HTTP 资源'],
  [/Failed to load resource/i, '资源加载失败：文件不存在、路径错误或服务器返回错误'],
  [/Cannot read properties/i, '读取空值属性：数据缺失或时序问题导致对象为 null/undefined'],
  [/Failed to execute/i, 'DOM 操作失败：目标元素不存在或当前状态不允许该操作'],
  [/400/i, '请求参数错误（400）：参数缺失或格式不正确'],
  [/413/i, '请求体过大（413）：上传内容超过服务端限制'],
  [/415/i, '不支持的媒体类型（415）：Content-Type 与接口要求不符'],
  [/WebSocket|wss?:\/\//i, 'WebSocket 连接异常：实时通道断开或服务端未启动'],
  [/QuotaExceeded/i, '存储超限：浏览器本地空间或 IndexedDB 配额不足'],
];
export function explainLog(msg) {
  const s = String(msg || '');
  for (const [re, hint] of LOG_HINTS) if (re.test(s)) return hint;
  return '';
}

/* v6.0：云同步（默认开启；写入 Supabase device_logs，需建表见 supabase/community.sql 附录） */
let lastSync = 0;
async function syncLogs() {
  try {
    const { hasCloud, getSupabase } = await import('../supabase.js');
    const { currentUser } = await import('../auth.js');
    const { kvGet } = await import('../store.js');
    if (!(await kvGet('devlog:cloud', true))) return;
    if (!hasCloud()) return;
    const u = await currentUser();
    if (!u) return;
    const now = Date.now();
    if (now - lastSync < 30000) return;
    lastSync = now;
    const logs = await getLogs();
    const pending = logs.filter((l) => !l.synced).slice(-20);
    if (!pending.length) return;
    const sb = getSupabase();
    const rows = pending.map((l) => ({
      user_id: u.id,
      level: l.level, tag: l.tag, msg: l.msg,
      ts: new Date(l.ts).toISOString(),
      app_version: (window.__THIRDHUB__ && window.__THIRDHUB__.version) || '',
    }));
    const { error } = await sb.from('device_logs').insert(rows);
    if (!error) {
      const all = await getLogs();
      const ids = new Set(pending.map((x) => x.id));
      await kvSet('devlog:items', all.map((l) => ids.has(l.id) ? { ...l, synced: true } : l));
    }
  } catch (e) {}
}
export async function getLogs() { return await kvGet('devlog:items', []); }

/* v4.3：统一序列化 —— Error 对象 JSON.stringify 会变 {}，这里提取 name/message/stack；
   普通对象用带循环引用的安全序列化，保证日志里能看到真实错误内容 */
function serializeArg(a) {
  try {
    if (a instanceof Error) return `${a.name || 'Error'}: ${a.message || ''}${a.stack ? '\n' + a.stack : ''}`.trim();
    if (typeof a === 'string') return a;
    if (a === null || a === undefined) return String(a);
    if (typeof a !== 'object') return String(a);
    if (a && a.error instanceof Error) return serializeArg(a.error);
    const seen = new WeakSet();
    return JSON.stringify(a, (k, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[Circular]'; seen.add(v); }
      if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
      return v;
    });
  } catch (e) { try { return String(a); } catch (e2) { return '[Unserializable]'; } }
}
export { serializeArg as serializeLogArg };

/* v6.1：日志环境上下文（页面地址 / 在线状态 / 版本 / UA），错误与警告自动附带，方便定位复现环境 */
function envContext() {
  try {
    const v = (window.__THIRDHUB__ && window.__THIRDHUB__.version) || '';
    const loc = location.hostname + (location.pathname || '') + (location.search || '');
    return '\n[环境] ' + String(loc).slice(0, 120) + ' · ' + (navigator.onLine ? '在线' : '离线') + (v ? ' · v' + v : '') + ' · ' + String(navigator.userAgent || '').slice(0, 90);
  } catch (e) { return ''; }
}

export async function addLog(level, tag, msg) {
  try {
    const logs = await getLogs();
    let text = String(msg || '');
    /* v6.1：错误 / 警告自动附加环境上下文，信息类保持精简 */
    if (level === 'error' || level === 'warn') text += envContext();
    logs.push({ id: uid(), ts: Date.now(), level, tag: String(tag || '').slice(0, 40), msg: text.slice(0, 2600) });
    while (logs.length > MAX_LOGS) logs.shift();
    await kvSet('devlog:items', logs);
  } catch (e) {}
}

export async function clearLogs() { await kvSet('devlog:items', []); }

/* 全局钩子（应用启动时安装一次） */
export function installLogHooks() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    const loc = (e.filename || '').split('/').pop() + ':' + (e.lineno || 0) + ':' + (e.colno || 0);
    const stack = (e.error && e.error.stack) ? '\n' + String(e.error.stack).slice(0, 600) : '';
    addLog('error', 'js', `${e.message || 'Script error'}\n位置: ${loc}${stack}\n说明: ${explainLog(e.message)}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    const msg = r && (r.stack || r.message) ? String(r.stack || r.message) : String(r);
    addLog('error', 'promise', msg.slice(0, 800) + '\n说明: ' + explainLog(r && r.message || msg));
  });
  const origErr = console.error.bind(console);
  console.error = (...args) => {
    const detail = args.map(serializeArg).join(' ');
    const hint = explainLog(args.map(String).join(' '));
    addLog('error', 'console', detail.slice(0, 900) + (hint ? '\n说明: ' + hint : ''));
    origErr(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const detail = args.map(serializeArg).join(' ');
    const hint = explainLog(args.map(String).join(' '));
    addLog('warn', 'console', detail.slice(0, 900) + (hint ? '\n说明: ' + hint : ''));
    origWarn(...args);
  };
  const origInfo = console.info.bind(console);
  console.info = (...args) => { addLog('info', 'console', args.map(serializeArg).join(' ').slice(0, 900)); origInfo(...args); };
  /* v6.0：fetch 失败抓取（网络异常定位）；v6.1：非 2xx 响应也记录（含状态码与响应摘要） */
  const origFetch = window.fetch;
  window.fetch = (...args) => {
    const p = origFetch.apply(window, args);
    let url = '';
    try { url = args[0] && (typeof args[0] === 'string' ? args[0] : args[0].url || '') || ''; } catch (e2) {}
    const method = (args[1] && args[1].method) || 'GET';
    p.then((resp) => {
      if (resp && resp.status >= 400) {
        const statusText = resp.statusText || '';
        resp.clone().text().then((t) => {
          addLog('warn', 'fetch', 'HTTP ' + resp.status + ' ' + statusText + ' ' + method + ' ' + String(url).slice(0, 200) + '\n响应: ' + String(t || '').slice(0, 300) + '\n说明: ' + explainLog(String(resp.status) + ' ' + String(t || '').slice(0, 120)));
        }).catch(() => {
          addLog('warn', 'fetch', 'HTTP ' + resp.status + ' ' + statusText + ' ' + method + ' ' + String(url).slice(0, 200) + '\n说明: ' + explainLog(String(resp.status)));
        });
      }
    }).catch((e) => {
      /* 只记录不重抛：window.fetch 返回的原始 promise 仍会正常向调用方抛错 */
      addLog('error', 'fetch', '请求失败: ' + method + ' ' + String(url).slice(0, 200) + ' → ' + (e && e.message || e) + '\n说明: ' + explainLog(e && e.message));
    });
    return p;
  };
  /* v6.1：XHR 请求抓取（状态码 / 超时 / 网络错误，覆盖老接口调用方） */
  if (typeof XMLHttpRequest !== 'undefined') {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, async, user, pass) {
      try { this.__dl = { m: String(method || 'GET'), u: String(url || '').slice(0, 200) }; } catch (e3) {}
      return origOpen.call(this, method, url, async, user, pass);
    };
    XMLHttpRequest.prototype.send = function (...sendArgs) {
      try {
        this.addEventListener('loadend', () => {
          if (this.status >= 400) {
            addLog('warn', 'xhr', 'HTTP ' + this.status + ' ' + ((this.__dl && this.__dl.m) || 'GET') + ' ' + ((this.__dl && this.__dl.u) || '') + '\n响应: ' + String(this.responseText || '').slice(0, 300) + '\n说明: ' + explainLog(String(this.status)));
          }
        });
        this.addEventListener('error', () => {
          addLog('error', 'xhr', 'XHR 网络错误: ' + ((this.__dl && this.__dl.m) || 'GET') + ' ' + ((this.__dl && this.__dl.u) || '') + '\n说明: 连接失败或服务端不可达');
        });
        this.addEventListener('timeout', () => {
          addLog('warn', 'xhr', 'XHR 请求超时: ' + ((this.__dl && this.__dl.m) || 'GET') + ' ' + ((this.__dl && this.__dl.u) || ''));
        });
      } catch (e4) {}
      return origSend.apply(this, sendArgs);
    };
  }
  /* v6.0：网络离线 / 在线记录 */
  window.addEventListener('offline', () => addLog('warn', 'net', '网络已断开'));
  /* v5.8：资源加载失败抓取（图片/脚本/样式），带资源地址 */
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    if (['IMG', 'SCRIPT', 'LINK', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME'].includes(el.tagName)) {
      const src = el.src || el.href || (el.currentSrc || '');
      addLog('error', 'resource', '资源加载失败: <' + el.tagName + '> ' + String(src).slice(0, 200) + '\n说明: ' + explainLog('资源加载失败'));
    }
  }, true);
  window.addEventListener('online', () => addLog('info', 'net', '网络已恢复'));
  /* v6.0：云同步触发（默认开启，可在日志页关闭） */
  setInterval(() => { syncLogs().catch(() => {}); }, 60000);
  setTimeout(() => { syncLogs().catch(() => {}); }, 8000);
}

/* ================= 日志管理页面 ================= */
export async function showDevLogs() {
  openOverlay({
    title: '设备日志',
    build: async (body) => {
      body.innerHTML = `
        <div class="set-wrap">
          <div class="muted" style="line-height:1.7;margin-bottom:12px">自动记录本机运行中的错误与异常（含中文解释）。默认开启云端上报（同步到云端库，管理员与 AI 可查看），可在下方关闭。</div><div class="nr-set-row" style="padding-top:0"><span style="font-size:13.5px">云端上报日志（默认开启）</span><button class="ai-toggle" data-a="cloudsync"></button></div>
          <div class="nr-chip-row mb16" id="log-filter">
            ${[['all', '全部'], ['error', '错误'], ['warn', '警告'], ['info', '信息']].map(([v, n], i) => `<button class="ai-chip ${i === 0 ? 'on' : ''}" data-f="${v}">${n}</button>`).join('')}
          </div>
          <div class="row gap8 mb16">
            <button class="btn btn-sm grow" data-a="copy">复制全部</button>
            <button class="btn btn-sm grow" data-a="export">导出</button>
            <button class="btn btn-sm btn-danger grow" data-a="clear">清空</button>
          </div>
          <div class="col gap8" id="log-list"></div>
        </div>`;
      let filter = 'all';
      const listBox = $('#log-list', body);

      async function renderList() {
        let logs = (await getLogs()).slice().reverse();
        if (filter !== 'all') logs = logs.filter((l) => l.level === filter);
        $('#log-list', body).innerHTML = logs.length ? '' : '<div class="ai-drawer-empty" style="padding:30px 0">暂无日志</div>';
        logs.slice(0, 120).forEach((l) => {
          const hint = explainLog(l.msg);
          const color = l.level === 'error' ? 'var(--danger)' : l.level === 'warn' ? '#e6a23c' : 'var(--text-secondary)';
          listBox.appendChild(el(`<div class="card" style="padding:10px 12px">
            <div class="row gap8" style="align-items:baseline">
              <span style="font-size:11px;font-weight:700;color:${color}">${l.level === 'error' ? '错误' : l.level === 'warn' ? '警告' : '信息'}</span>
              <span class="tag tag-gray">${esc(l.tag)}</span>
              <span class="muted" style="font-size:11px">${fmtDate(l.ts, true)}</span>
            </div>
            ${hint ? `<div style="font-size:12px;color:var(--primary);margin-top:5px">💡 ${esc(hint)}</div>` : ''}<div style="font-size:12px;line-height:1.6;margin-top:4px;word-break:break-all;white-space:pre-wrap">${esc(l.msg)}</div>
          </div>`));
        });
      }

      const cloudToggle = $('[data-a="cloudsync"]', body);
      kvGet('devlog:cloud', true).then((v) => cloudToggle.classList.toggle('on', v));
      cloudToggle.onclick = async () => {
        const next = !cloudToggle.classList.contains('on');
        cloudToggle.classList.toggle('on', next);
        await kvSet('devlog:cloud', next);
        toast(next ? '日志云上报已开启' : '日志云上报已关闭', 'ok');
      };
      $$('#log-filter .ai-chip', body).forEach((b) => b.onclick = () => {
        filter = b.dataset.f;
        $$('#log-filter .ai-chip', body).forEach((x) => x.classList.toggle('on', x === b));
        renderList();
      });
      $('[data-a="copy"]', body).onclick = async () => {
        const logs = await getLogs();
        navigator.clipboard.writeText(logs.map((l) => `[${fmtDate(l.ts, true)}] [${l.level}] [${l.tag}] ${l.msg}`).join('\n')).then(() => toast('已复制', 'ok'));
      };
      $('[data-a="export"]', body).onclick = async () => {
        const logs = await getLogs();
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `thirdhub-logs-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
      };
      $('[data-a="clear"]', body).onclick = async () => {
        if (await confirmDialog('清空日志？', '本机记录的所有日志将被删除', '清空', true)) { await clearLogs(); renderList(); toast('已清空', 'ok'); }
      };
      renderList();
    },
  });
}
