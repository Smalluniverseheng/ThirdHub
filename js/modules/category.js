/* ===== ThirdHub js/modules/category.js — 分类页（内容分类 + 源管理 + 测试工具） ===== */
import { $, $$, el, esc, icon, toast, modal, actionSheet, confirmDialog, formRow, fmtDate } from '../ui.js';
import { listSources, removeSource, toggleSource, importSource, SOURCE_TYPES, validateSource, parseSourceMeta } from '../engine/source-service.js';
import { isTvboxConfig, loadTvboxSites, tvboxToJsSource } from '../engine/tvbox-adapter.js';
import { isLegadoJson, legadoToJsSources, isBasicJson, basicToJsSources } from '../engine/legado-adapter.js';
import { isVeneraJs, isVeneraIndex, veneraToJsSource } from '../engine/venera-adapter.js';
import { getEngine, destroyEngines } from '../engine/source-engine.js';
import { on } from '../store.js';

export async function renderCategory(page) {
  page.innerHTML = `
    <div class="page-head">
      <div class="page-title">分类</div>
      <div class="spacer"></div>
      <button class="icon-btn" data-a="import" title="导入连接器">${icon('import')}</button>
    </div>
    <div class="cat-types" data-role="types"></div>
    <div class="cat-section">
      <div class="section-head" style="padding:0 18px 10px">${icon('plug')}<span>源管理</span></div>
      <div class="cat-manager" data-role="manager"></div>
    </div>
    <div class="cat-section">
      <div class="section-head" style="padding:0 18px 10px">${icon('folder')}<span>我的连接器</span><span class="muted" data-v="count"></span></div>
      <div data-role="sources" style="padding:0 16px"></div>
    </div>`;

  $('[data-role="types"]', page).innerHTML = SOURCE_TYPES.map((t) => `
    <button class="cat-type-card card card-press" data-t="${t.id}">
      <span class="cat-type-ico">${icon(t.icon)}</span>
      <span>${t.name}</span>
      <span class="muted" data-count="${t.id}"></span>
    </button>`).join('');

  $('[data-role="manager"]', page).innerHTML = [
    { a: 'import', ico: 'import', name: '导入连接器', desc: '支持阅读APP书源、Venera 漫画图源、CSS书源、TVbox 配置、JS 连接器' },
    { a: 'test', ico: 'test', name: '连接器测试工具', desc: '验证连接器的搜索/目录/内容函数' },
    { a: 'proxy', ico: 'globe', name: '代理设置', desc: '配置后端代理地址（Cloudflare Worker）' },
  ].map((m) => `
    <button class="list-item" style="margin-bottom:8px" data-a="${m.a}">
      <span class="list-ico">${icon(m.ico)}</span>
      <div class="grow" style="text-align:left;min-width:0">
        <div style="font-size:14px;font-weight:600">${m.name}</div>
        <div class="muted">${m.desc}</div>
      </div>
      <span class="list-arrow">${icon('arrowR')}</span>
    </button>`).join('');

  async function renderSources() {
    const sources = await listSources();
    $('[data-v="count"]', page).textContent = `（${sources.length}）`;
    SOURCE_TYPES.forEach((t) => {
      const elc = $(`[data-count="${t.id}"]`, page);
      const n = sources.filter((s) => s.type === t.id).length;
      if (elc) elc.textContent = n ? n + ' 个源' : '';
    });
    const box = $('[data-role="sources"]', page);
    if (!sources.length) {
      box.innerHTML = `<div class="empty">
        <div class="empty-ico">${icon('plug')}</div>
        <div class="empty-title">暂无连接器</div>
        <div class="muted" style="max-width:300px;line-height:1.8">ThirdHub 零内置内容源。<br>点击右上角导入你自己的连接器后，即可在「发现」页使用。</div>
      </div>`;
      return;
    }
    box.innerHTML = '';
    sources.sort((a, b) => b.importedAt - a.importedAt).forEach((s) => {
      const t = SOURCE_TYPES.find((x) => x.id === s.type);
      const item = el(`<div class="list-item source-item" style="margin-bottom:8px">
        <span class="list-ico">${icon(t ? t.icon : 'folder')}</span>
        <div class="grow" style="min-width:0">
          <div class="row gap4"><span style="font-size:14px;font-weight:600" class="ellipsis">${esc(s.name)}</span><span class="tag ${s.enabled ? 'tag-green' : 'tag-gray'}">${s.enabled ? '已启用' : '已停用'}</span></div>
          <div class="muted ellipsis">${esc(t ? t.name : s.type)} · v${esc(s.version)}${s.author ? ' · ' + esc(s.author) : ''}</div>
        </div>
        <button class="msg-act" data-a="menu">${icon('more')}</button>
      </div>`);
      $('[data-a="menu"]', item).onclick = async () => {
        const v = await actionSheet(s.name, [
          { label: s.enabled ? '停用' : '启用', value: 'toggle', icon: s.enabled ? 'close' : 'check' },
          { label: '测试连接器', value: 'test', icon: 'test' },
          { label: '查看代码', value: 'code', icon: 'edit' },
          { label: '删除', value: 'del', icon: 'trash', danger: true },
        ]);
        if (v === 'toggle') { await toggleSource(s.id, !s.enabled); renderSources(); }
        if (v === 'test') testSource(s);
        if (v === 'code') modal({ title: s.name + ' 源码', body: `<pre style="font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary)">${esc(s.code.slice(0, 20000))}</pre>` });
        if (v === 'del' && await confirmDialog('删除连接器', `确定删除「${s.name}」吗？相关书架条目将无法继续更新。`, '删除', true)) {
          await removeSource(s.id);
          destroyEngines();
          renderSources();
          toast('已删除');
        }
      };
      box.appendChild(item);
    });
  }

  /* ---------- 导入 ---------- */
  async function importFlow() {
    const v = await actionSheet('导入连接器', [
      { label: '从文件导入（.js / .json / .txt）', value: 'file', icon: 'folder' },
      { label: '粘贴代码导入', value: 'paste', icon: 'edit' },
      { label: '从 URL 导入', value: 'url', icon: 'globe' },
    ]);
    if (v === 'file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.js,.json,.txt';
      input.multiple = true;
      input.onchange = async () => {
        for (const f of input.files) {
          const text = await f.text();
          await importText(text, f.name);
        }
        renderSources();
      };
      input.click();
    } else if (v === 'paste') {
      const body = el(`<div>${formRow('粘贴书源 / 图源代码（阅读APP、Venera、CSS书源、TVbox、JS）', '<textarea class="input" rows="10" data-f="code" placeholder="可粘贴阅读APP书源 JSON、基础CSS书源 JSON 或 JS 连接器代码"></textarea>')}</div>`);
      const m = modal({
        title: '粘贴导入', body,
        footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">验证并导入</button>',
      });
      $('[data-a="cancel"]', m.mask).onclick = m.close;
      $('[data-a="ok"]', m.mask).onclick = async () => {
        const text = $('[data-f="code"]', body).value.trim();
        if (!text) return;
        m.close();
        await importText(text, '粘贴导入');
        renderSources();
      };
    } else if (v === 'url') {
      const body = el(`<div>${formRow('连接器 URL', '<input class="input" data-f="url" placeholder="https://example.com/source.js">')}</div>`);
      const m = modal({
        title: '从 URL 导入', body,
        footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">下载并导入</button>',
      });
      $('[data-a="cancel"]', m.mask).onclick = m.close;
      $('[data-a="ok"]', m.mask).onclick = async () => {
        const url = $('[data-f="url"]', body).value.trim();
        if (!url) return;
        m.close();
        toast('下载中…');
        try {
          const { httpGet } = await import('../engine/proxy.js');
          const text = await httpGet(url);
          await importText(text, url);
          renderSources();
        } catch (e) { toast('下载失败：' + e.message, 'err'); }
      };
    }
  }

  /* v2.7：批量导入社区书源（阅读APP / 基础CSS选择器 JSON），按名称去重 */
  async function importBatch(codes, label) {
    if (!codes.length) throw new Error('未检测到有效书源');
    const existing = new Set((await listSources()).map((x) => x.name));
    let n = 0, dup = 0;
    for (const code of codes.slice(0, 100)) {
      const meta = parseSourceMeta(code);
      if (existing.has(meta.name)) { dup++; continue; }
      try { await importSource(code); existing.add(meta.name); n++; } catch (e) {}
    }
    if (!n && dup) throw new Error(label + '已全部存在，无需重复导入');
    if (!n) throw new Error('未检测到有效书源');
    toast(`已导入 ${n} 个${label}${dup ? `（跳过重复 ${dup} 个）` : ''}`, 'ok');
  }

  /* v2.8：Venera 配置库（index.json）→ 勾选后批量下载导入 */
  async function importVeneraIndex(text, from) {
    const list = JSON.parse(text);
    const base = /^https?:\/\//.test(from || '') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    const body = el(`<div>
      <div class="muted mb8" style="line-height:1.7">检测到 Venera 图源库（${list.length} 个漫画图源）。勾选后下载导入：</div>
      <div style="max-height:46vh;overflow:auto;border:1px solid var(--border,rgba(128,128,128,.2));border-radius:12px;padding:6px 10px">
        ${list.map((it, i) => `<label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed rgba(128,128,128,.15)">
          <input type="checkbox" data-i="${i}">
          <span style="font-size:14px;font-weight:600">${esc(it.name || it.key)}</span>
          <span class="muted" style="font-size:12px">v${esc(it.version || '')}</span>
        </label>`).join('')}
      </div></div>`);
    const m = modal({
      title: 'Venera 图源库', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">导入选中</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="ok"]', m.mask).onclick = async () => {
      const picks = $$('input[type="checkbox"]', body).filter((c) => c.checked).map((c) => list[+c.dataset.i]);
      m.close();
      if (!picks.length) return;
      if (!base) return toast('请改用「从 URL 导入」粘贴配置库地址，才能下载图源文件', 'err');
      toast('下载导入中…');
      const { httpGet } = await import('../engine/proxy.js');
      const existing = new Set((await listSources()).map((x) => x.name));
      let n = 0, dup = 0, fail = 0;
      for (const it of picks.slice(0, 30)) {
        const nm = it.name || it.key;
        if (existing.has(nm)) { dup++; continue; }
        try {
          const code = await httpGet(base + it.fileName);
          await importSource(veneraToJsSource(code, base + it.fileName));
          existing.add(nm);
          n++;
        } catch (e) { fail++; }
      }
      renderSources();
      if (n) toast(`已导入 ${n} 个 Venera 图源${dup ? `（跳过重复 ${dup}）` : ''}${fail ? `（失败 ${fail}）` : ''}`, 'ok');
      else toast(dup ? '选中的图源已全部存在' : '导入失败，请检查网络', 'err');
    };
  }

  async function importText(text, from) {
    try {
      if (isVeneraIndex(text)) return await importVeneraIndex(text, from);
      if (isVeneraJs(text)) {
        const s2 = await importSource(veneraToJsSource(text, /^https?:\/\//.test(from || '') ? from : ''));
        return toast(`已导入 Venera 图源「${s2.name}」`, 'ok');
      }
      if (isLegadoJson(text)) return await importBatch(legadoToJsSources(text), '阅读APP书源');
      if (isBasicJson(text)) return await importBatch(basicToJsSources(text), '书源');
      if (isTvboxConfig(text)) {
        const sites = await loadTvboxSites(text);
        if (!sites.length) throw new Error('TVbox 配置中没有可用站点');
        let n = 0;
        for (const site of sites.slice(0, 20)) {
          try { await importSource(tvboxToJsSource(site)); n++; } catch (e) {}
        }
        toast(`已从 TVbox 配置导入 ${n} 个视频源`, 'ok');
        return;
      }
      const s = await importSource(text);
      toast(`已导入「${s.name}」`, 'ok');
    } catch (e) {
      toast('导入失败：' + e.message, 'err');
    }
  }

  /* ---------- 测试工具 ---------- */
  async function testSource(s) {
    const engine = getEngine(s);
    const logs = [];
    const addLog = (ok, step, msg) => logs.push(`<div class="row gap8" style="padding:6px 0"><span class="tag ${ok ? 'tag-green' : 'tag-red'}">${ok ? '通过' : '失败'}</span><span style="font-size:13px">${step}</span><span class="muted ellipsis">${esc(msg || '')}</span></div>`);
    const body = el('<div class="loading-row"><div class="spinner"></div>测试连接器中…</div>');
    const m = modal({ title: '测试：' + s.name, body });

    let keyword = '测试';
    try {
      await engine.init();
      addLog(true, '沙箱加载', 'OK');
    } catch (e) {
      addLog(false, '沙箱加载', e.message);
      body.innerHTML = logs.join('');
      return;
    }
    let results;
    try {
      results = await engine.search(keyword, 1);
      if (typeof results === 'string') results = JSON.parse(results);
      addLog(true, 'search()', `返回 ${(results || []).length} 条结果`);
    } catch (e) {
      addLog(false, 'search()', e.message);
      body.innerHTML = logs.join('');
      return;
    }
    if (!results || !results.length) {
      addLog(false, 'search()', '结果为空（可能源站无「测试」相关内容，建议换个关键词手动验证）');
      body.innerHTML = logs.join('');
      return;
    }
    const first = results[0];
    addLog(true, '结果字段', `name=${first.name || '？'} bookUrl=${first.bookUrl ? '✓' : '✗'}`);
    try {
      const chapters = await engine.chapterList(first.bookUrl);
      const list = typeof chapters === 'string' ? JSON.parse(chapters) : chapters;
      addLog(true, 'chapterList()', `返回 ${(list || []).length} 个章节`);
      if (list && list.length) {
        try {
          const content = await engine.chapterContent(list[0].url);
          const len = typeof content === 'string' ? content.length : JSON.stringify(content).length;
          addLog(true, 'chapterContent()', `返回 ${len} 字符`);
        } catch (e) { addLog(false, 'chapterContent()', e.message); }
      }
    } catch (e) { addLog(false, 'chapterList()', e.message); }
    if (engine.logs.length) {
      logs.push('<div class="hr"></div><div class="muted">脚本日志：</div>' + engine.logs.map((l) => `<div class="muted" style="font-size:12px">${esc(l)}</div>`).join(''));
    }
    body.innerHTML = logs.join('');
  }

  async function testFlow() {
    const sources = await listSources();
    if (!sources.length) return toast('请先导入连接器');
    const v = await actionSheet('选择要测试的连接器', sources.map((s) => ({ label: s.name, value: s.id, icon: 'plug' })));
    if (!v) return;
    const s = sources.find((x) => x.id === v);
    testSource(s);
  }

  async function proxyFlow() {
    const { getBackendProxy, setBackendProxy } = await import('../engine/proxy.js');
    const cur = await getBackendProxy();
    const body = el(`<div>
      ${formRow('后端代理地址（Cloudflare Worker）', `<input class="input" data-f="url" value="${esc(cur)}" placeholder="https://your-worker.workers.dev/proxy">`)}
      <div class="muted" style="line-height:1.8">代理回退顺序：后端代理 → 公共 CORS 代理 → 直接请求。<br>留空则跳过后端代理。</div>
    </div>`);
    const m = modal({
      title: '代理设置', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="save"]', m.mask).onclick = async () => {
      await setBackendProxy($('[data-f="url"]', body).value);
      m.close();
      toast('已保存', 'ok');
    };
  }

  $('[data-a="import"]', page).onclick = importFlow;
  $$('.cat-manager [data-a]', page).forEach((b) => {
    const a = b.dataset.a;
    if (a === 'import') b.onclick = importFlow;
    if (a === 'test') b.onclick = testFlow;
    if (a === 'proxy') b.onclick = proxyFlow;
  });

  await renderSources();
  on('sources:changed', renderSources);
}
