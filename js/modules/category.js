/* ===== ThirdHub js/modules/category.js — 分类页（内容分类 + 源管理 + 测试工具） ===== */
import { $, $$, el, esc, icon, toast, modal, actionSheet, confirmDialog, formRow, fmtDate } from '../ui.js';
import { listSources, removeSource, toggleSource, importSource, SOURCE_TYPES, validateSource, parseSourceMeta } from '../engine/source-service.js';
import { isTvboxConfig, loadTvboxSites, tvboxToJsSource } from '../engine/tvbox-adapter.js';
import { isLegadoJson, legadoToJsSources, isBasicJson, basicToJsSources } from '../engine/legado-adapter.js';
import { isVeneraJs, isVeneraIndex, veneraToJsSource } from '../engine/venera-adapter.js';
import { getEngine, destroyEngines } from '../engine/source-engine.js';
import { on, kvGet, kvSet } from '../store.js';
import { getSupabase, hasCloud } from '../supabase.js';
import { currentUser } from '../auth.js';

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
      <div class="section-head" style="padding:0 18px 10px">${icon('cloud')}<span>源仓库</span><span class="muted" data-v="repocount"></span></div>
      <div data-role="repos" style="padding:0 16px"></div>
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
    { a: 'official', ico: 'cloud', name: '官方仓库', desc: '密码保护的私有仓库，书源 / 图源 / 视频源集中存放' },
    { a: 'import', ico: 'import', name: '导入连接器', desc: '支持阅读APP书源、Venera 漫画图源、CSS书源、TVbox 配置、JS 连接器' },
    { a: 'test', ico: 'test', name: '连接器测试工具', desc: '验证连接器的搜索/目录/内容函数' },
    { a: 'proxy', ico: 'globe', name: '代理设置', desc: '配置后端代理地址（Cloudflare Worker）' },
  ].map((m) => `
    <button class="cat-mgr-card card card-press" data-a="${m.a}">
      <span class="cat-mgr-ico">${icon(m.ico)}</span>
      <span class="cat-mgr-body">
        <span class="cat-mgr-name">${m.name}</span>
        <span class="muted cat-mgr-desc">${m.desc}</span>
      </span>
      <span class="list-arrow">${icon('arrowR')}</span>
    </button>`).join('');

  let curFilter = null;   /* v3.6：类型卡片筛选 */
  let justImported = false;
  const refreshSources = () => { const a = justImported; justImported = false; return renderSources(curFilter, a); };
  async function renderSources(filterType, animNew) {
    const all = await listSources();
    $('[data-v="count"]', page).textContent = `（${all.length}）`;
    SOURCE_TYPES.forEach((t) => {
      const elc = $(`[data-count="${t.id}"]`, page);
      const n = all.filter((s) => s.type === t.id).length;
      if (elc) elc.textContent = n ? n + ' 个源' : '';
    });
    /* v7.3：把连接器同步到电脑后端（书源托管） */
  async function syncSourceToComputer(s) {
    try {
      const { listDevices, getStatus, backendCall } = await import('./compute.js');
      const dev = (listDevices() || []).find((d) => getStatus(d.id) === 'online');
      if (!dev) { toast('没有在线后端设备，请先在后端板块连接', 'err'); return; }
      const payload = {
        id: s.id, name: s.name, type: s.type, version: s.version,
        searchUrl: s.searchUrl || '', searchMethod: s.searchMethod || 'GET', searchParse: s.searchParse || '',
        searchItems: s.searchItems || '', searchTitle: s.searchTitle || '', searchAuthor: s.searchAuthor || '',
        searchCover: s.searchCover || '', searchUrlItem: s.searchUrlItem || '', itemRegex: s.itemRegex || '',
        headers: s.headers || {}, code: s.code || '',
      };
      const r = await backendCall(dev.id, 'sources.import', { sources: [payload] });
      toast(r.ok ? '已同步到电脑：' + (r.total || 1) + ' 个书源' : (r.error || '同步失败'), r.ok ? 'ok' : 'err');
    } catch (e) { toast('同步失败：' + e.message, 'err'); }
  }
  /* v3.6：点击类型卡片筛选对应源，再点一次恢复全部 */
    $$('.cat-type-card', page).forEach((c) => c.classList.toggle('on', !!filterType && c.dataset.t === filterType));
    const sources = filterType ? all.filter((s) => s.type === filterType) : all;
    const box = $('[data-role="sources"]', page);
    if (!all.length) {
      box.innerHTML = `<div class="empty">
        <div class="empty-ico">${icon('plug')}</div>
        <div class="empty-title">暂无连接器</div>
        <div class="muted" style="max-width:300px;line-height:1.8">ThirdHub 零内置内容源。<br>点击右上角导入你自己的连接器后，即可在「发现」页使用。</div>
      </div>`;
      return;
    }
    if (!sources.length) {
      box.innerHTML = `<div class="empty"><div class="empty-title">该类型下暂无连接器</div><div class="muted">再点一次上方卡片显示全部</div></div>`;
      return;
    }
    const head = filterType ? `<div class="muted" style="font-size:12px;padding:0 2px 8px">仅显示「${esc((SOURCE_TYPES.find((t) => t.id === filterType) || {}).name || filterType)}」连接器，再点一次卡片显示全部</div>` : '';
    box.innerHTML = head;
    sources.sort((a, b) => b.importedAt - a.importedAt).forEach((s, idx) => {
      const t = SOURCE_TYPES.find((x) => x.id === s.type);
      const item = el(`<div class="source-item card card-press${animNew ? ' cat-pop' : ''}" style="${animNew ? `animation-delay:${Math.min(idx, 12) * 40}ms` : ''}">
        <span class="source-item-ico">${icon(t ? t.icon : 'folder')}</span>
        <div class="grow" style="min-width:0;text-align:left">
          <div class="row gap4"><span style="font-size:14px;font-weight:600" class="ellipsis">${esc(s.name)}</span><span class="tag ${s.enabled ? 'tag-green' : 'tag-gray'}">${s.enabled ? '已启用' : '已停用'}</span></div>
          <div class="muted ellipsis">${esc(t ? t.name : s.type)} · v${esc(s.version)}${s.author ? ' · ' + esc(s.author) : ''}</div>
        </div>
        <button class="msg-act" data-a="menu">${icon('more')}</button>
      </div>`);
      $('[data-a="menu"]', item).onclick = async () => {
        const v = await actionSheet(s.name, [
          { label: s.enabled ? '停用' : '启用', value: 'toggle', icon: s.enabled ? 'close' : 'check' },
          { label: '测试连接器', value: 'test', icon: 'test' },
          { label: '同步到电脑', value: 'sync', icon: 'cpu' },
          { label: '查看代码', value: 'code', icon: 'edit' },
          { label: '删除', value: 'del', icon: 'trash', danger: true },
        ]);
        if (v === 'toggle') { await toggleSource(s.id, !s.enabled); refreshSources(); }
        if (v === 'test') testSource(s);
        if (v === 'sync') syncSourceToComputer(s);
        if (v === 'code') modal({ title: s.name + ' 源码', body: `<pre style="font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary)">${esc(s.code.slice(0, 20000))}</pre>` });
        if (v === 'del' && await confirmDialog('删除连接器', `确定删除「${s.name}」吗？相关书架条目将无法继续更新。`, '删除', true)) {
          await removeSource(s.id);
          destroyEngines();
          refreshSources();
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
        refreshSources();
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
        refreshSources();
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
          refreshSources();
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
    justImported = true;
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
      if (n) justImported = true;
      refreshSources();
      if (n) { toast(`已导入 ${n} 个 Venera 图源${dup ? `（跳过重复 ${dup}）` : ''}${fail ? `（失败 ${fail}）` : ''}`, 'ok'); }
      else toast(dup ? '选中的图源已全部存在' : '导入失败，请检查网络', 'err');
    };
  }

  async function importText(text, from) {
    try {
      /* v3.0：粘贴的是裸 URL 时自动下载后导入 */
      const bare = String(text || '').trim();
      if (/^https?:\/\/\S+$/.test(bare) && bare !== from) {
        toast('正在下载链接内容…');
        const { httpGet } = await import('../engine/proxy.js');
        const dl = await httpGet(bare);
        return await importText(dl, bare);
      }
      if (isVeneraIndex(text)) return await importVeneraIndex(text, from);
      if (isVeneraJs(text)) {
        const s2 = await importSource(veneraToJsSource(text, /^https?:\/\//.test(from || '') ? from : ''));
        justImported = true;
        return toast(`已导入 Venera 图源「${s2.name}」`, 'ok');
      }
      /* v4.1：落雪音乐（LX Music）自定义源脚本 */
      const { isLxSource, lxToJsSource } = await import('../engine/lx-adapter.js');
      if (isLxSource(text)) {
        const s3 = await importSource(lxToJsSource(text));
        justImported = true;
        return toast(`已导入 LX 音乐源「${s3.name}」`, 'ok');
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
        justImported = true;
        toast(`已从 TVbox 配置导入 ${n} 个视频源`, 'ok');
        return;
      }
      const s = await importSource(text);
      justImported = true;
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
    const v = await actionSheet('选择要测试的连接器', [
      { label: `⚡ 一键测试全部连接器（${sources.length} 个）`, value: '__all', icon: 'test' },
      ...sources.map((s) => ({ label: s.name, value: s.id, icon: 'plug' })),
    ]);
    if (!v) return;
    if (v === '__all') return testAllSources(sources);
    const s = sources.find((x) => x.id === v);
    testSource(s);
  }

  /* v3.6：一键测试全部连接器——逐个跑 search，汇总通过/失败 */
  async function testAllSources(sources) {
    const body = el('<div></div>');
    const m = modal({ title: '一键测试全部连接器', body, footer: '<button class="btn grow" data-a="close">关闭</button>' });
    $('[data-a="close"]', m.mask).onclick = m.close;
    let ok = 0, fail = 0;
    const head = el(`<div class="muted" style="padding-bottom:8px" data-v="prog"></div>`);
    body.appendChild(head);
    for (const s of sources) {
      $('[data-v="prog"]', body).textContent = `测试中 ${ok + fail + 1}/${sources.length}：${s.name}`;
      const row = el(`<div class="list-item" style="margin-bottom:6px;padding:10px 12px">
        <span class="list-ico">${icon('plug')}</span>
        <div class="grow" style="min-width:0"><div style="font-size:13.5px;font-weight:600" class="ellipsis">${esc(s.name)}</div>
        <div class="muted ellipsis" style="font-size:12px" data-v="st">排队中…</div></div>
        <span data-v="tag"></span></div>`);
      body.appendChild(row);
      row.scrollIntoView({ block: 'nearest' });
      const st = $('[data-v="st"]', row), tag = $('[data-v="tag"]', row);
      st.textContent = '测试中…';
      try {
        const engine = getEngine(s);
        await engine.init();
        let r = await engine.search('测试', 1);
        if (typeof r === 'string') r = JSON.parse(r);
        if (!r || !r.length) throw new Error('搜索无结果');
        ok++;
        st.textContent = `搜索返回 ${r.length} 条`;
        tag.innerHTML = '<span class="tag tag-green">通过</span>';
      } catch (e) {
        fail++;
        st.textContent = String(e.message || e).slice(0, 60);
        tag.innerHTML = '<span class="tag tag-red">失败</span>';
      }
    }
    $('[data-v="prog"]', body).innerHTML = `测试完成：<b style="color:var(--green,#22c55e)">${ok} 通过</b> / <b style="color:#ef4444">${fail} 失败</b>（共 ${sources.length} 个）`;
    toast(`测试完成：${ok} 通过，${fail} 失败`, fail ? 'err' : 'ok');
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

  /* v3.6：类型卡片 = 筛选器。平时显示全部源；点卡片只看该类型，再点恢复 */
  $$('.cat-type-card', page).forEach((c) => {
    c.onclick = () => {
      curFilter = (curFilter === c.dataset.t) ? null : c.dataset.t;
      renderSources(curFilter, false);
    };
  });

  $('[data-a="import"]', page).onclick = importFlow;
  $$('.cat-manager [data-a]', page).forEach((b) => {
    const a = b.dataset.a;
    if (a === 'import') b.onclick = importFlow;
    if (a === 'test') b.onclick = testFlow;
    if (a === 'proxy') b.onclick = proxyFlow;
    if (a === 'official') b.onclick = officialRepoFlow;
  });

  /* ---------- v4.3 官方仓库：密码保护的私有源仓库（云端存储，本人专用） ---------- */
  async function officialRepoFlow() {
    if (!hasCloud()) { toast('云端暂不可用，请检查网络后重试', 'err'); return; }
    /* v6.0：开发者账号免密直进（th_profiles.role=developer；管理员仍需密码；后端 repo_* 同步豁免） */
    try {
      const u = await currentUser();
      if (u && u.id) {
        const { data: prof } = await getSupabase().from('th_profiles').select('role').eq('id', u.id).maybeSingle();
        if (prof && prof.role === 'developer') {
          const { data, error } = await getSupabase().rpc('repo_list', { pwd: '' });
          if (!error) { openOfficialRepo('', data || []); return; }
        }
      }
    } catch (e) { /* 非开发者或查询失败：走正常密码流程 */ }
    let pwd = await kvGet('repo:pwd', '');
    const body = el(`<div>
      ${formRow('仓库密码', `<input class="input" data-f="pwd" type="password" placeholder="请输入仓库密码" value="${esc(pwd)}">`)}
      <label class="row gap8" style="padding:4px 2px;font-size:13px;cursor:pointer"><input type="checkbox" data-f="remember" ${pwd ? 'checked' : ''}> 在本机记住密码</label>
      <div class="muted" style="font-size:12px;padding-top:6px">官方仓库是管理员设立的云端源仓库，凭密码取用。</div>
    </div>`);
    const m = modal({
      title: '官方仓库', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">解锁</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    const unlock = async () => {
      const pw = $('[data-f="pwd"]', body).value;
      if (!pw) return toast('请输入密码', 'err');
      const okBtn = $('[data-a="ok"]', m.mask);
      okBtn.disabled = true; okBtn.textContent = '验证中…';
      try {
        const { data: pass } = await getSupabase().rpc('repo_check', { pwd: pw });
        if (!pass) throw new Error('密码错误');
        const { data, error } = await getSupabase().rpc('repo_list', { pwd: pw });
        if (error) throw new Error(error.message || '云端错误');
        if ($('[data-f="remember"]', body).checked) await kvSet('repo:pwd', pw); else await kvSet('repo:pwd', '');
        m.close();
        openOfficialRepo(pw, data);
      } catch (e) {
        toast('解锁失败：' + e.message, 'err');
        okBtn.disabled = false; okBtn.textContent = '解锁';
      }
    };
    $('[data-a="ok"]', m.mask).onclick = unlock;
    $('[data-f="pwd"]', body).addEventListener('keydown', (e2) => { if (e2.key === 'Enter') unlock(); });
  }

  async function importOfficialEntry(entry, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }
    try {
      const existing = await listSources();
      if (existing.some((s) => s.name === entry.name)) { toast(`「${entry.name}」已存在`, 'err'); if (btn) { btn.textContent = '已添加'; } return 'exist'; }
      if (entry.fmt === 'tvbox') await importSource(tvboxToJsSource(entry.data));
      else if (entry.fmt === 'venera') await importSource(veneraToJsSource(entry.data.code || '', entry.data.name || entry.name));
      else if (entry.fmt === 'js') await importSource(String(entry.data.code || entry.data || ''));
      else await importSource(legadoToJsSources(JSON.stringify([entry.data]))[0]);
      if (btn) btn.textContent = '已添加';
      return 'ok';
    } catch (e) {
      toast(`「${entry.name}」导入失败：${e.message}`, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '添加'; }
      return 'fail';
    }
  }

  /* v5.3：把本机已验证可用的源分享到官方仓库（自动分类；需云端 repo_upsert 支持） */
  async function shareMySources(pwd) {
    const { listSources, validateSource } = await import('../engine/source-service.js');
    const all = await listSources();
    if (!all.length) { toast('本机还没有可分享的源', 'err'); return; }
    const CAT_MAP = { novel: '小说', comic: '漫画', video: '视频', audio: '有声', music: '音乐' };
    const sel = new Set();
    const body = el(`<div>
      <div class="muted" style="font-size:12px;line-height:1.8;margin-bottom:10px">选择要分享的源（会先在本机验证可用性，通过后自动上传并按类型分类）：</div>
      <div data-role="list" style="max-height:340px;overflow-y:auto"></div>
    </div>`);
    const box = $('[data-role="list"]', body);
    const render = () => {
      box.innerHTML = all.map((s) => `
        <label class="row gap8" style="padding:8px 4px;border-top:1px solid var(--line);cursor:pointer">
          <input type="checkbox" data-sel="${esc(s.id)}" ${sel.has(s.id) ? 'checked' : ''}>
          <div class="grow" style="min-width:0">
            <div style="font-size:13.5px;font-weight:600" class="ellipsis">${esc(s.name)}</div>
            <div class="muted" style="font-size:11.5px">${esc(CAT_MAP[s.type] || s.type)} · ${esc(s.version || '')}</div>
          </div>
        </label>`).join('')
        || '<div class="muted" style="padding:20px;text-align:center">本机还没有源</div>';
      $$('[data-sel]', box).forEach((c) => c.onchange = () => { if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); });
    };
    render();
    const m = modal({
      title: '分享我的源', body,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">验证并分享</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="ok"]', m.mask).onclick = async () => {
      const picked = all.filter((s) => sel.has(s.id));
      if (!picked.length) return toast('请先勾选要分享的源', 'err');
      const okBtn = $('[data-a="ok"]', m.mask);
      okBtn.disabled = true; okBtn.textContent = '验证中…';
      /* 1) 本机验证：结构校验 + 真实搜索测试 */
      const items = [];
      for (let i = 0; i < picked.length; i++) {
        const s = picked[i];
        okBtn.textContent = `验证 ${i + 1}/${picked.length}：${s.name}`;
        try {
          validateSource(s.code);
          const { searchAll } = await import('../engine/source-service.js');
          const res = await searchAll('测试', { only: s.id, types: [s.type] });
          if (!res.length) throw new Error('搜索无结果（可能需特定关键词或站点维护中）');
          items.push({ id: s.id, name: s.name, fmt: 'venera', category: CAT_MAP[s.type] || '其他', data: { code: s.code, name: s.name } });
        } catch (e) { toast(`「${s.name}」验证未通过：${e.message}`, 'err'); }
      }
      if (!items.length) { okBtn.disabled = false; okBtn.textContent = '验证并分享'; return; }
      /* 2) 上传官方仓库 */
      okBtn.textContent = '上传中…';
      try {
        const { data, error } = await getSupabase().rpc('repo_upsert', { pwd, items });
        if (error) throw new Error(error.message || '云端错误');
        toast(`已分享 ${data || items.length} 个源到官方仓库`, 'ok');
        m.close();
      } catch (e) {
        toast('分享失败：' + e.message + '（若提示函数不存在，请管理员在云端开启分享功能）', 'err');
        okBtn.disabled = false; okBtn.textContent = '验证并分享';
      }
    };
  }

  function openOfficialRepo(pwd, rows) {
    const groups = {};
    (rows || []).forEach((r) => { const c = r.category || '其他'; (groups[c] = groups[c] || []).push(r); });
    const cats = Object.keys(groups).sort();
    const body = el(`<div>
      <div class="row gap8" style="padding:0 0 10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm grow" data-a="importall">全部导入（${(rows || []).length}）</button>
        <button class="btn btn-sm" data-a="changepwd">修改密码</button>
        <button class="btn btn-sm" data-a="share">分享我的源</button>
      </div>
      <div data-role="list"></div>
    </div>`);
    const listBox = $('[data-role="list"]', body);
    /* v6.4：官方仓库两级树状分组（健康源/18+ 源 → 分类） */
    const renderRows = (rows2) => {
      const zones = { health: [], adult: [] };
      (rows2 || []).forEach((r) => { zones[r.zone === 'adult' ? 'adult' : 'health'].push(r); });
      const zoneUI = (zlabel, zemoji, zrows, open) => {
        if (!zrows.length) return '';
        const g2 = {};
        zrows.forEach((r) => { const c = r.category || '其他'; (g2[c] = g2[c] || []).push(r); });
        return '<details ' + (open ? 'open' : '') + ' style="border:1px solid var(--line);border-radius:10px;margin-bottom:10px;background:var(--card)">' +
          '<summary style="cursor:pointer;padding:10px 12px;font-size:14px;font-weight:700;list-style:none;display:flex;align-items:center;gap:6px">' +
          zemoji + ' ' + esc(zlabel) + ' <span class="muted" style="font-weight:400">（' + zrows.length + '）</span>' +
          '<span style="margin-left:auto;opacity:.6">▸</span></summary>' +
          '<div style="padding:0 10px 10px">' +
          Object.keys(g2).sort().map((c) => '<div style="border-top:1px dashed var(--line);margin-top:4px">' +
            '<div class="section-head" style="padding:8px 2px 4px">' + icon('folder') + '<span>' + esc(c) + '</span><span class="muted">（' + g2[c].length + '）</span></div>' +
            g2[c].map((r) => '<div class="row gap8" style="padding:8px 4px;border-bottom:1px solid var(--line)">' +
              '<div class="grow" style="min-width:0">' +
                '<div style="font-size:14px;font-weight:600" class="ellipsis">' + esc(r.name) + '</div>' +
                '<div class="muted" style="font-size:12px">' + (r.fmt === 'tvbox' ? '视频源' : r.fmt === 'venera' ? '图源' : '书源') + ' · ' + fmtDate(r.updated_at) + '</div>' +
              '</div>' +
              '<button class="btn btn-primary" style="flex:none;padding:6px 14px" data-add="' + esc(r.id) + '">添加</button>' +
            '</div>').join('') +
          '</div>').join('') +
          '</div></details>';
      };
      listBox.innerHTML = rows2 && rows2.length
        ? zoneUI('健康源', '🟢', zones.health, true) + zoneUI('18+ 源', '🔞', zones.adult, false)
        : '<div class="ai-drawer-empty" style="padding:30px 0">仓库还是空的<br><span style="font-size:12px">在管理后台（admin.html）上传书源后会出现在这里</span></div>';
      $$('[data-add]', listBox).forEach((b) => {
        b.onclick = async () => {
          const entry = (rows2 || []).find((x) => x.id === b.dataset.add);
          if (entry) { await importOfficialEntry(entry, b); justImported = true; refreshSources(); }
        };
      });
    };
    renderRows(rows);
    const m = modal({
      title: '官方仓库', body,
      footer: '<button class="btn grow" data-a="close">关闭</button>',
    });
    $('[data-a="close"]', m.mask).onclick = m.close;
    /* v5.3：分享我的源（本机验证可用后上传官方仓库，自动分类） */
    $('[data-a="share"]', body).onclick = () => shareMySources(pwd);
    $('[data-a="importall"]', body).onclick = async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      let ok = 0, exist = 0, fail = 0;
      for (const r of rows || []) {
        const res = await importOfficialEntry(r, null);
        if (res === 'ok') ok++; else if (res === 'exist') exist++; else fail++;
        btn.textContent = `导入中… ${ok + exist + fail}/${rows.length}`;
      }
      justImported = true; refreshSources();
      toast(`导入完成：新增 ${ok}${exist ? `，已存在 ${exist}` : ''}${fail ? `，失败 ${fail}` : ''}`, ok ? 'ok' : 'err');
      btn.textContent = '全部导入';
    };
    $('[data-a="changepwd"]', body).onclick = () => {
      const b2 = el(`<div>${formRow('新密码', '<input class="input" data-f="np" type="password" placeholder="请输入新密码">')}<div class="muted" style="font-size:12px;padding-top:6px">修改后请用新密码解锁官方仓库，旧密码立即失效。</div></div>`);
      const m2 = modal({
        title: '修改仓库密码', body: b2,
        footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">确认修改</button>',
      });
      $('[data-a="cancel"]', m2.mask).onclick = m2.close;
      $('[data-a="ok"]', m2.mask).onclick = async () => {
        const np = $('[data-f="np"]', b2).value;
        if (!np || np.length < 4) return toast('新密码至少 4 位', 'err');
        const { data: okp } = await getSupabase().rpc('repo_set_password', { pwd, new_pwd: np });
        if (okp) { await kvSet('repo:pwd', np); pwd = np; m2.close(); toast('密码已修改', 'ok'); }
        else toast('修改失败', 'err');
      };
    };
  }

  /* ---------- v3.0 源仓库：添加你自己的仓库地址（index.json），只从你的仓库选源导入 ---------- */
  const REPOS_KEY = 'source:repos';
  const getRepos = async () => (await kvGet(REPOS_KEY, [])) || [];
  const saveRepos = (list) => kvSet(REPOS_KEY, list);

  /* 拉取仓库索引，识别两种格式：
     - Venera 图源仓库：[{ name, fileName, key, version }]（图源文件与 index.json 同目录）
     - 阅读APP书源合集：[{ bookSourceName, bookSourceUrl, ... }]（每条即完整书源） */
  async function fetchRepo(repo) {
    const { httpGet } = await import('../engine/proxy.js');
    const text = await httpGet(repo.url);
    const base = repo.url.slice(0, repo.url.lastIndexOf('/') + 1);
    if (isVeneraIndex(text)) {
      const arr = JSON.parse(String(text).trim());
      return { fmt: 'venera', entries: arr.map((it) => ({ name: it.name || it.key, version: it.version || '', file: base + it.fileName })) };
    }
    /* v3.8：TVbox 视频源配置也可以作为仓库添加 */
    if (isTvboxConfig(text)) {
      const sites = await loadTvboxSites(text);
      return { fmt: 'tvbox', entries: sites.map((s) => ({ name: s.name, version: '', site: s })) };
    }
    if (isLegadoJson(text)) {
      const arr = JSON.parse(String(text).trim());
      const list = Array.isArray(arr) ? arr : [arr];
      return { fmt: 'legado', entries: list.filter((it) => it && (it.bookSourceName || it.bookSourceUrl)).map((it) => ({ name: it.bookSourceName || it.bookSourceUrl, version: '', raw: it })) };
    }
    throw new Error('无法识别的仓库格式（支持 Venera 图源仓库 / 阅读APP书源合集 / TVbox 配置）');
  }

  async function addRepoEntry(repo, entry, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }
    try {
      const existing = await listSources();
      if (existing.some((s) => s.name === entry.name)) { toast(`「${entry.name}」已存在`, 'err'); return; }
      if (repo.fmt === 'venera') {
        const { httpGet } = await import('../engine/proxy.js');
        const code = await httpGet(entry.file);
        await importSource(veneraToJsSource(code, entry.file));
      } else if (repo.fmt === 'tvbox') {
        await importSource(tvboxToJsSource(entry.site));
      } else {
        await importSource(legadoToJsSources(JSON.stringify([entry.raw]))[0]);
      }
      toast(`已添加「${entry.name}」`, 'ok');
      if (btn) btn.textContent = '已添加';
    } catch (e) {
      toast('添加失败：' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '添加'; }
    }
  }

  async function openRepo(repo) {
    const body = el('<div class="muted" style="padding:12px 4px">正在读取仓库…</div>');
    const m = modal({
      title: '源仓库', body,
      footer: '<button class="btn grow" data-a="close">关闭</button>',
    });
    $('[data-a="close"]', m.mask).onclick = m.close;
    try {
      const data = await fetchRepo(repo);
      repo.fmt = data.fmt;
      body.innerHTML = `<div class="muted" style="padding:2px 4px 10px;font-size:12px;word-break:break-all">${esc(repo.url)}<br>共 ${data.entries.length} 个源（${data.fmt === 'venera' ? 'Venera 图源' : data.fmt === 'tvbox' ? 'TVbox 视频源' : '阅读APP书源'}）</div>` +
        data.entries.map((e2, i) => `
          <div class="row gap8" style="padding:8px 4px;border-top:1px solid var(--line)">
            <div class="grow" style="min-width:0">
              <div style="font-size:14px;font-weight:600" class="ellipsis">${esc(e2.name)}</div>
              ${e2.version ? `<div class="muted" style="font-size:12px">v${esc(e2.version)}</div>` : ''}
            </div>
            <button class="btn btn-primary" style="flex:none;padding:6px 14px" data-add="${i}">添加</button>
          </div>`).join('');
      $$('[data-add]', body).forEach((b) => {
        b.onclick = () => addRepoEntry(repo, data.entries[Number(b.dataset.add)], b);
      });
    } catch (e) {
      body.innerHTML = `<div class="muted" style="padding:12px 4px">读取失败：${esc(e.message)}</div>`;
    }
  }

  async function renderRepos() {
    const repos = await getRepos();
    $('[data-v="repocount"]', page).textContent = repos.length ? `（${repos.length}）` : '';
    const box = $('[data-role="repos"]', page);
    box.innerHTML = repos.map((r, i) => `
      <div class="list-item" style="margin-bottom:8px">
        <span class="list-ico">${icon('cloud')}</span>
        <button class="grow card-press" style="text-align:left;min-width:0;background:none;border:none;padding:0" data-open="${i}">
          <div style="font-size:14px;font-weight:600" class="ellipsis">${esc(r.name || r.url)}</div>
          <div class="muted ellipsis" style="font-size:12px">${esc(r.url)}</div>
        </button>
        <button class="icon-btn" data-del="${i}" title="删除仓库">${icon('trash')}</button>
      </div>`).join('') + `
      <button class="btn grow" data-a="addrepo" style="margin-bottom:4px">＋ 添加源仓库地址</button>
      <div class="muted" style="font-size:12px;padding:2px 2px 8px;line-height:1.7">填入你维护的 index.json 地址（GitHub / jsDelivr 均可），仓库里整理的书源、图源会列在这里，随取随用。</div>`;
    $$('[data-open]', box).forEach((b) => { b.onclick = async () => openRepo((await getRepos())[Number(b.dataset.open)]); });
    $$('[data-del]', box).forEach((b) => {
      b.onclick = async () => {
        const repos2 = await getRepos();
        const r = repos2[Number(b.dataset.del)];
        if (!(await confirmDialog('删除仓库', `仅删除仓库地址「${r.name || r.url}」，已导入的连接器不受影响。`))) return;
        repos2.splice(Number(b.dataset.del), 1);
        await saveRepos(repos2);
        renderRepos();
      };
    });
    $('[data-a="addrepo"]', box).onclick = () => {
      const body = el(`<div>${formRow('仓库地址', '<input class="input" data-f="repo" placeholder="https://…/index.json">')}<div class="muted" style="font-size:12px;padding-top:8px">该地址应指向一个 index.json：可以是 Venera 图源仓库索引，也可以是阅读APP书源合集 JSON。</div></div>`);
      const m = modal({
        title: '添加源仓库', body,
        footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="ok">验证并添加</button>',
      });
      $('[data-a="cancel"]', m.mask).onclick = m.close;
      $('[data-a="ok"]', m.mask).onclick = async () => {
        const url = $('[data-f="repo"]', body).value.trim();
        if (!/^https?:\/\/\S+$/.test(url)) return toast('请输入有效的 http(s) 地址', 'err');
        const okBtn = $('[data-a="ok"]', m.mask);
        okBtn.disabled = true; okBtn.textContent = '验证中…';
        try {
          const repo = { url, addedAt: Date.now() };
          const data = await fetchRepo(repo);
          repo.fmt = data.fmt;
          repo.name = url.replace(/^https?:\/\//, '').slice(0, 40);
          const repos2 = await getRepos();
          if (repos2.some((r) => r.url === url)) { toast('该仓库已添加', 'err'); m.close(); return; }
          repos2.push(repo);
          await saveRepos(repos2);
          m.close();
          renderRepos();
          toast(`仓库已添加（${data.entries.length} 个源）`, 'ok');
          openRepo(repo);
        } catch (e) {
          toast('验证失败：' + e.message, 'err');
          okBtn.disabled = false; okBtn.textContent = '验证并添加';
        }
      };
    };
  }

  try { const { restorePendingSources } = await import('../engine/source-sync.js'); await restorePendingSources(); } catch (e) {}
  await renderSources(null, false);
  await renderRepos();
  on('sources:changed', refreshSources);
}
