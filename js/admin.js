/* ===== ThirdHub js/admin.js — 管理后台（v1.3） =====
   入口 admin.html · 账号 admin · 密码由管理员在云端配置（不在此展示）
   侧边栏导航 / 仪表盘 / 用户管理（等级弹层选择·昵称编辑与恢复·多管理员·关注星标）/ 用户数据（书源·API 密钥）/
   订单 / 发票 / 会员定价 / 模型定价 / 排行榜（表格批量编辑）/ 限时免费模型（独立入口）/ 官方仓库 / 反馈 / 收款设置 / 历史版本
   所有写操作经 Supabase RPC 口令校验，敏感操作需再次输入管理员密码，无需暴露 service key */
(function () {
'use strict';

var CLOUD = {
  url: 'https://mxvxlgjzeboktufumxbp.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14dnhsZ2p6ZWJva3R1ZnVteGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODM5OTcsImV4cCI6MjA5OTk1OTk5N30.QjSLfYAFhwX72YSeAcbTN5O2_PDLaNcv76HhdGJsqpo',
};

var LEVELS = [
  { id: 'guest', name: '游客', color: '#9aa3b2', note: '本地为主' },
  { id: 'satellite', name: '卫星', color: '#60a5fa', note: '入门会员' },
  { id: 'planet', name: '行星', color: '#34d399', note: '进阶会员' },
  { id: 'star', name: '恒星', color: '#fbbf24', note: '高级会员' },
  { id: 'galaxy', name: '星系', color: '#f472b6', note: '尊享会员' },
  { id: 'universe', name: '宇宙', color: '#a78bfa', note: '顶级会员' },
];
var TABS = [
  { id: 'dashboard', name: '仪表盘', icon: '📊' },
  { id: 'users', name: '用户管理', icon: '👥' },
  { id: 'userdata', name: '用户数据', icon: '🗂️' },
  { id: 'orders', name: '订单管理', icon: '🧾' },
  { id: 'invoices', name: '发票管理', icon: '🧧' },
  { id: 'plans', name: '会员定价', icon: '💎' },
  { id: 'prices', name: '模型定价', icon: '🏷️' },
  { id: 'rank', name: '排行榜', icon: '🏆' },
  { id: 'freemodels', name: '限时免费模型', icon: '🎁' },
  { id: 'repo', name: '官方仓库', icon: '📦' },
  { id: 'feedback', name: '意见反馈', icon: '💬' },
  { id: 'paycfg', name: '收款设置', icon: '💰' },
  { id: 'system', name: '系统设置', icon: '⚙️' },
];

function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtDate(s) {
  if (!s) return '-';
  var d = new Date(s);
  if (isNaN(d)) return '-';
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function levelName(id) { var l = LEVELS.find(function (x) { return x.id === id; }); return l ? l.name : (id || '游客'); }
function levelColor(id) { var l = LEVELS.find(function (x) { return x.id === id; }); return l ? l.color : '#9aa3b2'; }

var sb = null;
var PWD = sessionStorage.getItem('th-admin-pwd') || '';
var state = {
  tab: 'dashboard',
  users: null,          // 缓存用户列表
  userTab: '',          // 用户管理等级分组
  userSearch: '',
  dataUid: '',
  orders: null,
};

/* 关注列表（本机存储） */
function getFollowed() { try { return JSON.parse(localStorage.getItem('th_admin_followed') || '[]'); } catch (e) { return []; } }
function setFollowed(v) { localStorage.setItem('th_admin_followed', JSON.stringify(v)); }
function isFollowed(uid) { return getFollowed().indexOf(uid) >= 0; }
function toggleFollow(uid) {
  var f = getFollowed();
  var i = f.indexOf(uid);
  if (i >= 0) f.splice(i, 1); else f.push(uid);
  setFollowed(f);
}

/* 昵称原始值缓存（用于误改后一键恢复） */
function getNickOrig(uid) { try { return JSON.parse(localStorage.getItem('th_admin_nick_orig') || '{}')[uid] || ''; } catch (e) { return ''; } }
function setNickOrig(uid, val) {
  var m = {}; try { m = JSON.parse(localStorage.getItem('th_admin_nick_orig') || '{}'); } catch (e) { m = {}; }
  if (val) m[uid] = val; else delete m[uid];
  localStorage.setItem('th_admin_nick_orig', JSON.stringify(m));
}

function loadSb() {
  if (sb) return Promise.resolve(sb);
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = function () {
      sb = window.supabase.createClient(CLOUD.url, CLOUD.anon);
      resolve(sb);
    };
    s.onerror = function () { reject(new Error('网络异常，Supabase 组件加载失败')); };
    document.head.appendChild(s);
  });
}

function toast(msg, ok) {
  var t = document.createElement('div');
  t.className = 'adm-toast ' + (ok === false ? 'err' : 'ok');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2400);
}

