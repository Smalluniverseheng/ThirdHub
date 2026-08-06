/* ===== ThirdHub js/modules/board-cloudphone.js — 云手机板块 ===== */
import { $, icon, toast } from '../ui.js';
import { kvGet, kvSet } from '../store.js';

export async function renderCloudPhoneBoard(page) {
  const subscribed = await kvGet('cloudphone:notify', false);
  page.innerHTML = `
    <div class="page-head"><div class="page-title">云手机</div></div>
    <div style="padding:8px 16px 24px">
      <div class="card" style="text-align:center;padding:34px 20px">
        <div style="width:84px;height:84px;margin:0 auto 16px;border-radius:24px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--primary),var(--primary-deep));box-shadow:0 10px 26px rgba(59,91,253,.35)">
          <span style="width:42px;height:42px;display:block">${icon('phone')}</span>
        </div>
        <div style="font-size:19px;font-weight:800">云手机</div>
        <div class="muted" style="max-width:300px;margin:10px auto 0;line-height:1.9">
          在云端运行一台属于你的安卓手机：<br>
          24 小时在线挂机、应用多开、游戏托管，<br>
          不耗本机电量与流量。
        </div>
        <div class="row gap8 mt8" style="justify-content:center;flex-wrap:wrap;margin-top:16px">
          <span class="tag tag-blue">云端在线</span><span class="tag tag-green">应用多开</span><span class="tag tag-gold">游戏托管</span>
        </div>
        <button class="btn btn-primary" style="margin-top:20px;min-width:180px" data-a="notify">
          ${subscribed ? icon('check') + ' 已预约上线提醒' : icon('bell') + ' 预约上线提醒'}
        </button>
        <div class="muted" style="margin-top:10px;font-size:11.5px">功能正在开发中，上线后第一时间通知你</div>
      </div>
    </div>`;
  $('[data-a="notify"]', page).onclick = async () => {
    const v = !(await kvGet('cloudphone:notify', false));
    await kvSet('cloudphone:notify', v);
    toast(v ? '已预约，上线后通知你' : '已取消预约', v ? 'ok' : '');
    renderCloudPhoneBoard(page);
  };
}
