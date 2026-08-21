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
    const { hasCloud, getSupabase } = await import('./supabase.js');
    const { currentUser } = await import('./auth.js');
    const { kvGet } = await import('./store.js');
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

export async function addLog(level, tag, msg) {
  try {
    const logs = await getLogs();
    logs.push({ id: uid(), ts: Date.now(), level, tag: String(tag || '').slice(0, 40), msg: String(msg || '').slice(0, 2000) });
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
    addLog('error', 'js', `${e.message || 'Script error'} @${(e.filename || '').split('/').pop()}:${e.lineno || 0}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    addLog('error', 'promise', (r && (r.stack || r.message)) ? String(r.stack || r.message) : String(r));
  });
  const origErr = console.error.bind(console);
  console.error = (...args) => { addLog('error', 'console', args.map(serializeArg).join(' ')); origErr(...args); };
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => { addLog('warn', 'console', args.map(serializeArg).join(' ')); origWarn(...args); };
  const origInfo = console.info.bind(console);
  console.info = (...args) => { addLog('info', 'console', args.map(serializeArg).join(' ')); origInfo(...args); };
  /* v6.0：fetch 失败抓取（网络异常定位） */
  const origFetch = window.fetch;
  window.fetch = (...args) => origFetch.apply(window, args).catch((e) => {
    addLog('error', 'fetch', '请求失败：' + (args[0] && String(args[0]).slice(0, 120)) + ' → ' + (e && e.message || e));
    throw e;
  });
  /* v6.0：网络离线 / 在线记录 */
  window.addEventListener('offline', () => addLog('warn', 'net', '网络已断开'));
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
