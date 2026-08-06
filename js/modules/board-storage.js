/* ===== ThirdHub js/modules/board-storage.js — 存储板块（云存储容量 + 数据备份） ===== */
import { $, el, esc, icon, toast, modal, actionSheet, confirmDialog, formRow, fmtBytes } from '../ui.js';
import { db, kvGet } from '../store.js';
import { currentUser, levelById } from '../auth.js';
import { hasCloud, configureCloud } from '../supabase.js';

export async function renderStorageBoard(page) {
  page.innerHTML = `
    <div class="page-head"><div class="page-title">存储</div></div>
    <div style="padding:4px 16px 24px" data-role="body"></div>`;
  const body = $('[data-role="body"]', page);

  const u = await currentUser();
  const lv = levelById(u ? u.level : 'guest');
  const used = u ? (u.storageUsed || 0) : 0;
  const pct = lv.storage === Infinity ? 0 : Math.min(100, (used / lv.storage) * 100);

  body.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row gap8 mb8">
        <span class="list-ico">${icon('cloud')}</span>
        <div class="grow">
          <div style="font-size:15px;font-weight:800">云存储</div>
          <div class="muted">${hasCloud() ? (u ? '已连接 · ' + esc(u.email || '') : '已连接 · 未登录') : '未配置（纯本地模式）'}</div>
        </div>
        <span class="tag ${lv.tag}">${lv.name}</span>
      </div>
      <div class="row" style="justify-content:space-between"><span class="muted">已用 ${fmtBytes(used)}</span><span class="muted">${lv.storage === Infinity ? '无限' : fmtBytes(lv.storage)}</span></div>
      <div class="storage-bar" style="margin-top:6px"><div class="storage-fill" style="width:${pct}%"></div></div>
      <div class="muted mt8" style="font-size:11.5px">云存储用于书架 / 历史 / 收藏 / 进度的多设备同步备份。会员只扩容存储，AI 对话使用你自己的 API Key。</div>
    </div>

    <button class="list-item" style="width:100%;margin-bottom:8px" data-a="backup">
      <span class="list-ico">${icon('download')}</span>
      <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">本地备份 / 恢复</div><div class="muted">导出或导入全部本地数据</div></div>
      <span class="list-arrow">${icon('arrowR')}</span>
    </button>
    <button class="list-item" style="width:100%;margin-bottom:8px" data-a="cache">
      <span class="list-ico">${icon('trash')}</span>
      <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">清理缓存</div><div class="muted">清空章节内容缓存，不影响书架和进度</div></div>
      <span class="list-arrow">${icon('arrowR')}</span>
    </button>
    <button class="list-item" style="width:100%" data-a="cloud">
      <span class="list-ico">${icon('settings')}</span>
      <div class="grow" style="text-align:left"><div style="font-size:14px;font-weight:600">云端同步配置</div><div class="muted">自定义 Supabase 云端</div></div>
      <span class="list-arrow">${icon('arrowR')}</span>
    </button>`;

  $('[data-a="backup"]', body).onclick = async () => {
    const v = await actionSheet('本地备份', [
      { label: '导出全部数据（JSON）', value: 'export', icon: 'export' },
      { label: '从备份文件恢复', value: 'import', icon: 'import' },
    ]);
    if (v === 'export') {
      const data = {};
      for (const s of ['kv', 'sources', 'shelf', 'history', 'favorites', 'chats']) data[s] = await db.all(s);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'thirdhub-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      toast('备份已导出', 'ok');
    } else if (v === 'import') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = async () => {
        try {
          const data = JSON.parse(await input.files[0].text());
          for (const [store, rows] of Object.entries(data)) {
            if (!['kv', 'sources', 'shelf', 'history', 'favorites', 'chats'].includes(store)) continue;
            for (const row of rows) await db.put(store, row);
          }
          toast('恢复完成，即将刷新', 'ok');
          setTimeout(() => location.reload(), 800);
        } catch (e) { toast('备份文件无效', 'err'); }
      };
      input.click();
    }
  };

  $('[data-a="cache"]', body).onclick = async () => {
    if (await confirmDialog('清理缓存', '将清空所有章节内容缓存（不影响书架和进度），确定吗？', '清理', true)) {
      await db.clear('cache');
      toast('缓存已清理', 'ok');
    }
  };

  $('[data-a="cloud"]', body).onclick = async () => {
    const url = await kvGet('cloud:url', '');
    const key = await kvGet('cloud:anonKey', '');
    const b2 = el(`<div>
      ${formRow('Supabase URL', `<input class="input" data-f="url" value="${esc(url)}" placeholder="留空使用默认云端">`)}
      ${formRow('Anon Key', `<textarea class="input" rows="3" data-f="key">${esc(key)}</textarea>`)}
    </div>`);
    const m = modal({
      title: '云端同步配置', body: b2,
      footer: '<button class="btn grow" data-a="cancel">取消</button><button class="btn btn-primary grow" data-a="save">保存并连接</button>',
    });
    $('[data-a="cancel"]', m.mask).onclick = m.close;
    $('[data-a="save"]', m.mask).onclick = async () => {
      const ok = await configureCloud($('[data-f="url"]', b2).value, $('[data-f="key"]', b2).value);
      m.close();
      toast(ok ? '云端已连接' : '连接失败，请检查配置', ok ? 'ok' : 'err');
    };
  };
}
