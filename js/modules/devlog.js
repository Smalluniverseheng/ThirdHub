/* ===== ThirdHub js/modules/devlog.js — 设备日志管理（v1.7） =====
   自动抓取本机运行日志（JS 错误 / Promise 异常 / 网络失败 / 手动标记）
   仅保存在本机，最多保留 300 条；可筛选、复制、导出、清空，用于排查 Bug */
import { $, $$, el, esc, icon, toast, openOverlay, confirmDialog, fmtDate, uid } from '../ui.js';
import { kvGet, kvSet } from '../store.js';

const MAX_LOGS = 300;
let installed = false;

export async function getLogs() { return await kvGet('devlog:items', []); }

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
  console.error = (...args) => { addLog('error', 'console', args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(' ')); origErr(...args); };
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => { addLog('warn', 'console', args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(' ')); origWarn(...args); };
}

/* ================= 日志管理页面 ================= */
export async function showDevLogs() {
  openOverlay({
    title: '设备日志',
    build: async (body) => {
      body.innerHTML = `
        <div class="set-wrap">
          <div class="muted" style="line-height:1.7;margin-bottom:12px">自动记录本机运行中的错误与异常，仅保存在本机，用于排查问题。反馈 Bug 时可导出日志一并提交。</div>
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
          const color = l.level === 'error' ? 'var(--danger)' : l.level === 'warn' ? '#e6a23c' : 'var(--text-secondary)';
          listBox.appendChild(el(`<div class="card" style="padding:10px 12px">
            <div class="row gap8" style="align-items:baseline">
              <span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase">${l.level}</span>
              <span class="tag tag-gray">${esc(l.tag)}</span>
              <span class="muted" style="font-size:11px">${fmtDate(l.ts, true)}</span>
            </div>
            <div style="font-size:12px;line-height:1.6;margin-top:6px;word-break:break-all;white-space:pre-wrap">${esc(l.msg)}</div>
          </div>`));
        });
      }

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