/* ---------- 登录门 ---------- */
function renderGate() {
  $('#app').innerHTML =
    '<div class="adm-login">' +
      '<img src="icons/brand.jpg" alt="ThirdHub">' +
      '<h2 style="margin:0 0 4px">ThirdHub 管理后台</h2>' +
      '<p class="adm-muted" style="margin:0 0 18px">第三方科技 · 运营管理</p>' +
      '<input class="adm-input" id="g-user" placeholder="账号" value="admin">' +
      '<input class="adm-input" id="g-pwd" type="password" placeholder="密码">' +
      '<button class="adm-btn adm-btn-primary adm-btn-block" id="g-login">登录</button>' +
      '<p id="g-err" style="color:#ef4444;font-size:13px;margin-top:10px"></p>' +
    '</div>';
  function doLogin() {
    var user = $('#g-user').value.trim();
    var pwd = $('#g-pwd').value;
    var err = $('#g-err');
    if (user !== 'admin') { err.textContent = '账号不存在'; return; }
    err.textContent = '验证中…';
    loadSb().then(function (cli) {
      return cli.rpc('admin_list_feedback', { pwd: pwd });
    }).then(function (r) {
      if (r.error) throw r.error;
      PWD = pwd;
      sessionStorage.setItem('th-admin-pwd', pwd);
      renderHome();
    }).catch(function () { err.textContent = '密码错误或云端不可用'; });
  }
  $('#g-login').onclick = doLogin;
  $('#g-pwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
}

/* ---------- 主框架（v1.3 左侧竖排导航） ---------- */
function renderHome() {
  var html = '<div class="adm-layout">' +
    '<aside class="adm-side">' +
      '<div class="adm-side-head">' +
        '<img src="icons/brand.jpg" alt="">' +
        '<div class="adm-side-title">ThirdHub<br>管理后台</div>' +
      '</div>' +
      '<nav class="adm-side-nav">' +
        TABS.map(function (t) {
          return '<button class="adm-tab' + (state.tab === t.id ? ' on' : '') + '" data-act="tab" data-t="' + t.id + '">' +
            '<span class="adm-tab-ico">' + (t.icon || '•') + '</span>' + t.name + '</button>';
        }).join('') +
      '</nav>' +
      '<div class="adm-side-foot">' +
        '<button class="adm-btn adm-btn-sm" data-act="logout">🚪 退出</button>' +
        '<span class="adm-muted" style="font-size:11px;line-height:2">v1.3 · 第三方科技</span>' +
      '</div>' +
    '</aside>' +
    '<main class="adm-main"><div id="adm-body"></div></main>' +
  '</div>';
  $('#app').innerHTML = html;
  renderBody();
}

function renderBody() {
  var body = $('#adm-body');
  if (!body) return;
  if (state.tab === 'dashboard') renderDashboard(body);
  else if (state.tab === 'users') renderUsers(body);
  else if (state.tab === 'userdata') renderUserData(body);
  else if (state.tab === 'orders') renderOrders(body);
  else if (state.tab === 'invoices') renderInvoices(body);
  else if (state.tab === 'plans') renderPlans(body);
  else if (state.tab === 'prices') renderPrices(body);
  else if (state.tab === 'rank') renderRank(body);
  else if (state.tab === 'freemodels') renderFreeModels(body);
  else if (state.tab === 'repo') renderRepo(body);
  else if (state.tab === 'feedback') renderFeedback(body);
  else if (state.tab === 'paycfg') renderPayCfg(body);
  else if (state.tab === 'system') renderSystem(body);
}

/* ---------- 数据加载 ---------- */
function fetchUsers(force) {
  if (state.users && !force) return Promise.resolve(state.users);
  return loadSb().then(function (cli) {
    return cli.rpc('admin_list_users', { pwd: PWD });
  }).then(function (r) {
    if (r.error) throw r.error;
    state.users = r.data || [];
    return state.users;
  });
}

/* ---------- 仪表盘 ---------- */
function renderDashboard(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  Promise.all([
    fetchUsers(),
    loadSb().then(function (cli) { return cli.rpc('admin_list_orders', { pwd: PWD }); }),
    loadSb().then(function (cli) { return cli.rpc('admin_list_feedback', { pwd: PWD }); }),
  ]).then(function (rs) {
    var users = rs[0];
    var orders = rs[1].error ? [] : (rs[1].data || []);
    var fb = rs[2].error ? [] : (rs[2].data || []);
    var byLevel = {};
    LEVELS.forEach(function (l) { byLevel[l.id] = 0; });
    users.forEach(function (u) { var k = u.level || 'guest'; byLevel[k] = (byLevel[k] || 0) + 1; });
    var maxLv = Math.max.apply(null, LEVELS.map(function (l) { return byLevel[l.id] || 0; }).concat([1]));
    var pending = orders.filter(function (o) { return o.status === 'pending'; }).length;
    var paidSum = orders.filter(function (o) { return o.status === 'paid'; }).reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0);
    var openFb = fb.filter(function (f) { var d = f.data || {}; return d.status !== 'done'; }).length;
    body.innerHTML =
      '<div class="adm-stat-grid">' +
        '<div class="adm-card adm-stat" data-act="go" data-t="users"><div style="font-size:20px">👥</div><div class="adm-stat-num">' + users.length + '</div><div class="adm-muted">注册用户</div></div>' +
        '<div class="adm-card adm-stat" data-act="go" data-t="orders"><div style="font-size:20px">⏳</div><div class="adm-stat-num" style="color:#fbbf24">' + pending + '</div><div class="adm-muted">待确认订单</div></div>' +
        '<div class="adm-card adm-stat" data-act="go" data-t="orders"><div style="font-size:20px">💰</div><div class="adm-stat-num" style="color:#34d399">¥' + paidSum.toFixed(0) + '</div><div class="adm-muted">已收款金额</div></div>' +
        '<div class="adm-card adm-stat" data-act="go" data-t="feedback"><div style="font-size:20px">💬</div><div class="adm-stat-num" style="color:#60a5fa">' + openFb + '</div><div class="adm-muted">待处理反馈</div></div>' +
      '</div>' +
      '<div class="adm-card" style="margin-top:14px">' +
        '<div style="font-weight:700;margin-bottom:12px">📈 会员等级分布</div>' +
        LEVELS.map(function (l) {
          var n = byLevel[l.id] || 0;
          var w = Math.round(n / maxLv * 100);
          return '<div class="adm-bar-row"><span class="adm-bar-label">' + l.name + '</span>' +
            '<div class="adm-bar-track"><div class="adm-bar-fill" style="width:' + Math.max(w, n ? 6 : 0) + '%;background:' + l.color + '"></div></div>' +
            '<span class="adm-bar-num">' + n + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="adm-card" style="margin-top:14px"><div style="font-weight:700;margin-bottom:8px">快捷入口</div>' +
        '<div class="adm-row">' +
          '<button class="adm-btn" data-act="go" data-t="users">用户管理</button>' +
          '<button class="adm-btn" data-act="go" data-t="userdata">查看用户数据</button>' +
          '<button class="adm-btn" data-act="go" data-t="orders">订单管理</button>' +
          '<button class="adm-btn" data-act="go" data-t="paycfg">收款设置</button>' +
        '</div></div>';
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 用户管理 ---------- */
function renderUsers(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  fetchUsers().then(function (users) {
    var tabs = [{ id: '', name: '全部' }, { id: '__followed', name: '⭐ 关注' }].concat(LEVELS);
    var html = '<div class="adm-subtabs">' +
      tabs.map(function (t) {
        return '<button class="adm-tab adm-tab-sm' + (state.userTab === t.id ? ' on' : '') + '" data-act="usertab" data-t="' + t.id + '">' + t.name + '</button>';
      }).join('') + '</div>' +
      '<input class="adm-input" id="u-search" placeholder="🔍 搜索昵称 / 邮箱…" value="' + esc(state.userSearch) + '" style="margin-bottom:12px">' +
      '<div id="u-list"></div>';
    body.innerHTML = html;
    $('#u-search').addEventListener('input', function () {
      state.userSearch = this.value;
      renderUserList(users);
    });
    renderUserList(users);
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function renderUserList(allUsers) {
  var box = $('#u-list');
  if (!box) return;
  var kw = state.userSearch.trim().toLowerCase();
  var list = allUsers.slice();
  if (state.userTab === '__followed') list = list.filter(function (u) { return isFollowed(u.id); });
  else if (state.userTab) list = list.filter(function (u) { return (u.level || 'guest') === state.userTab; });
  if (kw) list = list.filter(function (u) {
    return (String(u.nickname || '').toLowerCase().indexOf(kw) >= 0) || (String(u.email || '').toLowerCase().indexOf(kw) >= 0);
  });
  list.sort(function (a, b) { return (isFollowed(b.id) ? 1 : 0) - (isFollowed(a.id) ? 1 : 0); });
  if (!list.length) {
    box.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">' +
      (state.userTab === '__followed' ? '还没有关注的用户，点击用户卡片上的 ☆ 关注他们' : '暂无用户') + '</p>';
    return;
  }
  box.innerHTML = list.map(function (u) {
    var lv = u.level || 'guest';
    var expired = u.expire_at && new Date(u.expire_at) < new Date();
    return '<div class="adm-card adm-user" data-uid="' + u.id + '">' +
      '<button class="adm-star" data-act="follow" data-uid="' + u.id + '" title="关注/取消关注">' + (isFollowed(u.id) ? '⭐' : '☆') + '</button>' +
      '<div class="adm-avatar">' + esc((u.nickname || u.email || 'U').charAt(0).toUpperCase()) + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:14px">' + esc(u.nickname || '未命名') + '</div>' +
        '<div class="adm-muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.email || '') + '</div>' +
        '<div class="adm-muted">注册 ' + fmtDate(u.created_at) + (u.expire_at ? ' · 会员' + (expired ? '已过期 ' : '至 ') + fmtDate(u.expire_at).slice(0, 10) : '') + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<span class="adm-badge" style="background:' + levelColor(lv) + '22;color:' + levelColor(lv) + '">' + levelName(lv) + '</span>' +
        (u.role === 'admin' ? ' <span class="adm-badge" style="background:#ef444422;color:#ef4444">管理员</span>' : '') +
        '<div class="adm-nick-row" style="justify-content:flex-end">' +
          '<button class="adm-btn adm-btn-sm" data-act="setlevel" data-uid="' + u.id + '">🎚️ 等级</button>' +
          '<button class="adm-btn adm-btn-sm" data-act="editnick" data-uid="' + u.id + '">✏️ 昵称</button>' +
          (getNickOrig(u.id) && getNickOrig(u.id) !== (u.nickname || '')
            ? '<button class="adm-btn adm-btn-sm" data-act="restorenick" data-uid="' + u.id + '" style="color:#fbbf24">↩️ 恢复昵称</button>'
            : '') +
          (u.role === 'admin'
            ? '<button class="adm-btn adm-btn-sm" data-act="setrole" data-uid="' + u.id + '" data-role="user" style="color:#f472b6">👑 取消管理员</button>'
            : '<button class="adm-btn adm-btn-sm" data-act="setrole" data-uid="' + u.id + '" data-role="admin" style="color:#34d399">👑 设为管理员</button>') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ---------- 通用弹层（v1.3） ---------- */
function openSheet(html) {
  var ov = document.createElement('div');
  ov.className = 'adm-overlay';
  ov.innerHTML = '<div class="adm-sheet">' + html + '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function (e) { if (e.target === ov) { ov.remove(); } });
  return ov;
}
function closeSheet(ov) { if (ov) ov.remove(); }

/* ---------- 会员等级：弹层点击选择（不再手动输入） ---------- */
function setUserLevel(uid) {
  var u = (state.users || []).find(function (x) { return x.id === uid; });
  if (!u) return;
  var cur = u.level || 'guest';
  var ov = openSheet(
    '<div class="adm-sheet-title">设置会员等级</div>' +
    '<div class="adm-muted" style="margin-bottom:12px">用户：' + esc(u.nickname || '未命名') + (u.email ? ' · ' + esc(u.email) : '') + '（当前 ' + levelName(cur) + '）</div>' +
    '<div class="adm-level-grid">' +
      LEVELS.map(function (l) {
        return '<button class="adm-level-opt' + (cur === l.id ? ' on' : '') + '" data-lv="' + l.id + '" style="--lc:' + l.color + '">' +
          '<b>' + l.name + '</b>' + (l.note ? '<span>' + esc(l.note) + '</span>' : '') + '</button>';
      }).join('') +
    '</div>' +
    '<div data-v="expire" style="display:none;margin-bottom:12px">' +
      '<label class="adm-muted">会员有效期</label>' +
      '<select class="adm-input" data-f="expire">' +
        '<option value="0">永久有效</option>' +
        '<option value="30">30 天</option>' +
        '<option value="90">90 天</option>' +
        '<option value="365" selected>365 天</option>' +
        '<option value="730">两年（730 天）</option>' +
      '</select>' +
    '</div>' +
    '<button class="adm-btn adm-btn-primary adm-btn-block" data-a="lv-ok">确认设置</button>'
  );
  var sel = cur;
  function mark() {
    $$('.adm-level-opt', ov).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lv') === sel); });
    $('[data-v="expire"]', ov).style.display = sel === 'guest' ? 'none' : 'block';
  }
  $$('.adm-level-opt', ov).forEach(function (b) {
    b.onclick = function () { sel = b.getAttribute('data-lv'); mark(); };
  });
  mark();
  $('[data-a="lv-ok"]', ov).onclick = function () {
    if (sel === 'guest' && cur !== 'guest') {
      if (!confirm('将用户降级为「游客」？游客不享受云存储与云端同步。')) return;
    }
    var days = parseInt($('[data-f="expire"]', ov).value, 10) || 0;
    var expire = (sel !== 'guest' && days > 0) ? new Date(Date.now() + days * 864e5).toISOString() : null;
    var btn = $('[data-a="lv-ok"]', ov); btn.disabled = true; btn.textContent = '保存中…';
    loadSb().then(function (cli) {
      return cli.rpc('admin_set_user_level', { pwd: PWD, uid: uid, p_level: sel, p_expire: expire });
    }).then(function (r) {
      if (r.error) throw r.error;
      toast('已更新等级为「' + levelName(sel) + '」');
      closeSheet(ov);
      state.users = null;
      renderBody();
    }).catch(function (e) { toast('失败：' + e.message, false); btn.disabled = false; btn.textContent = '确认设置'; });
  };
}

/* ---------- 昵称编辑（需再次输入管理员密码；改错可一键恢复） ---------- */
function editUserNickname(uid) {
  var u = (state.users || []).find(function (x) { return x.id === uid; });
  if (!u) return;
  if (!getNickOrig(uid)) setNickOrig(uid, u.nickname || '');
  var ov = openSheet(
    '<div class="adm-sheet-title">✏️ 编辑昵称</div>' +
    '<div class="adm-muted" style="margin-bottom:10px">用户：' + esc(u.nickname || '未命名') + (u.email ? ' · ' + esc(u.email) : '') + '</div>' +
    '<input class="adm-input" data-f="nn" placeholder="新昵称" value="' + esc(u.nickname || '') + '" style="margin-bottom:8px">' +
    '<input class="adm-input" type="password" data-f="pwd" placeholder="管理员密码（确认操作）" style="margin-bottom:12px">' +
    '<div class="adm-muted" style="margin-bottom:10px">保存后如需撤销，可在用户卡片点「↩️ 恢复昵称」回到修改前。恢复操作同样需要管理员密码。</div>' +
    '<button class="adm-btn adm-btn-primary adm-btn-block" data-a="nn-ok">保存昵称</button>'
  );
  $('[data-a="nn-ok"]', ov).onclick = function () {
    var nn = $('[data-f="nn"]', ov).value.trim();
    var pwd = $('[data-f="pwd"]', ov).value;
    if (!nn) { toast('昵称不能为空', false); return; }
    if (!pwd) { toast('请输入管理员密码', false); return; }
    var btn = $('[data-a="nn-ok"]', ov); btn.disabled = true; btn.textContent = '保存中…';
    loadSb().then(function (cli) {
      return cli.rpc('admin_set_user_nickname', { pwd: pwd, uid: uid, nickname: nn });
    }).then(function (r) {
      if (r.error) throw r.error;
      toast('昵称已更新为「' + nn + '」，可随时恢复');
      closeSheet(ov);
      state.users = null;
      renderBody();
    }).catch(function (e) {
      toast('保存失败：' + (String(e.message || '').indexOf('unauthorized') >= 0 ? '管理员密码不正确' : e.message), false);
      btn.disabled = false; btn.textContent = '保存昵称';
    });
  };
}

/* ---------- 恢复原昵称 ---------- */
function restoreUserNickname(uid) {
  var orig = getNickOrig(uid);
  if (!orig) { toast('没有可恢复的原始昵称', false); return; }
  var u = (state.users || []).find(function (x) { return x.id === uid; });
  var ov = openSheet(
    '<div class="adm-sheet-title">↩️ 恢复昵称</div>' +
    '<div class="adm-muted" style="margin-bottom:10px">' + (u ? esc(u.nickname || '') : '') + ' → ' + esc(orig) + '</div>' +
    '<input class="adm-input" type="password" data-f="pwd" placeholder="管理员密码（确认操作）" style="margin-bottom:12px">' +
    '<button class="adm-btn adm-btn-primary adm-btn-block" data-a="nn-ok">确认恢复</button>'
  );
  $('[data-a="nn-ok"]', ov).onclick = function () {
    var pwd = $('[data-f="pwd"]', ov).value;
    if (!pwd) { toast('请输入管理员密码', false); return; }
    var btn = $('[data-a="nn-ok"]', ov); btn.disabled = true; btn.textContent = '恢复中…';
    loadSb().then(function (cli) {
      return cli.rpc('admin_set_user_nickname', { pwd: pwd, uid: uid, nickname: orig });
    }).then(function (r) {
      if (r.error) throw r.error;
      toast('已恢复原昵称');
      setNickOrig(uid, '');
      closeSheet(ov);
      state.users = null;
      renderBody();
    }).catch(function (e) {
      toast('恢复失败：' + (String(e.message || '').indexOf('unauthorized') >= 0 ? '管理员密码不正确' : e.message), false);
      btn.disabled = false; btn.textContent = '确认恢复';
    });
  };
}

/* ---------- 设置 / 取消管理员（管理员可有多个） ---------- */
function toggleUserRole(uid, role) {
  var u = (state.users || []).find(function (x) { return x.id === uid; });
  if (!u) return;
  var toAdmin = role === 'admin';
  var ov = openSheet(
    '<div class="adm-sheet-title">' + (toAdmin ? '👑 设为管理员' : '👑 取消管理员') + '</div>' +
    '<div class="adm-muted" style="margin-bottom:10px">用户：' + esc(u.nickname || u.email || uid) +
      (toAdmin ? '<br>设为管理员后拥有全部后台权限（可同时存在多位管理员）。' : '<br>取消后该用户不再拥有后台权限。') + '</div>' +
    '<input class="adm-input" type="password" data-f="pwd" placeholder="管理员密码（确认操作）" style="margin-bottom:12px">' +
    '<button class="adm-btn adm-btn-primary adm-btn-block" data-a="nn-ok">' + (toAdmin ? '确认设为管理员' : '确认取消管理员') + '</button>'
  );
  $('[data-a="nn-ok"]', ov).onclick = function () {
    var pwd = $('[data-f="pwd"]', ov).value;
    if (!pwd) { toast('请输入管理员密码', false); return; }
    var btn = $('[data-a="nn-ok"]', ov); btn.disabled = true; btn.textContent = '提交中…';
    loadSb().then(function (cli) {
      return cli.rpc('admin_set_user_role', { pwd: pwd, uid: uid, role: role });
    }).then(function (r) {
      if (r.error) throw r.error;
      toast(toAdmin ? '已设为管理员' : '已取消管理员');
      closeSheet(ov);
      state.users = null;
      renderBody();
    }).catch(function (e) {
      toast('操作失败：' + (String(e.message || '').indexOf('unauthorized') >= 0 ? '管理员密码不正确' : e.message), false);
      btn.disabled = false; btn.textContent = toAdmin ? '确认设为管理员' : '确认取消管理员';
    });
  };
}

/* ---------- 用户数据（书源 / API 密钥） ---------- */
function renderUserData(body) {
  body.innerHTML = '<p class="adm-muted">加载用户列表…</p>';
  fetchUsers().then(function (users) {
    body.innerHTML =
      '<p class="adm-muted" style="margin-bottom:10px">选择一个用户，查看他上传到云端的书源与 API 密钥。加密上传的密钥管理员不可见，明文上传的可以直接查看。</p>' +
      '<select class="adm-input" id="ud-user" style="margin-bottom:14px">' +
        '<option value="">— 选择用户 —</option>' +
        users.map(function (u) {
          return '<option value="' + u.id + '"' + (state.dataUid === u.id ? ' selected' : '') + '>' +
            esc((u.nickname || '未命名') + ' · ' + (u.email || '')) + '</option>';
        }).join('') +
      '</select>' +
      '<div id="ud-body">' + (state.dataUid ? '' : '<p class="adm-muted" style="text-align:center;padding:20px 0">请先选择用户</p>') + '</div>';
    $('#ud-user').addEventListener('change', function () {
      state.dataUid = this.value;
      if (state.dataUid) loadUserDataDetail();
      else $('#ud-body').innerHTML = '<p class="adm-muted" style="text-align:center;padding:20px 0">请先选择用户</p>';
    });
    if (state.dataUid) loadUserDataDetail();
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function loadUserDataDetail() {
  var box = $('#ud-body');
  if (!box) return;
  var uid = state.dataUid;
  box.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) {
    return Promise.all([
      cli.rpc('admin_get_user_keys', { pwd: PWD, uid: uid }),
      cli.rpc('admin_get_user_sources', { pwd: PWD, uid: uid }),
    ]);
  }).then(function (rs) {
    var keys = rs[0].error ? [] : (rs[0].data || []);
    var sources = rs[1].error ? [] : (rs[1].data || []);
    var typeName = { novel: '小说', comic: '漫画', video: '影视', audio: '听书', music: '音乐' };
    var html = '<div class="adm-sec-title">API 密钥（' + keys.length + '）</div>';
    if (!keys.length) html += '<p class="adm-muted">该用户未上传任何密钥（密钥可选择仅保存本机）</p>';
    else html += keys.map(function (k) {
      var enc = k.mode === 'enc' || (k.payload || '').indexOf('enc1:') === 0;
      return '<div class="adm-card" style="padding:10px 12px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<b style="font-size:14px;flex:1">' + esc(k.name || k.key_id) + '</b>' +
          (enc ? '<span class="adm-badge" style="background:#fbbf2422;color:#fbbf24">🔒 已加密 · 不可见</span>'
               : '<span class="adm-badge" style="background:#34d39922;color:#34d399">明文 · 可见</span>') +
        '</div>' +
        (k.base ? '<div class="adm-muted" style="margin-top:4px;word-break:break-all">' + esc(k.base) + '</div>' : '') +
        '<div class="adm-mono" style="margin-top:4px">' + (enc ? '（本地密码加密，无法查看）' : esc(k.payload || '（空）')) + '</div>' +
        '<div class="adm-muted" style="margin-top:4px">更新于 ' + fmtDate(k.updated_at) + '</div>' +
      '</div>';
    }).join('');
    html += '<div class="adm-sec-title" style="margin-top:18px">书源 / 连接器（' + sources.length + '）</div>';
    if (!sources.length) html += '<p class="adm-muted">该用户未同步书源到云端</p>';
    else html += sources.map(function (s) {
      var d = s.data || {};
      return '<div class="adm-card" style="padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;min-width:0"><b style="font-size:14px">' + esc(d.name || s.id) + '</b>' +
        '<div class="adm-muted">' + esc(typeName[d.type] || d.type || '-') + (d.author ? ' · ' + esc(d.author) : '') + (d.url ? ' · ' + esc(d.url) : '') + '</div></div>' +
        '<span class="adm-badge" style="background:' + (d.enabled !== false ? '#34d39922;color:#34d399' : '#9aa3b222;color:#9aa3b2') + '">' + (d.enabled !== false ? '启用' : '停用') + '</span>' +
      '</div>';
    }).join('');
    box.innerHTML = html;
  }).catch(function (e) { box.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 订单管理 ---------- */
function renderOrders(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.rpc('admin_list_orders', { pwd: PWD }); })
    .then(function (r) {
      if (r.error) throw r.error;
      var orders = r.data || [];
      state.orders = orders;
      if (!orders.length) { body.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">暂无订单</p>'; return; }
      var mName = { alipay: '支付宝', wechat: '微信' };
      var sName = { pending: '待确认', paid: '已收款', cancelled: '已取消' };
      var sColor = { pending: '#fbbf24', paid: '#34d399', cancelled: '#9aa3b2' };
      body.innerHTML = '<p class="adm-muted" style="margin-bottom:12px">用户支付后订单出现在这里，核对收款后点击「确认收款」，系统会自动开通对应会员。</p>' +
        orders.map(function (o) {
          return '<div class="adm-card" style="margin-bottom:10px">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<b class="adm-mono" style="font-size:13px;flex:1">' + esc(o.order_no) + '</b>' +
              '<span class="adm-badge" style="background:' + sColor[o.status] + '22;color:' + sColor[o.status] + '">' + (sName[o.status] || o.status) + '</span>' +
            '</div>' +
            '<div style="margin-top:6px;font-size:14px">' + esc(o.plan_name || o.plan || '-') + ' · ' + (o.period === 'yearly' ? '年付' : '月付') + ' · <b style="color:#34d399">¥' + Number(o.amount || 0).toFixed(2) + '</b> · ' + (mName[o.pay_method] || o.pay_method || '-') + '</div>' +
            '<div class="adm-muted" style="margin-top:4px">用户 ' + esc(String(o.user_id || '').slice(0, 8)) + '… · ' + fmtDate(o.created_at) + (o.paid_at ? ' · 收款 ' + fmtDate(o.paid_at) : '') + '</div>' +
            (o.status === 'pending' ?
              '<div class="adm-row" style="margin-top:8px">' +
                '<button class="adm-btn adm-btn-sm adm-btn-primary" data-act="confirm-order" data-no="' + esc(o.order_no) + '">确认收款</button>' +
                '<button class="adm-btn adm-btn-sm" data-act="cancel-order" data-no="' + esc(o.order_no) + '">取消订单</button>' +
              '</div>' : '') +
          '</div>';
        }).join('');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 发票管理 ---------- */
function renderInvoices(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  Promise.all([
    loadSb().then(function (cli) { return cli.rpc('admin_list_invoices', { pwd: PWD }); }),
    fetchUsers(),
  ]).then(function (rs) {
    var r = rs[0], users = rs[1];
    if (r.error) throw r.error;
    var emailOf = {};
    users.forEach(function (u) { emailOf[u.id] = u.email || ''; });
    var list = r.data || [];
    if (!list.length) { body.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">暂无发票申请</p>'; return; }
    body.innerHTML = '<p class="adm-muted" style="margin-bottom:12px">用户在 App「会员中心 → 发票」对购买记录提交的开票申请。开具并发往用户邮箱后，点击「标记已开具」。</p>' +
      list.map(function (iv) {
        var done = iv.status === 'done';
        return '<div class="adm-card" data-iv="' + esc(iv.id) + '" style="margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<b style="flex:1;font-size:14px">' + esc(iv.title) + '</b>' +
            '<span class="adm-badge" style="background:' + (done ? '#34d39922;color:#34d399' : '#fbbf2422;color:#fbbf24') + '">' + (done ? '已开具' : '待处理') + '</span>' +
          '</div>' +
          '<div style="margin-top:6px;font-size:14px">金额 <b style="color:#34d399">¥' + Number(iv.amount || 0).toFixed(2) + '</b>' +
            (iv.tax_no ? ' · 税号 ' + esc(iv.tax_no) : ' · 个人') + '</div>' +
          '<div class="adm-muted" style="margin-top:4px">接收邮箱 ' + esc(iv.email) + '</div>' +
          '<div class="adm-muted adm-mono" style="margin-top:2px;font-size:12px">订单号 ' + esc(iv.order_no) + '</div>' +
          '<div class="adm-muted" style="margin-top:2px">用户 ' + esc(emailOf[iv.user_id] || String(iv.user_id).slice(0, 8) + '…') + ' · ' + fmtDate(iv.created_at) + '</div>' +
          '<div class="adm-row" style="margin-top:8px">' +
            '<button class="adm-btn adm-btn-sm ' + (done ? '' : 'adm-btn-primary') + '" data-act="toggle-invoice">' + (done ? '标记待处理' : '标记已开具') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
  }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- 模型定价（花费估算价目，USD / 1M tokens） ---------- */
function renderPrices(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_model_prices').select('*').order('model'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:12px">这里维护 App「用量统计 → 花费估算」使用的模型刊例价（<b>美元 / 1M tokens</b>）。云端价目优先于 App 内置价目；键可写「厂商/模型」（如 openai/gpt-5）或裸模型名。修改后用户端下次启动生效。</p>' +
        '<div class="adm-card" style="margin-bottom:12px">' +
          '<b>' + (state.priceEdit ? '编辑：' + esc(state.priceEdit) : '新增 / 更新价格') + '</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">模型键<input class="adm-input" data-f="p-model" value="' + esc(state.priceEdit || '') + '" placeholder="openai/gpt-5"></label>' +
            '<label class="adm-muted">输入价（USD/1M）<input class="adm-input" type="number" step="0.001" min="0" data-f="p-in" value="' + (state.priceIn || '') + '"></label>' +
            '<label class="adm-muted">输出价（USD/1M）<input class="adm-input" type="number" step="0.001" min="0" data-f="p-out" value="' + (state.priceOut || '') + '"></label>' +
          '</div>' +
          '<div class="adm-row" style="margin-top:10px;flex-wrap:wrap">' +
            '<button class="adm-btn adm-btn-primary adm-btn-sm" data-act="save-price">保存价格</button>' +
            '<button class="adm-btn adm-btn-sm" data-act="import-prices">导入内置价目</button>' +
            '<label class="adm-btn adm-btn-sm" style="cursor:pointer">从文件导入<input type="file" accept=".json,.csv,.txt" data-act-file="prices" style="display:none"></label>' +
          '</div>' +
          '<p class="adm-muted" style="margin-top:8px;font-size:12px">文件格式：JSON 数组 [{"model":"openai/gpt-5","in":1.25,"out":10}]，或每行一条「模型,输入价,输出价」。</p>' +
        '</div>' +
        (rows.length ?
          rows.map(function (p) {
            return '<div class="adm-card" style="margin-bottom:8px" data-model="' + esc(p.model) + '">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                '<b class="adm-mono" style="flex:1;font-size:13px">' + esc(p.model) + '</b>' +
                '<span class="adm-badge" style="background:#3b5bfd22;color:#7da2ff">in $' + Number(p.input_price) + ' / out $' + Number(p.output_price) + '</span>' +
                '<button class="adm-btn adm-btn-sm" data-act="edit-price">编辑</button>' +
                '<button class="adm-btn adm-btn-sm" data-act="del-price">删除</button>' +
              '</div>' +
              '<div class="adm-muted" style="margin-top:4px;font-size:12px">更新于 ' + fmtDate(p.updated_at) + '</div>' +
            '</div>';
          }).join('')
          : '<p class="adm-muted" style="text-align:center;padding:16px 0">云端还没有自定义价目（App 暂用内置价目）</p>');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function importPrices(rows, doneMsg) {
  var i = 0, fail = 0;
  toast('开始导入 ' + rows.length + ' 条价格…');
  function next() {
    if (i >= rows.length) { toast('导入完成：成功 ' + (rows.length - fail) + ' 条' + (fail ? '，失败 ' + fail + ' 条' : '')); renderBody(); return; }
    var p = rows[i++];
    loadSb().then(function (cli) {
      return cli.rpc('admin_set_model_price', { pwd: PWD, p_model: p.model, p_in: p.in, p_out: p.out });
    }).then(function (r) { if (r.error) fail++; next(); })
      .catch(function () { fail++; next(); });
  }
  next();
}

/* ---------- 排行榜（云端综合榜 · v1.3 表格批量编辑） ---------- */
function renderRank(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_leaderboard').select('*').order('rank'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:12px">🏆 维护 App「模型排行榜 → 综合榜」。直接在表格里改名次 / 模型 / 厂商 / 分数，改完点「保存全部改动」一次生效；「➕ 添加名次」可在任意位置插入一行，名次可拖后整体调整。</p>' +
        '<div class="adm-card">' +
          '<table class="adm-table"><thead><tr>' +
            '<th style="width:70px">名次</th><th>模型名</th><th style="width:120px">厂商 ID</th><th style="width:90px">综合分</th><th style="width:60px"></th>' +
          '</tr></thead><tbody data-v="rank-tb">' +
          (rows.length ? rows.map(function (x) {
            return rankRowHtml(x.rank, x.model, x.org, x.score);
          }).join('') : '') +
          '</tbody></table>' +
          '<div class="adm-row" style="margin-top:12px;flex-wrap:wrap">' +
            '<button class="adm-btn adm-btn-sm" data-act="rank-add">➕ 添加名次</button>' +
            '<button class="adm-btn adm-btn-sm" data-act="rank-import">📥 导入内置综合榜</button>' +
            '<button class="adm-btn adm-btn-primary adm-btn-sm" data-act="rank-saveall">💾 保存全部改动</button>' +
          '</div>' +
        '</div>';
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}
function rankRowHtml(rank, model, org, score) {
  return '<tr data-v="rk">' +
    '<td><input class="adm-input" type="number" min="1" data-rk="rank" value="' + esc(rank) + '"></td>' +
    '<td><input class="adm-input" data-rk="model" value="' + esc(model || '') + '" placeholder="GPT-5.1"></td>' +
    '<td><input class="adm-input" data-rk="org" value="' + esc(org || '') + '" placeholder="openai"></td>' +
    '<td><input class="adm-input" type="number" step="0.5" min="0" max="100" data-rk="score" value="' + esc(score != null ? score : '') + '"></td>' +
    '<td><button class="adm-btn adm-btn-sm" data-act="rank-delrow" title="删除此行">🗑️</button></td>' +
  '</tr>';
}
function rankCollectRows() {
  return $$('[data-v="rk"]').map(function (tr) {
    return {
      rank: parseInt($('[data-rk="rank"]', tr).value, 10),
      model: $('[data-rk="model"]', tr).value.trim(),
      org: $('[data-rk="org"]', tr).value.trim(),
      score: parseFloat($('[data-rk="score"]', tr).value),
      del: tr.classList.contains('del'),
    };
  }).filter(function (x) { return x.rank > 0 && x.model; });
}
function rankSaveAll(btn) {
  var rows = rankCollectRows();
  var dels = $$('[data-v="rk"].del').map(function (tr) { return parseInt($('[data-rk="rank"]', tr).value, 10); }).filter(function (n) { return n > 0; });
  if (!rows.length && !dels.length) { toast('没有可保存的内容', false); return; }
  btn.disabled = true; btn.textContent = '保存中…';
  var i = 0, fail = 0;
  function next() {
    if (i >= rows.length) {
      if (dels.length && fail === 0) { /* 删除标记行 */ }
      toast('排行榜已保存' + (fail ? '（失败 ' + fail + ' 行）' : ''));
      btn.disabled = false; btn.textContent = '💾 保存全部改动';
      renderBody();
      return;
    }
    var x = rows[i++];
    loadSb().then(function (cli) {
      return cli.rpc('admin_upsert_leaderboard', { pwd: PWD, p_rank: x.rank, p_model: x.model, p_org: x.org, p_score: isNaN(x.score) ? 0 : x.score, p_note: '' });
    }).then(function (r) { if (r.error) fail++; next(); }).catch(function () { fail++; next(); });
  }
  if (dels.length) {
    var di = 0, dfail = 0;
    (function delNext() {
      if (di >= dels.length) { next(); return; }
      var d = dels[di++];
      loadSb().then(function (cli) { return cli.rpc('admin_delete_leaderboard', { pwd: PWD, p_rank: d }); })
        .then(function (r) { if (r.error) dfail++; delNext(); }).catch(function () { dfail++; delNext(); });
    })();
  } else next();
}

/* ---------- 会员定价 ---------- */
function renderPlans(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_vip_plans').select('*'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var order = ['satellite', 'planet', 'star', 'galaxy'];
      var plans = (r.data || []).sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:14px">修改后点击「保存」，用户端会员中心立即生效。价格单位：人民币元。</p>' +
        plans.map(function (p) {
          var d = p.data || {};
          return '<div class="adm-card" data-pid="' + esc(p.id) + '" style="margin-bottom:12px">' +
            '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><b style="font-size:15px">' + esc(d.name || p.id) + '</b>' +
            '<span class="adm-badge" style="background:#3b5bfd22;color:#7da2ff">' + esc(d.storage || '') + '</span></div>' +
            '<div class="adm-form-grid">' +
              '<label class="adm-muted">套餐名称<input class="adm-input" data-f="name" value="' + esc(d.name || '') + '"></label>' +
              '<label class="adm-muted">副标题<input class="adm-input" data-f="tagline" value="' + esc(d.tagline || '') + '"></label>' +
              '<label class="adm-muted">月付价格（元）<input class="adm-input" type="number" min="0" data-f="monthly" value="' + (d.monthly || 0) + '"></label>' +
              '<label class="adm-muted">年付价格（元）<input class="adm-input" type="number" min="0" data-f="yearly" value="' + (d.yearly || 0) + '"></label>' +
              '<label class="adm-muted">存储额度<input class="adm-input" data-f="storage" value="' + esc(d.storage || '') + '"></label>' +
              '<label class="adm-muted">会员等级 ID<input class="adm-input" data-f="level" value="' + esc(d.level || p.id) + '"></label>' +
            '</div>' +
            '<label class="adm-muted" style="display:block;margin-top:10px">权益列表（每行一条）' +
              '<textarea class="adm-input" rows="4" data-f="benefits">' + esc((d.benefits || []).join('\n')) + '</textarea></label>' +
            '<button class="adm-btn adm-btn-primary adm-btn-sm" data-act="save-plan" style="margin-top:10px">保存</button>' +
          '</div>';
        }).join('');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function savePlan(btn) {
  var card = btn.closest('[data-pid]');
  var pid = card.getAttribute('data-pid');
  var d = {
    name: $('[data-f="name"]', card).value.trim(),
    tagline: $('[data-f="tagline"]', card).value.trim(),
    monthly: parseFloat($('[data-f="monthly"]', card).value) || 0,
    yearly: parseFloat($('[data-f="yearly"]', card).value) || 0,
    storage: $('[data-f="storage"]', card).value.trim(),
    level: $('[data-f="level"]', card).value.trim() || pid,
    benefits: $('[data-f="benefits"]', card).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
  };
  btn.disabled = true;
  loadSb().then(function (cli) {
    return cli.rpc('admin_upsert_vip_plan', { pwd: PWD, pid: pid, pdata: d });
  }).then(function (r) {
    if (r.error) throw r.error;
    toast('已保存');
  }).catch(function (e) { toast('保存失败：' + e.message, false); })
    .finally(function () { btn.disabled = false; });
}

/* ---------- 意见反馈 ---------- */
function renderFeedback(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.rpc('admin_list_feedback', { pwd: PWD }); })
    .then(function (r) {
      if (r.error) throw r.error;
      var list = r.data || [];
      if (!list.length) { body.innerHTML = '<p class="adm-muted" style="text-align:center;padding:24px 0">暂无反馈</p>'; return; }
      body.innerHTML = list.map(function (f) {
        var d = f.data || {};
        var done = d.status === 'done';
        return '<div class="adm-card" data-fid="' + esc(f.id) + '" style="margin-bottom:10px">' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<b style="flex:1;font-size:14px">' + esc(d.title || '反馈') + '</b>' +
            '<span class="adm-badge" style="background:' + (done ? '#34d39922;color:#34d399' : '#fbbf2422;color:#fbbf24') + '">' + (done ? '已处理' : '待处理') + '</span>' +
          '</div>' +
          '<div style="margin-top:6px;font-size:14px;white-space:pre-wrap">' + esc(d.content || '') + '</div>' +
          '<div class="adm-muted" style="margin-top:6px">' + esc(d.contact || '匿名') + ' · ' + fmtDate(f.updated_at) + (d.visibility === 'admin' ? ' · 仅管理员可见' : '') + '</div>' +
          (d.reply ? '<div class="adm-reply">官方回复：' + esc(d.reply) + '</div>' : '') +
          '<div class="adm-row" style="margin-top:8px">' +
            '<button class="adm-btn adm-btn-sm" data-act="reply-fb">回复</button>' +
            '<button class="adm-btn adm-btn-sm" data-act="toggle-fb">' + (done ? '标记待处理' : '标记已处理') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

/* ---------- v4.3 官方仓库：上传书源 / 自动分类 / 删除 / 改仓库密码 ---------- */
var REPO_CATS = ['小说', '漫画', '有声', '视频', '音乐', '其他'];
var repoParsed = [];   // 待上传的解析结果

/* 自动识别格式并分类 */
function repoClassifyLegado(src) {
  var g = (src.bookSourceGroup || '').trim();
  if (g) return g;
  var t = Number(src.bookSourceType || 0);
  if (t === 1) return '有声';
  if (t === 2) return '漫画';
  return '小说';
}
function repoClassifyTvbox(site) {
  var t = String(site.type != null ? site.type : '');
  var api = String(site.api || '');
  if (/csp_/i.test(api) || t === '3' || t === '4') return '视频';
  return '视频';
}
function repoParseText(text) {
  var items = [];
  var errors = [];
  text = String(text || '').trim();
  if (!text) return { items: items, errors: ['内容为空'] };
  var parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON，按 Venera JS 图源处理 */ }
  if (parsed !== null) {
    var arr = Array.isArray(parsed) ? parsed : [parsed];
    /* TVbox 配置整体 {sites:[...]} */
    if (!Array.isArray(parsed) && parsed && Array.isArray(parsed.sites)) arr = parsed.sites;
    arr.forEach(function (it, i) {
      if (!it || typeof it !== 'object') { errors.push('第 ' + (i + 1) + ' 条不是对象'); return; }
      if (it.bookSourceName || it.bookSourceUrl) {
        items.push({ name: it.bookSourceName || it.bookSourceUrl, fmt: 'legado', category: repoClassifyLegado(it), data: it });
      } else if (it.key && (it.api || it.type != null)) {
        items.push({ name: it.name || it.key, fmt: 'tvbox', category: repoClassifyTvbox(it), data: it });
      } else {
        errors.push('第 ' + (i + 1) + ' 条无法识别');
      }
    });
  } else {
    /* 纯 JS 源码 → 视为 Venera 图源 */
    var nm = '';
    var m = text.match(/@name\s+(.+)/) || text.match(/name\s*[:=]\s*['"]([^'"]+)['"]/);
    if (m) nm = m[1].trim();
    items.push({ name: nm || '未命名图源', fmt: 'venera', category: '漫画', data: { code: text, name: nm || '未命名图源' } });
  }
  return { items: items, errors: errors };
}

function renderRepo(body) {
  body.innerHTML =
    '<p class="adm-muted" style="margin-bottom:14px">官方仓库是<b>管理员私人</b>的云端源仓库：供管理员自用与向用户分发。用户端「分类 → 官方仓库」输入仓库密码后取用；用户导入的源通过验证后也可自动分享上来（自动分类）。把书源 / 影视源配置 / 图源 JS 粘贴到下面或选择文件上传，系统会自动识别格式并分类，确认后上传。</p>' +
    '<div class="adm-card" style="margin-bottom:12px"><b>上传源（自动分类）</b>' +
      '<textarea class="adm-input" rows="6" data-f="repo-text" style="margin-top:8px" placeholder=\'粘贴书源 JSON（单条或数组）、TVbox 配置、或 Venera 图源 JS 代码…\'></textarea>' +
      '<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;align-items:center">' +
        '<input type="file" data-f="repo-file" multiple accept=".json,.js,.txt" style="font-size:13px">' +
        '<button class="adm-btn" data-act="repo-parse">解析预览</button>' +
      '</div>' +
      '<div data-v="repo-preview"></div>' +
    '</div>' +
    '<div class="adm-card" style="margin-bottom:12px"><b>仓库密码</b>' +
      '<div style="display:flex;gap:10px;margin-top:8px;align-items:center">' +
        '<input class="adm-input" data-f="repo-newpwd" type="text" placeholder="新密码（至少 4 位）" style="max-width:220px">' +
        '<button class="adm-btn" data-act="repo-setpwd">修改仓库密码</button>' +
      '</div>' +
      '<p class="adm-muted" style="margin-top:8px">这是用户端取用 / 分享官方仓库时要输入的密码，与后台登录密码独立。密码不会明文展示，请妥善保管并定期修改。</p>' +
    '</div>' +
    '<div class="adm-card"><b>仓库现有源</b><div data-v="repo-list" style="margin-top:8px"><p class="adm-muted">加载中…</p></div></div>';
  /* 文件选择后读入文本框 */
  $('[data-f="repo-file"]', body).addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    var texts = [];
    var done = 0;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () { texts.push(String(rd.result || '')); if (++done === files.length) { $('[data-f="repo-text"]').value = texts.join('\n,\n'); toast('已读入 ' + files.length + ' 个文件，点「解析预览」'); } };
      rd.readAsText(f);
    });
  });
  repoRenderList(body);
}

function repoRenderList(body) {
  var box = $('[data-v="repo-list"]', body);
  if (!box) return;
  loadSb().then(function (cli) { return cli.rpc('admin_repo_list', { pwd: PWD }); })
    .then(function (r) {
      if (r.error) throw r.error;
      var rows = r.data || [];
      if (!rows.length) { box.innerHTML = '<p class="adm-muted">仓库还是空的，上传源后会显示在这里。</p>'; return; }
      var groups = {};
      rows.forEach(function (x) { var c = x.category || '其他'; (groups[c] = groups[c] || []).push(x); });
      box.innerHTML = Object.keys(groups).sort().map(function (c) {
        return '<div style="margin:10px 0 4px"><b>' + esc(c) + '</b> <span class="adm-muted">（' + groups[c].length + '）</span></div>' +
          groups[c].map(function (x) {
            return '<div class="adm-card" style="margin-bottom:6px;padding:8px 12px;display:flex;align-items:center;gap:10px">' +
              '<div style="flex:1;min-width:0"><b>' + esc(x.name) + '</b> <span class="adm-muted">' + esc(x.fmt) + ' · ' + fmtDate(x.updated_at) + '</span></div>' +
              '<button class="adm-btn adm-btn-sm" data-act="repo-del" data-id="' + esc(x.id) + '">删除</button></div>';
          }).join('');
      }).join('');
    }).catch(function (e) { box.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function repoDoParse() {
  var text = $('[data-f="repo-text"]').value;
  var res = repoParseText(text);
  repoParsed = res.items;
  var box = $('[data-v="repo-preview"]');
  if (!repoParsed.length) { box.innerHTML = '<p class="adm-muted" style="margin-top:10px">没有识别到可用源' + (res.errors.length ? '：' + esc(res.errors.join('；')) : '') + '</p>'; return; }
  box.innerHTML =
    '<div style="margin-top:12px"><b>解析出 ' + repoParsed.length + ' 个源</b>' + (res.errors.length ? ' <span class="adm-muted">（' + res.errors.length + ' 条未识别）</span>' : '') + '</div>' +
    '<div style="max-height:280px;overflow:auto;margin-top:8px">' + repoParsed.map(function (it, i) {
      return '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #2a2f3a">' +
        '<div style="flex:1;min-width:0"><b>' + esc(it.name) + '</b> <span class="adm-muted">' + esc(it.fmt) + '</span></div>' +
        '<select class="adm-input" style="max-width:110px;padding:4px 8px" data-cat="' + i + '">' +
          REPO_CATS.map(function (c) { return '<option' + (c === it.category ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
        '</select></div>';
    }).join('') + '</div>' +
    '<button class="adm-btn adm-btn-primary" data-act="repo-save" style="margin-top:10px">上传到官方仓库</button>';
  $$('[data-cat]', box).forEach(function (sel) {
    sel.addEventListener('change', function () { repoParsed[Number(sel.getAttribute('data-cat'))].category = sel.value; });
  });
}

function repoDoSave(btn) {
  if (!repoParsed.length) { toast('请先解析预览', false); return; }
  var items = repoParsed.map(function (it) {
    return { id: it.fmt + ':' + it.name, name: it.name, fmt: it.fmt, category: it.category, data: it.data };
  });
  btn.disabled = true; btn.textContent = '上传中…';
  loadSb().then(function (cli) { return cli.rpc('admin_repo_upsert', { pwd: PWD, items: items }); })
    .then(function (r) {
      if (r.error) throw r.error;
      toast('已上传 ' + r.data + ' 个源到官方仓库');
      repoParsed = [];
      $('[data-f="repo-text"]').value = '';
      $('[data-v="repo-preview"]').innerHTML = '';
      repoRenderList($('#adm-body'));
    }).catch(function (e) { toast('上传失败：' + e.message, false); btn.disabled = false; btn.textContent = '上传到官方仓库'; });
}


/* ================= 系统设置（v1.3：限时免费模型已独立成标签） ================= */
function renderSystem(body) {
  body.innerHTML =
    '<div class="adm-card" style="margin-bottom:12px;cursor:pointer" data-a="hist">' +
      '<b>📜 历史版本</b>' +
      '<p class="adm-muted" style="margin-top:6px">管理后台更新日志</p>' +
    '</div>' +
    '<div class="adm-card" style="margin-bottom:12px;cursor:pointer" data-a="fm">' +
      '<b>🎁 限时免费模型</b>' +
      '<p class="adm-muted" style="margin-top:6px">已独立为左侧导航「限时免费模型」标签，点击前往</p>' +
    '</div>';
  $('[data-a="fm"]', body).onclick = function () { state.tab = 'freemodels'; renderBody(); };
  $('[data-a="hist"]', body).onclick = function () { renderAdminChangelog(body); };
}

var ADMIN_CHANGELOG = [
  { v: '1.3', d: '2026-08-21', items: ['界面大改：左侧竖排导航（旧版同款布局）、导航与按钮全面图标化', '会员等级改为弹层点选（不再手动输入），可选有效期', '用户昵称可在后台直接修改，敏感操作需再次输入管理员密码，改错可一键恢复原昵称', '支持设置 / 取消管理员（管理员可有多位）', '排行榜改为表格批量编辑：一行一条、可插入行、整体改名次、一次性保存', '限时免费模型独立为左侧标签，不再混在系统设置里'] },
  { v: '1.2', d: '2026-08-21', items: ['限时免费模型升级：仅指定用户可用（按 uid 分配，不只全员开放）、限时窗口（时间窗内无限用）、限量额度（次数 / Token，用完即止）、限时+限量组合；支持编辑与用量展示'] },
  { v: '1.1', d: '2026-08-21', items: ['系统设置上线：限时免费模型管理（多模型 / 分等级 Token 配额 / 可用模型范围）、历史版本页'] },
  { v: '1.0', d: '2026-08-21', items: ['管理后台初始化：仪表盘 / 用户管理 / 订单 / 会员定价 / 模型定价 / 排行榜 / 官方仓库'] },
];
function renderAdminChangelog(body) {
  body.innerHTML = '<div class="adm-card"><b>历史版本</b>' +
    ADMIN_CHANGELOG.map(function (c) {
      return '<div style="padding:12px 0;border-bottom:1px solid #2a2f3a">' +
        '<b>v' + c.v + '</b> <span class="adm-muted">' + c.d + '</span>' +
        '<ul style="margin:6px 0 0 18px;font-size:13px;color:var(--muted)">' + c.items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>' +
      '</div>';
    }).join('') +
    '</div><button class="adm-btn" style="margin-top:12px" data-a="back">返回</button>';
  $('[data-a="back"]', body).onclick = function () { renderSystem(body); };
}
var FM_EDIT_ID = null;
function toLocalInput(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function parseUids(s) {
  return String(s || '').split(/[\n,，;；\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}
function fmTimeBadge(x) {
  var now = Date.now();
  if (x.start_time && now < new Date(x.start_time).getTime()) return '<span style="font-size:11px;padding:1px 8px;border-radius:10px;color:#fbbf24;border:1px solid #fbbf2455;background:#fbbf2422">未开始</span>';
  if (x.end_time && now > new Date(x.end_time).getTime()) return '<span style="font-size:11px;padding:1px 8px;border-radius:10px;color:#9aa3b2;border:1px solid #9aa3b255;background:#9aa3b222">已过期</span>';
  return '<span style="font-size:11px;padding:1px 8px;border-radius:10px;color:#34d399;border:1px solid #34d39955;background:#34d39922">生效中</span>';
}
function renderFreeModels(body) {
  body.innerHTML =
    '<div class="adm-card" style="margin-bottom:12px">' +
      '<b data-v="ftitle">添加限时免费模型</b>' +
      '<div class="row" style="margin-top:10px;gap:8px">' +
        '<input class="adm-input" data-f="provider" placeholder="厂商 id（deepseek / zhipu / openai）" style="flex:1;margin-bottom:0">' +
        '<input class="adm-input" data-f="model" placeholder="模型名（deepseek-v4-flash）" style="flex:1.2;margin-bottom:0">' +
        '<input class="adm-input" data-f="name" placeholder="显示名（可选）" style="flex:.8;margin-bottom:0">' +
      '</div>' +
      '<p class="adm-muted" style="margin:10px 0 6px">适用范围</p>' +
      '<div class="row" style="gap:16px">' +
        '<label style="font-size:13px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="fm-scope" value="all" checked> 全体用户</label>' +
        '<label style="font-size:13px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="radio" name="fm-scope" value="users"> 仅指定用户</label>' +
      '</div>' +
      '<textarea data-f="uids" placeholder="指定用户的 uid，每行一个（勾选“仅指定用户”后填写）" style="display:none;width:100%;margin-top:8px;padding:8px;min-height:70px;box-sizing:border-box;border:1px solid #2a2f3a;border-radius:6px;background:#0d0f14;color:var(--text);font-size:13px"></textarea>' +
      '<p class="adm-muted" style="margin:10px 0 6px">限时窗口（留空 = 不限时；窗口内无限使用）</p>' +
      '<div class="row" style="gap:8px">' +
        '<input class="adm-input" type="datetime-local" data-f="start" style="flex:1;margin-bottom:0">' +
        '<input class="adm-input" type="datetime-local" data-f="end" style="flex:1;margin-bottom:0">' +
      '</div>' +
      '<p class="adm-muted" style="margin:10px 0 6px">限量（留空 = 不限量；用完即止）</p>' +
      '<div class="row" style="gap:8px">' +
        '<input class="adm-input" data-f="maxq" type="number" min="1" placeholder="最大可用量" style="flex:1;margin-bottom:0">' +
        '<select class="adm-input" data-f="unit" style="flex:.7;margin-bottom:0">' +
          '<option value="count">次数</option>' +
          '<option value="tokens">Token</option>' +
        '</select>' +
      '</div>' +
      '<p class="adm-muted" style="margin:10px 0 6px">等级日配额（可选，留空 = 该等级不限）</p>' +
      '<div class="row" style="gap:6px;flex-wrap:wrap">' +
        LEVELS.map(function (lv) {
          return '<label style="font-size:12px;display:flex;align-items:center;gap:4px">' + lv.name + ' <input type="number" data-lv="' + lv.id + '" placeholder="不限" style="width:70px;padding:4px 6px;border:1px solid #2a2f3a;border-radius:6px;background:#0d0f14;color:var(--text)"> <span class="adm-muted">token/日</span></label>';
        }).join('') +
      '</div>' +
      '<input class="adm-input" data-f="note" placeholder="备注（可选）" style="margin-top:10px">' +
      '<div class="row" style="margin-top:12px;gap:8px">' +
        '<button class="adm-btn adm-btn-primary" data-a="save">添加</button>' +
        '<button class="adm-btn" data-a="cancel" style="display:none">取消编辑</button>' +
      '</div>' +
    '</div>' +
    '<div class="adm-card"><b>当前免费模型</b><div data-v="list" style="margin-top:10px"><p class="adm-muted">加载中…</p></div></div>';
  var listBox = $('[data-v="list"]', body);
  var uidsBox = $('[data-f="uids"]', body);
  function scopeVal() { var r = $('input[name="fm-scope"]:checked', body); return r ? r.value : 'all'; }
  function toggleUids() { uidsBox.style.display = scopeVal() === 'users' ? 'block' : 'none'; }
  $$('input[name="fm-scope"]', body).forEach(function (r) { r.onchange = toggleUids; });
  function readForm() {
    var st = $('[data-f="start"]', body).value, en = $('[data-f="end"]', body).value;
    var limits = {};
    LEVELS.forEach(function (lv) {
      var v = parseInt(($('[data-lv="' + lv.id + '"]', body) || {}).value, 10) || 0;
      if (v > 0) limits[lv.id] = v;
    });
    return {
      provider: $('[data-f="provider"]', body).value.trim(),
      model: $('[data-f="model"]', body).value.trim(),
      name: $('[data-f="name"]', body).value.trim() || null,
      scope: scopeVal(),
      user_ids: scopeVal() === 'users' ? parseUids(uidsBox.value) : [],
      start_time: st ? new Date(st).toISOString() : null,
      end_time: en ? new Date(en).toISOString() : null,
      max_quota: parseInt($('[data-f="maxq"]', body).value, 10) || 0,
      quota_unit: $('[data-f="unit"]', body).value,
      level_limits: limits,
      note: $('[data-f="note"]', body).value.trim() || null
    };
  }
  function fillForm(x) {
    FM_EDIT_ID = x.id;
    $('[data-v="ftitle"]', body).textContent = '编辑模型：' + x.provider + '/' + x.model;
    $('[data-f="provider"]', body).value = x.provider || '';
    $('[data-f="model"]', body).value = x.model || '';
    $('[data-f="name"]', body).value = x.name || '';
    var sc = x.scope === 'users' ? 'users' : 'all';
    var r0 = $('input[name="fm-scope"][value="' + sc + '"]', body); if (r0) r0.checked = true;
    uidsBox.value = (x.user_ids || []).join('\n');
    toggleUids();
    $('[data-f="start"]', body).value = toLocalInput(x.start_time);
    $('[data-f="end"]', body).value = toLocalInput(x.end_time);
    $('[data-f="maxq"]', body).value = x.max_quota > 0 ? String(x.max_quota) : '';
    $('[data-f="unit"]', body).value = x.quota_unit === 'tokens' ? 'tokens' : 'count';
    var ll = {};
    try { ll = x.level_limits && typeof x.level_limits === 'object' ? x.level_limits : JSON.parse(x.level_limits || '{}'); } catch (e) { ll = {}; }
    LEVELS.forEach(function (lv) {
      var inp = $('[data-lv="' + lv.id + '"]', body);
      if (inp) inp.value = ll[lv.id] ? String(ll[lv.id]) : '';
    });
    $('[data-f="note"]', body).value = x.note || '';
    $('[data-a="save"]', body).textContent = '保存修改';
    $('[data-a="cancel"]', body).style.display = '';
    body.scrollIntoView();
  }
  function resetForm() {
    FM_EDIT_ID = null;
    $('[data-v="ftitle"]', body).textContent = '添加限时免费模型';
    ['provider', 'model', 'name', 'start', 'end', 'maxq', 'note'].forEach(function (k) {
      var inp = $('[data-f="' + k + '"]', body); if (inp) inp.value = '';
    });
    uidsBox.value = '';
    var r0 = $('input[name="fm-scope"][value="all"]', body); if (r0) r0.checked = true;
    toggleUids();
    LEVELS.forEach(function (lv) { var inp = $('[data-lv="' + lv.id + '"]', body); if (inp) inp.value = ''; });
    $('[data-a="save"]', body).textContent = '添加';
    $('[data-a="cancel"]', body).style.display = 'none';
  }
  function load() {
    loadSb().then(function (cli) { return cli.rpc('admin_free_models_list', { pwd: PWD }); })
      .then(function (r) {
        if (r.error) throw r.error;
        var rows = r.data || [];
        if (!rows.length) { listBox.innerHTML = '<p class="adm-muted">还没有免费模型</p>'; return; }
        listBox.innerHTML = rows.map(function (x) {
          var scopeTxt = x.scope === 'users' ? '指定 ' + (x.user_ids || []).length + ' 人' : '全体';
          var timeTxt = '';
          if (x.start_time || x.end_time) {
            timeTxt = fmTimeBadge(x) + ' ' + (x.start_time ? fmtDate(x.start_time) : '…') + ' ~ ' + (x.end_time ? fmtDate(x.end_time) : '…');
          }
          var quotaTxt = x.max_quota > 0
            ? '限量 ' + esc(x.used_quota || 0) + ' / ' + esc(x.max_quota) + (x.quota_unit === 'tokens' ? ' token' : ' 次')
            : ((x.used_quota || 0) > 0 ? '已用 ' + esc(x.used_quota) : '不限量');
          return '<div class="adm-card" style="margin-bottom:6px;padding:8px 12px;display:flex;align-items:center;gap:10px">' +
            '<div style="flex:1;min-width:0">' +
              '<b>' + esc(x.provider) + '/' + esc(x.model) + '</b>' + (x.name ? ' <span class="adm-muted">' + esc(x.name) + '</span>' : '') +
              '<div class="adm-muted" style="margin-top:3px;font-size:12px">' +
                '<span style="color:#60a5fa">' + scopeTxt + '</span>' +
                (timeTxt ? ' · ' + timeTxt : '') +
                ' · ' + quotaTxt +
              '</div>' +
            '</div>' +
            '<button class="adm-btn adm-btn-sm" data-edit="' + esc(x.id) + '">编辑</button>' +
            '<button class="adm-btn adm-btn-sm" data-del="' + esc(x.id) + '">删除</button>' +
          '</div>';
        }).join('');
        $$('[data-del]', listBox).forEach(function (b) {
          b.onclick = function () {
            loadSb().then(function (cli) { return cli.rpc('admin_free_models_remove', { pwd: PWD, id: b.getAttribute('data-del') }); })
              .then(function (rr) {
                if (rr.error) throw rr.error;
                toast('已删除');
                if (FM_EDIT_ID === parseInt(b.getAttribute('data-del'), 10)) resetForm();
                load();
              }).catch(function (e) { toast('删除失败：' + e.message, false); });
          };
        });
        $$('[data-edit]', listBox).forEach(function (b) {
          b.onclick = function () {
            var x = rows.find(function (row) { return String(row.id) === b.getAttribute('data-edit'); });
            if (x) fillForm(x);
          };
        });
      }).catch(function (e) { listBox.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
  }
  $('[data-a="save"]', body).onclick = function () {
    var f = readForm();
    if (!f.provider || !f.model) { toast('请填写厂商与模型名', false); return; }
    if (f.scope === 'users' && !f.user_ids.length) { toast('请填写至少一个指定用户 uid', false); return; }
    var btn = $('[data-a="save"]', body);
    btn.disabled = true;
    var arg = { pwd: PWD, provider: f.provider, model: f.model, name: f.name, scope: f.scope, user_ids: f.user_ids, start_time: f.start_time, end_time: f.end_time, max_quota: f.max_quota, quota_unit: f.quota_unit, level_limits: f.level_limits, note: f.note };
    loadSb().then(function (cli) {
      if (FM_EDIT_ID) {
        var arg2 = { id: FM_EDIT_ID };
        for (var k in arg) arg2[k] = arg[k];
        return cli.rpc('admin_free_models_update', arg2);
      }
      return cli.rpc('admin_free_models_add', arg);
    }).then(function (r) {
      if (r.error) throw r.error;
      toast(FM_EDIT_ID ? '已保存修改' : '已添加免费模型', true);
      resetForm();
      load();
    }).catch(function (e) { toast('保存失败：' + e.message, false); })
      .finally(function () { btn.disabled = false; btn.textContent = FM_EDIT_ID ? '保存修改' : '添加'; });
  };
  $('[data-a="cancel"]', body).onclick = resetForm;
  toggleUids();
  load();
}

function renderPayCfg(body) {
  body.innerHTML = '<p class="adm-muted">加载中…</p>';
  loadSb().then(function (cli) { return cli.from('th_pay_config').select('*').eq('key', 'payment'); })
    .then(function (r) {
      if (r.error) throw r.error;
      var v = (r.data && r.data[0] && r.data[0].value) || {};
      var ali = v.alipay || {}, wx = v.wechat || {};
      body.innerHTML =
        '<p class="adm-muted" style="margin-bottom:14px">预接支付：填写收款账号与收款码图片地址（可上传到任意图床）。用户下单后按此信息转账，你在「订单管理」确认收款后系统自动开通会员。后续接入官方支付网关时此处换成商户参数即可。</p>' +
        '<div class="adm-card" style="margin-bottom:12px"><b>支付宝</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">收款账号<input class="adm-input" data-f="ali-account" value="' + esc(ali.account || '') + '" placeholder="手机号 / 邮箱"></label>' +
            '<label class="adm-muted">收款码图片 URL<input class="adm-input" data-f="ali-qr" value="' + esc(ali.qr || '') + '" placeholder="https://…"></label>' +
          '</div>' +
          '<label class="adm-muted" style="display:block;margin-top:8px">备注说明<input class="adm-input" data-f="ali-note" value="' + esc(ali.note || '') + '" placeholder="如：请备注订单号"></label>' +
          '<label class="adm-muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" data-f="ali-enabled"' + (ali.enabled !== false ? ' checked' : '') + '> 启用支付宝支付</label>' +
        '</div>' +
        '<div class="adm-card" style="margin-bottom:12px"><b>微信支付</b>' +
          '<div class="adm-form-grid" style="margin-top:8px">' +
            '<label class="adm-muted">收款账号<input class="adm-input" data-f="wx-account" value="' + esc(wx.account || '') + '" placeholder="微信号"></label>' +
            '<label class="adm-muted">收款码图片 URL<input class="adm-input" data-f="wx-qr" value="' + esc(wx.qr || '') + '" placeholder="https://…"></label>' +
          '</div>' +
          '<label class="adm-muted" style="display:block;margin-top:8px">备注说明<input class="adm-input" data-f="wx-note" value="' + esc(wx.note || '') + '" placeholder="如：请备注订单号"></label>' +
          '<label class="adm-muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" data-f="wx-enabled"' + (wx.enabled !== false ? ' checked' : '') + '> 启用微信支付</label>' +
        '</div>' +
        '<div class="adm-card" style="margin-bottom:12px"><b>通用提示语</b>' +
          '<textarea class="adm-input" rows="3" data-f="tip" style="margin-top:8px">' + esc(v.tip || '') + '</textarea>' +
        '</div>' +
        '<button class="adm-btn adm-btn-primary" data-act="save-paycfg">保存收款设置</button>';
    }).catch(function (e) { body.innerHTML = '<p class="adm-muted">加载失败：' + esc(e.message) + '</p>'; });
}

function savePayCfg() {
  var val = {
    alipay: {
      enabled: $('[data-f="ali-enabled"]').checked,
      label: '支付宝',
      account: $('[data-f="ali-account"]').value.trim(),
      qr: $('[data-f="ali-qr"]').value.trim(),
      note: $('[data-f="ali-note"]').value.trim(),
    },
    wechat: {
      enabled: $('[data-f="wx-enabled"]').checked,
      label: '微信支付',
      account: $('[data-f="wx-account"]').value.trim(),
      qr: $('[data-f="wx-qr"]').value.trim(),
      note: $('[data-f="wx-note"]').value.trim(),
    },
    tip: $('[data-f="tip"]').value.trim(),
  };
  loadSb().then(function (cli) {
    return cli.rpc('admin_set_pay_config', { pwd: PWD, val: val });
  }).then(function (r) {
    if (r.error) throw r.error;
    toast('收款设置已保存');
  }).catch(function (e) { toast('保存失败：' + e.message, false); });
}

/* ---------- 全局事件委托（一次绑定，永不失效） ---------- */
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.getAttribute('data-act');
  if (act === 'logout') {
    sessionStorage.removeItem('th-admin-pwd'); PWD = ''; state.users = null; renderGate();
  } else if (act === 'tab') {
    state.tab = t.getAttribute('data-t');
    $$('.adm-tabs .adm-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === state.tab); });
    renderBody();
  } else if (act === 'go') {
    state.tab = t.getAttribute('data-t');
    renderHome();
  } else if (act === 'usertab') {
    state.userTab = t.getAttribute('data-t');
    renderBody();
  } else if (act === 'follow') {
    toggleFollow(t.getAttribute('data-uid'));
    fetchUsers().then(function (users) { renderUserList(users); });
  } else if (act === 'setlevel') {
    setUserLevel(t.getAttribute('data-uid'));
  } else if (act === 'save-plan') {
    savePlan(t);
  } else if (act === 'confirm-order' || act === 'cancel-order') {
    var no = t.getAttribute('data-no');
    var rpc = act === 'confirm-order' ? 'admin_confirm_order' : 'admin_cancel_order';
    if (act === 'confirm-order' && !confirm('确认已收到订单 ' + no + ' 的款项？确认后将自动开通会员。')) return;
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc(rpc, { pwd: PWD, p_order_no: no }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast(act === 'confirm-order' ? '已确认收款，会员已开通' : '订单已取消');
        renderBody();
      }).catch(function (err) { toast('操作失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'reply-fb') {
    var card = t.closest('[data-fid]');
    var fid = card.getAttribute('data-fid');
    var content = prompt('输入官方回复内容：');
    if (!content) return;
    loadSb().then(function (cli) { return cli.rpc('admin_reply_feedback', { pwd: PWD, fid: fid, content: content }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast('已回复'); renderBody();
      }).catch(function (err) { toast('回复失败：' + err.message, false); });
  } else if (act === 'toggle-fb') {
    var card2 = t.closest('[data-fid]');
    var fid2 = card2.getAttribute('data-fid');
    var isDone = t.textContent.indexOf('待处理') >= 0;
    loadSb().then(function (cli) { return cli.rpc('admin_set_feedback_status', { pwd: PWD, fid: fid2, status: isDone ? 'open' : 'done' }); })
      .then(function (r) {
        if (r.error) throw r.error;
        renderBody();
      }).catch(function (err) { toast('操作失败：' + err.message, false); });
  } else if (act === 'save-paycfg') {
    savePayCfg();
  } else if (act === 'repo-parse') {
    repoDoParse();
  } else if (act === 'repo-save') {
    repoDoSave(t);
  } else if (act === 'repo-del') {
    if (!confirm('从官方仓库删除这个源？用户端将无法再取用（已导入的不受影响）。')) return;
    loadSb().then(function (cli) { return cli.rpc('admin_repo_delete', { pwd: PWD, ids: [t.getAttribute('data-id')] }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast('已删除'); repoRenderList($('#adm-body'));
      }).catch(function (err) { toast('删除失败：' + err.message, false); });
  } else if (act === 'repo-setpwd') {
    var np = $('[data-f="repo-newpwd"]').value.trim();
    if (!np || np.length < 4) { toast('新密码至少 4 位', false); return; }
    loadSb().then(function (cli) { return cli.rpc('admin_repo_set_password', { pwd: PWD, new_pwd: np }); })
      .then(function (r) {
        if (r.error) throw r.error;
        if (r.data) { toast('仓库密码已修改'); $('[data-f="repo-newpwd"]').value = ''; }
        else toast('修改失败', false);
      }).catch(function (err) { toast('修改失败：' + err.message, false); });
  } else if (act === 'toggle-invoice') {
    var ivCard = t.closest('[data-iv]');
    var ivId = ivCard.getAttribute('data-iv');
    var nowDone = t.textContent.indexOf('待处理') >= 0; // 按钮显示“标记待处理”说明当前已开具
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc('admin_set_invoice_status', { pwd: PWD, p_id: ivId, p_status: nowDone ? 'pending' : 'done' }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast(nowDone ? '已标记为待处理' : '已标记为已开具');
        renderBody();
      }).catch(function (err) { toast('操作失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'save-price') {
    var pm = $('[data-f="p-model"]').value.trim();
    var pin = parseFloat($('[data-f="p-in"]').value);
    var pout = parseFloat($('[data-f="p-out"]').value);
    if (!pm) { toast('请填写模型键', false); return; }
    if (isNaN(pin) || isNaN(pout)) { toast('请填写输入 / 输出价格', false); return; }
    t.disabled = true;
    loadSb().then(function (cli) { return cli.rpc('admin_set_model_price', { pwd: PWD, p_model: pm, p_in: pin, p_out: pout }); })
      .then(function (r) {
        if (r.error) throw r.error;
        state.priceEdit = ''; state.priceIn = ''; state.priceOut = '';
        toast('价格已保存，用户端下次启动生效');
        renderBody();
      }).catch(function (err) { toast('保存失败：' + err.message, false); t.disabled = false; });
  } else if (act === 'edit-price') {
    var pCard = t.closest('[data-model]');
    state.priceEdit = pCard.getAttribute('data-model');
    var m = pCard.querySelector('.adm-badge').textContent.match(/in \$([\d.]+) \/ out \$([\d.]+)/);
    state.priceIn = m ? m[1] : ''; state.priceOut = m ? m[2] : '';
    renderBody();
  } else if (act === 'del-price') {
    var dm = t.closest('[data-model]').getAttribute('data-model');
    if (!confirm('删除 ' + dm + ' 的云端价格？删除后该模型回退到内置价目。')) return;
    loadSb().then(function (cli) { return cli.rpc('admin_delete_model_price', { pwd: PWD, p_model: dm }); })
      .then(function (r) {
        if (r.error) throw r.error;
        toast('已删除'); renderBody();
      }).catch(function (err) { toast('删除失败：' + err.message, false); });
  } else if (act === 'import-prices') {
    if (!confirm('把 App 内置的完整价目导入云端？导入后云端价目优先生效，可随时再编辑。')) return;
    import('./js/ai/ai-pricing.js').then(function (mod) {
      var rows = Object.keys(mod.MODEL_PRICES).map(function (k) {
        return { model: k, in: mod.MODEL_PRICES[k].in, out: mod.MODEL_PRICES[k].out };
      });
      importPrices(rows);
    }).catch(function (e) { toast('读取内置价目失败：' + e.message, false); });
  } else if (act === 'rank-add') {
    var tb = $('[data-v="rank-tb"]');
    if (!tb) return;
    var last = $$('[data-v="rk"]', tb).pop();
    var nextRank = last ? (parseInt($('[data-rk="rank"]', last).value, 10) || 0) + 1 : 1;
    tb.insertAdjacentHTML('beforeend', rankRowHtml(nextRank, '', '', ''));
  } else if (act === 'rank-delrow') {
    var tr = t.closest('[data-v="rk"]');
    if (!tr) return;
    if (tr.classList.contains('del')) { tr.classList.remove('del'); t.style.opacity = ''; }
    else { tr.classList.add('del'); t.style.opacity = '.5'; tr.style.opacity = '.45'; }
  } else if (act === 'rank-saveall') {
    rankSaveAll(t);
  } else if (act === 'editnick') {
    editUserNickname(t.getAttribute('data-uid'));
  } else if (act === 'restorenick') {
    restoreUserNickname(t.getAttribute('data-uid'));
  } else if (act === 'setrole') {
    toggleUserRole(t.getAttribute('data-uid'), t.getAttribute('data-role'));
  } else if (act === 'import-rank') {
    if (!confirm('把 App 内置综合榜导入云端？导入后覆盖 App 内置榜单，可随时再编辑。')) return;
    import('./js/ai/ai-rankings.js').then(function (mod) {
      var rows = mod.RANKINGS.overall;
      var i = 0, fail = 0;
      toast('开始导入 ' + rows.length + ' 名…');
      (function next() {
        if (i >= rows.length) { toast('导入完成' + (fail ? '（失败 ' + fail + ' 条）' : '')); renderBody(); return; }
        var x = rows[i++];
        loadSb().then(function (cli) {
          return cli.rpc('admin_upsert_leaderboard', { pwd: PWD, p_rank: i, p_model: x.m, p_org: x.p, p_score: x.s, p_note: '' });
        }).then(function (r) { if (r.error) fail++; next(); }).catch(function () { fail++; next(); });
      })();
    }).catch(function (e) { toast('读取内置榜单失败：' + e.message, false); });
  }
});

/* 文件选择（模型定价导入） */
document.addEventListener('change', function (e) {
  var f = e.target.closest('[data-act-file="prices"]');
  if (!f || !f.files || !f.files[0]) return;
  var file = f.files[0];
  var reader = new FileReader();
  reader.onload = function () {
    var rows = [];
    try {
      var txt = String(reader.result || '');
      if (/\.json$/i.test(file.name) || txt.trim().charAt(0) === '[' || txt.trim().charAt(0) === '{') {
        var j = JSON.parse(txt);
        if (Array.isArray(j)) {
          j.forEach(function (x) { if (x && x.model) rows.push({ model: String(x.model), in: parseFloat(x.in != null ? x.in : x.input_price) || 0, out: parseFloat(x.out != null ? x.out : x.output_price) || 0 }); });
        } else {
          Object.keys(j).forEach(function (k) { var v = j[k]; rows.push({ model: k, in: parseFloat(v.in != null ? v.in : v.input_price) || 0, out: parseFloat(v.out != null ? v.out : v.output_price) || 0 }); });
        }
      } else {
        txt.split(/\r?\n/).forEach(function (line) {
          var parts = line.split(/[,\t]/);
          if (parts.length >= 3 && parts[0].trim()) rows.push({ model: parts[0].trim(), in: parseFloat(parts[1]) || 0, out: parseFloat(parts[2]) || 0 });
        });
      }
    } catch (err) { toast('文件解析失败：' + err.message, false); return; }
    if (!rows.length) { toast('文件里没有可用的价格数据', false); return; }
    if (!confirm('识别到 ' + rows.length + ' 条价格，导入云端？')) return;
    importPrices(rows);
  };
  reader.readAsText(file);
  f.value = '';
});

/* ---------- 启动 ---------- */
if (PWD) renderHome(); else renderGate();

})();
