/* ============ 03 视图：登录 / 外壳 / 总览 / 项目列表 ============ */
'use strict';

/* ---------- 登录页 ---------- */
/* 两种模式：
   · feishu —— 正式形态，员工用飞书身份登录
   · local  —— 开发 / 离线演示，用本地账号密码
   模式由服务端 /api/auth/mode 下发，前端不写死。 */
function renderLogin() {
  const app = $('#app');
  const head =
    '<div class="lg"><div class="mark">忆</div><div><div class="t1">忆古轩项目管理系统</div><div class="t2">YIGUXUAN HOME · 全流程管理平台</div></div></div>' +
    '<div class="sub">销售成交 → 设计 → 生产 → 出货审批 → 安装 → 售后</div>';

  /* 先渲染飞书登录（正式形态），再按服务端下发的模式决定是否补上本地登录表单 */
  app.innerHTML =
    '<div class="login-wrap"><div class="login-card" id="lg-card">' + head +
    '<div id="lg-body"><div style="text-align:center;color:var(--gray);font-size:13px;padding:18px 0">正在检测登录方式…</div></div>' +
    '</div></div>';

  const body = $('#lg-body');

  /* 本地账号密码表单（开发 / 离线演示模式） */
  const localForm =
    '<div class="field"><label>账号</label><input id="lg-user" placeholder="账号 / 姓名 / 手机号 都可以" autocomplete="username"></div>' +
    '<div class="field"><label>密码</label><input id="lg-pass" type="password" placeholder="输入密码" autocomplete="current-password"></div>' +
    '<button class="btn primary big" style="width:100%" id="lg-btn">登 录</button>' +
    '<div class="demo-accounts"><div class="dt">演示账号（初始密码均为 123456，点击直接填入）：</div>' +
    [['demo_owner', '演示老板 · 老板'], ['demo_approver', '演示审批主管 · 项目经理'], ['demo_sales_1', '演示销售甲 · 销售'], ['demo_designer_1', '演示设计甲 · 设计师'],
     ['demo_wood', '演示木工主管 · 木工'], ['demo_paint', '演示油漆主管 · 油漆'], ['demo_shipping', '演示发货负责人 · 发货'], ['demo_external', '演示外接负责人 · 外接'], ['demo_purchase', '演示采购负责人 · 五金采购']]
      .map((a) => '<span class="chip" data-u="' + a[0] + '">' + ico('user', 14) + ' ' + a[1] + '</span>').join('') +
    '</div>';

  function bindLocal() {
    $$('.chip', app).forEach((c) => c.onclick = () => { $('#lg-user').value = c.dataset.u; $('#lg-pass').value = '123456'; });
    const doLogin = async () => {
      const btn = $('#lg-btn');
      btn.disabled = true; btn.textContent = '登录中…';
      try {
        await api('/api/login', { method: 'POST', body: { username: $('#lg-user').value.trim(), password: $('#lg-pass').value } });
        await loadBootstrap();
        nav('#/dashboard');
        render();
        toast('欢迎回来，' + S.me.name, 'ok');
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '登 录'; }
    };
    $('#lg-btn').onclick = doLogin;
    $('#lg-pass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  }

  /* 飞书登录按钮（正式形态） */
  const feishuBtn = (ready) =>
    '<button class="btn primary big" style="width:100%" id="lg-feishu"' + (ready ? '' : ' disabled') + '>' +
    ico('shield', 18) + (ready ? '飞 书 登 录' : '飞书登录未配置') + '</button>' +
    (ready ? '' : '<div class="hint" style="text-align:center">请联系管理员在「系统设置」中填写飞书应用凭据</div>');

  api('/api/auth/mode').then((m) => {
    if (!body.isConnected) return;
    const mode = (m && m.mode) || 'local';
    const ready = !!(m && m.feishu_ready);
    if (mode === 'feishu') {
      body.innerHTML = feishuBtn(ready) +
        (ready ? '<div class="hint" style="text-align:center;margin-top:10px">首次登录需要在飞书中确认授权</div>' : '');
      const fb = $('#lg-feishu');
      if (fb && ready) fb.onclick = () => { location.href = '/api/auth/feishu/start'; };
      /* 正式模式下默认不展示本地登录；管理员可用 YGX_ALLOW_LOCAL_LOGIN=1 保留入口 */
      return;
    }
    body.innerHTML = localForm;
    bindLocal();
  }).catch(() => {
    if (!body.isConnected) return;
    /* 取不到模式时退回本地登录，保证离线也能进 */
    body.innerHTML = localForm;
    bindLocal();
  });
}

/* ---------- 应用外壳 ---------- */
function renderShell(route, contentHtml) {
  const unread = S.db.notifications.filter((n) => !n.read).length;
  const items = navItems();
  const app = $('#app');
  if (S.simpleMode) {
    app.innerHTML = '<div class="simple-shell"><header class="simple-top"><b>' + (route.name === 'dashboard' ? '我的工作' : '<button class="btn" onclick="nav(\'#/dashboard\')">返回待办</button>') + '</b><div><button class="btn" onclick="switchPageMode()">切换正式页面</button><button class="btn" onclick="doLogout()">退出</button></div></header>' +
      '<main class="simple-content' + (route.name === 'project' ? ' simple-detail' : '') + '">' + contentHtml + '</main></div>';
    return;
  }
  app.innerHTML =
    '<div class="shell">' +
    '<aside class="sidebar">' +
      '<div class="logo"><div class="mark">忆</div><div><div class="t1">忆古轩</div><div class="t2">项目全流程管理</div></div></div>' +
      '<div class="nav">' +
        '<div class="sec">业务模块</div>' +
        items.filter((i) => i.key !== 'my').map((i) => '<div class="nav-item' + (route.name === i.key || (i.key === 'dashboard' && (route.name === 'todo' || route.name === 'drill')) ? ' active' : '') + '" onclick="nav(\'#/' + i.key + '\')"><span class="ico">' + ico(i.ic, 18) + '</span>' + i.label + (i.key === 'dashboard' && S.db.stats.todoCount ? '<span class="cnt">' + S.db.stats.todoCount + '</span>' : '') + '</div>').join('') +
      '</div>' +
      '<div class="side-user"><div class="avatar">' + h(S.me.name[0]) + '</div><div><div class="nm">' + h(S.me.name) + '</div><div class="rl">' + h(rolesLabel(S.me.roles)) + '</div></div><button onclick="doLogout()">退出</button></div>' +
    '</aside>' +
    '<div class="main">' +
      '<header class="topbar"><h1>' + h(pageTitle(route)) + '</h1><div class="spacer"></div>' +
        '<button class="bell" onclick="toggleNotif()">' + ico('bell', 20) + (unread ? '<span class="dot">' + unread + '</span>' : '') + '</button>' +
        (['demo-person-015', 'demo-person-017'].includes(S.me.id) ? '<button class="btn" onclick="switchPageMode()">' + (S.simpleMode ? '简洁页面' : '切换简洁页面') + '</button>' : '') +
        '<span style="font-size:13px;color:var(--gray)">' + h(S.me.name) + ' · ' + h(rolesLabel(S.me.roles)) + '</span>' +
      '</header>' +
      '<main class="content">' + contentHtml + '</main>' +
    '</div></div>' +
    (canNewProject() ? '<button class="fab" onclick="openNewProject()" title="新建项目">' + ico('plus', 26) + '</button>' : '') +
    '<nav class="tabbar">' +
      [['dashboard', 'home', '首页'], ['projects', 'folder', '项目'], ['todo', 'checkSquare', '任务'], ['my', 'user', '我的']].map((t) =>
        '<div class="tb' + (route.name === t[0] ? ' active' : '') + '" onclick="nav(\'#/' + t[0] + '\')"><span class="ic">' + ico(t[1], 22) + '</span>' + t[2] + '</div>').join('') +
    '</nav>';
  if (S.notifOpen) renderNotifPop();
}
function pageTitle(route) {
  const titles = { dashboard: '项目总览', projects: '项目列表', design: '设计任务中心', production: '生产看板', ship: '出货审批中心', install: '安装管理', aftersales: '售后服务中心', reports: '数据报表', staff: '员工管理', fields: '表单字段设置', my: '我的', todo: '我的待办' };
  if (route.name === 'project' && S.detail) return '项目详情 · ' + S.detail.project.project_no;
  if (route.name === 'drill') return drillMeta(route).title;
  return titles[route.name] || '项目总览';
}
async function doLogout() {
  if (S.me && ['demo-person-015', 'demo-person-017'].includes(S.me.id)) sessionStorage.removeItem('ygx-page-mode:' + S.me.id);
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  S.me = null; S.db = null; S.detail = null; S.notifOpen = false; S.simpleMode = false;
  if (location.hash !== '#/dashboard') history.replaceState(null, '', location.pathname + location.search + '#/dashboard');
  render();
}
function switchPageMode() {
  if (!S.me || !['demo-person-015', 'demo-person-017'].includes(S.me.id)) return;
  S.simpleMode = !S.simpleMode;
  sessionStorage.setItem('ygx-page-mode:' + S.me.id, S.simpleMode ? 'simple' : 'full');
  nav('#/dashboard'); render();
}

/* 通知中心 */
async function toggleNotif() {
  S.notifOpen = !S.notifOpen;
  if (S.notifOpen) await refreshNotifications();
  render();
}
let notificationRefreshBusy = false;
async function refreshNotifications() {
  if (!S.me || !S.db || notificationRefreshBusy || !navigator.onLine) return;
  notificationRefreshBusy = true;
  const userId = S.me.id;
  try {
    const result = await api('/api/notifications');
    if (S.me?.id !== userId || !S.db) return;
    S.db.notifications = result.notifications;
    const bell = $('.bell');
    if (bell) {
      bell.querySelector('.dot')?.remove();
      const count = result.notifications.filter(n => !n.read).length;
      if (count) { const badge = document.createElement('span'); badge.className = 'dot'; badge.textContent = count; bell.appendChild(badge); }
    }
  } catch (_) { /* Keep the current form and retry on the next refresh. */ }
  finally { notificationRefreshBusy = false; }
}
async function renderNotifPop() {
  const list = S.db.notifications;
  const pop = document.createElement('div');
  pop.className = 'notif-pop';
  pop.innerHTML =
    '<div class="nh">消息通知<button id="notif-read">全部已读</button></div>' +
    '<div class="nlist">' + (list.length ? list.slice(0, 30).map((n) =>
      '<div class="notif-item' + (n.read ? '' : ' unread') + '" onclick="nav(\'' + (n.link || '#/dashboard').replace(/'/g, "\\'") + '\');toggleNotif()">' +
      '<div>' + h(n.text) + '</div><div class="nt">' + fmtDT(n.at) + '</div></div>'
    ).join('') : '<div class="empty-mini">暂无消息</div>') + '</div>';
  const topbar = $('.topbar');
  topbar.style.position = 'relative';
  topbar.appendChild(pop);
  $('#notif-read', pop).onclick = async (e) => { e.stopPropagation(); await api('/api/notifications/read', { method: 'POST' }); await loadBootstrap(); S.notifOpen = true; render(); };
  setTimeout(() => {
    const closer = (ev) => { if (!pop.contains(ev.target) && !ev.target.closest('.bell')) { document.removeEventListener('click', closer); pop.remove(); } };
    document.addEventListener('click', closer);
  }, 50);
}

/* ---------- 下钻视图：总览图表点进去看明细 ---------- */
const DRILLS = {
  progress: {
    title: '进行中项目',
    sub: '设计中 / 生产中 / 安装中 / 异常',
    filter: (p) => ['设计中', '生产中', '安装中', '异常'].includes(p.project_status),
  },
  exc: {
    title: '异常项目',
    sub: '存在未解决异常的项目',
    filter: (p) => p.exception_status && p.exception_status !== '无异常',
  },
  month: {
    title: '本月交付项目',
    sub: '本月已完成实际交付的项目',
    filter: (p) => p.actual_delivery_date && String(p.actual_delivery_date).slice(0, 7) === new Date().toISOString().slice(0, 7),
  },
  delivered: {
    title: '已交付项目',
    sub: '全部已完成实际交付的项目',
    filter: (p) => !!p.actual_delivery_date,
  },
};
function safeDecode(s) { try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; } }
/* 解析下钻路由 → { key, title, sub, filter } */
function drillMeta(route) {
  const args = route.args || [];
  const key = args[0] || '';
  if (key === 'status') {
    const val = safeDecode(args[1] || '');
    return { key: key, title: '状态 · ' + val, sub: '当前状态为「' + val + '」的项目', filter: (p) => p.project_status === val };
  }
  const d = DRILLS[key];
  if (d) return { key: key, title: d.title, sub: d.sub, filter: d.filter };
  return { key: key, title: '未知视图', sub: '该视图不存在', filter: () => false };
}
/* 下钻明细页：左上角带返回键 */
function viewDrill(route) {
  const m = drillMeta(route);
  const list = S.db.projects.filter(m.filter).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const here = '#/drill/' + m.key + ((route.args || [])[1] ? '/' + route.args[1] : '');
  return '<div class="page-head">' +
    '<button class="btn back-btn" onclick="goBack()" title="返回上一页">' + ico('arrowLeft', 16) + '返回</button>' +
    '<div><div class="t">' + h(m.title) + '</div><div class="sub">' + h(m.sub) + ' · 共 ' + list.length + ' 个项目</div></div>' +
    '</div>' +
    '<div class="card">' + projTableHtml(list, here) + '</div>';
}

/* 可点击的统计卡（总览页用） */
function statCard(to, ic, bg, fg, val, label, extraStyle) {
  return '<div class="stat-card clickable" onclick="navTo(\'' + to + '\', \'#/dashboard\')" title="点击查看明细">' +
    icoBadge(ic, bg, fg) +
    '<div><div class="v"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' + val + '</div><div class="l">' + label + '</div></div>' +
    '<span class="go">' + ico('chevronRight', 16) + '</span></div>';
}

/* ---------- 首页总览 ---------- */
function viewDashboard() {
  const st = S.db.stats;
  const hour = new Date().getHours();
  const greet = hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

  // 状态分布图
  const colors = { '设计中': '#3b82f6', '生产中': '#f59e0b', '安装中': '#8b5cf6', '已完成': '#16a34a', '异常': '#dc2626', '未启动': '#94a3b8', '已终止': '#94a3b8' };
  const segs = Object.entries(st.statusDist).filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: k, value: v, color: colors[k] || '#94a3b8', link: '#/drill/status/' + esc(k) }));

  // 异常项目
  const exc = S.db.projects.filter((p) => p.exception_status !== '无异常');
  // 我的待办
  const todos = st.todos.slice(0, 8);
  // 近期交付
  const delivered = S.db.projects.filter((p) => p.actual_delivery_date).sort((a, b) => b.actual_delivery_date.localeCompare(a.actual_delivery_date)).slice(0, 6);
  const wangApprovals = S.me.id === 'demo-person-002' ? S.db.approvals.filter((a) => a.status === '管理层审批' && a.finance_paid === '已收齐' && !a.paused_by) : [];
  const waitingFinance = S.me.id === 'demo-person-002' ? S.db.approvals.filter((a) => a.status === '管理层审批' && a.finance_paid !== '已收齐' && !a.paused_by).length : 0;

  return '' +
    '<div class="hero"><div class="hi">' +
      '<div class="t">' + greet + '，' + h(S.me.name) + '！</div>' +
      '<div class="s">今天是 ' + new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) + ' · 您有 ' + st.todoCount + ' 项待办' + (st.exceptionCount ? ' · <b style="color:#fecaca">' + st.exceptionCount + ' 个异常项目</b>' : '') + '</div>' +
    '</div>' +
    (canNewProject() ? '<button class="btn-hero" onclick="openNewProject()"><span class="plus">' + ico('plus', 20) + '</span>新建项目</button>' : '') +
    '</div>' +

    '<div class="stat-grid">' +
      statCard('#/drill/progress', 'folder', 'var(--blue-l)', 'var(--blue)', st.inProgress, '进行中项目') +
      statCard('#/todo', 'clock', 'var(--amber-l)', 'var(--amber)', st.todoCount, '我的待办任务') +
      statCard('#/drill/exc', 'alert', 'var(--red-l)', 'var(--red)', st.exceptionCount, '异常项目', st.exceptionCount ? 'color:var(--red)' : '') +
      statCard('#/drill/month', 'package', 'var(--green-l)', 'var(--green)', st.monthDeliveries, '本月交付') +
    '</div>' +
    (S.me.id === 'demo-person-002' ? '<div class="card wang-approval-card"><h3>' + ico('checkSquare', 18) + '待审批任务 <span class="badge b-amber">' + wangApprovals.length + '</span><span class="more"><a onclick="nav(\'#/ship\')">全部审批 ›</a></span></h3>' +
      (wangApprovals.length ? wangApprovals.map((a) => { const p = projOf(a.project_id); return p ?
        '<div class="wang-approval-item" onclick="nav(\'#/project/' + p.id + '/ship\')"><strong class="project-number">' + h(p.project_no) + '</strong>' + projectAddressHtml(p) + '<span>确认发货条件 ›</span></div>' : ''; }).join('') : '<div class="hint">当前没有需要您确认的发货条件</div>') +
      (waitingFinance ? '<div class="hint">另有 ' + waitingFinance + ' 单等待财务确认尾款</div>' : '') + '</div>' : '') +

    '<div class="grid2">' +
      '<div class="card"><h3>' + ico('pie', 17) + '项目状态分布<span class="more"><a onclick="nav(\'#/projects\')">全部项目 ›</a></span></h3>' +
        '<div class="donut-wrap">' + donutChart(segs) + legendHtml(segs) + '</div>' +
        '<div class="hint-line">' + ico('target', 14) + '点击扇区或图例，查看该状态下的项目明细</div></div>' +
      '<div class="card"><h3>' + ico('checkSquare', 17) + '我的待办<span class="more"><a onclick="nav(\'#/todo\')">全部 ›</a></span></h3>' +
        (todos.length ? todos.map((t) => {
          const p = projOf(t.project_id);
          return '<div class="notif-item dashboard-todo" onclick="navTo(\'' + todoHref(t) + '\', \'#/dashboard\')">' +
            (p ? '<strong class="project-number">' + h(p.project_no) + '</strong><span>' + h(p.customer_name) + '</span>' + projectAddressHtml(p) : '<strong>' + h(t.text) + '</strong>') +
            '<div class="todo-stage">' + h(todoStage(t)) + '</div></div>';
        }).join('') : emptyBox('暂无待办，太棒了！', 'sparkle')) +
      '</div>' +
    '</div>' +

    '<div class="grid2" style="margin-top:16px">' +
      '<div class="card"><h3>' + ico('alert', 17) + '异常项目预警' + (exc.length ? ' <span class="badge b-red">' + exc.length + '</span>' : '') +
        '<span class="more"><a onclick="nav(\'#/drill/exc\')">查看全部 ›</a></span></h3>' +
        (exc.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>项目</th><th>客户</th><th>异常</th><th>状态</th></tr></thead><tbody>' +
          exc.map((p) => '<tr class="clickable" onclick="navTo(\'#/project/' + p.id + '/production\', \'#/dashboard\')"><td class="num"><strong class="project-number">' + h(p.project_no) + '</strong>' + projectAddressHtml(p) + '</td><td>' + h(p.customer_name) + '</td><td style="color:var(--red);max-width:260px">' + h((p.exception_desc || '').slice(0, 40)) + '</td><td>' + statusBadge(p.project_status) + '</td></tr>').join('') +
          '</tbody></table></div>' : emptyBox('当前没有异常项目', 'shield')) +
      '</div>' +
      '<div class="card"><h3>' + ico('truck', 17) + '近期交付项目<span class="more"><a onclick="nav(\'#/drill/delivered\')">查看全部 ›</a></span></h3>' +
        (delivered.length ? '<div class="timeline">' + delivered.map((p) =>
          '<div class="tl-item hot clickable" onclick="navTo(\'#/project/' + p.id + '\', \'#/dashboard\')"><div><b class="project-number">' + h(p.project_no) + '</b> ' + h(p.customer_name) + ' ' + typeBadge(p.project_type) + '</div>' + projectAddressHtml(p) + '<div class="tl-meta">交付日期：' + fmtDate(p.actual_delivery_date) + (p.expected_delivery_date && p.actual_delivery_date > p.expected_delivery_date ? ' · <span style="color:var(--red)">逾期</span>' : ' · <span style="color:var(--green)">准时</span>') + '</div></div>'
        ).join('') + '</div>' : emptyBox('暂无交付记录')) +
      '</div>' +
    '</div>';
}

/* ---------- 项目列表 ---------- */
function viewProjects() {
  return '<div class="page-head"><div><div class="t">项目列表</div><div class="sub">共 ' + S.db.projects.length + ' 个项目 · 合同总额 ' + money(S.db.stats.contractTotal) + '</div></div>' +
    (canNewProject() ? '<button class="btn-hero" onclick="openNewProject()"><span class="plus">' + ico('plus', 20) + '</span>新建项目</button>' : '') +
    '</div>' +
    '<div class="card">' +
    '<div class="filter-bar">' +
      '<input class="search-input" id="pf-q" placeholder="搜索项目编号 / 客户 / 地址">' +
      '<select id="pf-status"><option value="">全部状态</option>' + S.db.consts.PROJECT_STATUS.map((s) => '<option>' + s + '</option>').join('') + '</select>' +
      '<select id="pf-type"><option value="">全部类型</option>' + Object.keys(S.db.consts.PROJECT_TYPES).map((t) => '<option value="' + t + '">' + S.db.consts.PROJECT_TYPES[t] + '</option>').join('') + '</select>' +
      '<select id="pf-sales"><option value="">全部销售</option>' + S.db.users.filter((u) => u.roles.includes('sales')).map((u) => '<option value="' + u.id + '">' + h(u.name) + '</option>').join('') + '</select>' +
    '</div><div id="proj-table"></div></div>';
}
/* 项目表格：项目列表页与下钻明细页共用。backTo 存在时行点击会记录返回目标 */
function projTableHtml(list, backTo) {
  if (!list.length) return emptyBox('没有符合条件的项目');
  const go = (id) => backTo
    ? 'navTo(\'#/project/' + id + '\', \'' + backTo + '\')'
    : 'nav(\'#/project/' + id + '\')';
  return '<div class="table-wrap"><table class="table"><thead><tr><th>项目编号</th><th>客户</th><th>类型</th><th>销售</th><th>设计师</th><th class="num">合同金额</th><th>预计交付</th><th>状态</th><th>最新动态</th></tr></thead><tbody>' +
    list.map((p) => {
      const lg = S.db.logs.filter((l) => l.project_id === p.id).sort((a, b) => b.at.localeCompare(a.at))[0];
      return '<tr class="clickable" onclick="' + go(p.id) + '"><td class="num"><strong class="project-number">' + h(p.project_no) + '</strong></td><td><b>' + h(p.customer_name) + '</b>' + projectAddressHtml(p) + '</td><td>' + typeBadge(p.project_type) + '</td><td>' + h(userNameById(p.sales_id)) + '</td><td>' + h(p.designer_id ? userNameById(p.designer_id) : '待分配') + '</td><td class="num">' + (p.contract_amount ? money(p.contract_amount) : '—') + '</td><td>' + fmtDate(p.expected_delivery_date) + '</td><td>' + statusBadge(p.project_status) + (p.exception_status !== '无异常' ? ' <span class="badge b-red">异常</span>' : '') + '</td><td style="font-size:12px;color:var(--gray);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (lg ? h(lg.text) : '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function renderProjTable() {
  const q = ($('#pf-q') || {}).value || '';
  const fs = ($('#pf-status') || {}).value || '';
  const ft = ($('#pf-type') || {}).value || '';
  const fu = ($('#pf-sales') || {}).value || '';
  const list = S.db.projects.filter((p) =>
    (!q || (p.project_no + p.customer_name + p.address + p.customer_phone).includes(q)) &&
    (!fs || p.project_status === fs) && (!ft || p.project_type === ft) && (!fu || p.sales_id === fu)
  ).sort((a, b) => b.created_at.localeCompare(a.created_at));
  $('#proj-table').innerHTML = projTableHtml(list);
}

/* ---------- 新建项目弹窗 ----------
 * 字段口径严格按流程规格（spec.js 的 project.''）：必填 项目类型/客户姓名/联系电话/楼盘地址/来源渠道，
 * 选填 是否样板间/备注。合同金额与预计交付日期在设计的「客户最终确认」节点填写。 */
function openNewProject() {
  const cfb = cfBox('project', '', {});   // 项目总表的附加字段（管理员在「字段设置」里配）
  const mask = openModal(
    '<div class="mhead"><div class="t">' + ico('plus', 18) + '新建项目</div><button class="x">✕</button></div>' +
    '<div class="mbody"><div class="notice">项目创建后将<b>自动生成设计任务</b>；项目编号按「类型+年月+流水号」自动生成。' +
    '<br><b>成品 / 清仓</b>还会直接自动创建生产任务并指派油漆负责人。</div>' +
    nodeFormHtml('project', '', null) +
    (isA() ? '<div class="form-grid">' + fld('负责销售', userSel('sales_id', 'sales', S.me.id), 1) + '</div>' : '') +
    '<div class="full" id="np-cf">' + cfb.html + '</div>' +
    '</div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="np-save">创建项目</button></div>', true);

  mountNodeForm($('.mbody', mask));
  cfb.mount($('#np-cf', mask));

  $('#np-save', mask).onclick = async () => {
    const btn = $('#np-save', mask);
    const d = collectNodeForm($('.mbody', mask), 'project', '');
    d.custom = cfb.get();
    const sel2 = $('select[name=sales_id]', mask);
    if (sel2) d.sales_id = sel2.value;
    btn.disabled = true; btn.textContent = '创建中…';
    try {
      const r = await api('/api/projects', { method: 'POST', body: d });
      closeModal();
      await loadBootstrap();
      toast('项目 ' + r.project_no + ' 创建成功，已自动生成设计任务', 'ok');
      nav('#/project/' + r.id + '/design');
      render();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '创建项目'; }
  };
}

/* ---------- 我的待办 ---------- */
function todoHref(t) {
  if (!t.project_id || !projOf(t.project_id)) return t.type === 'aftersales' ? '#/aftersales/' + esc(t.id) : '#/projects';
  return '#/project/' + esc(t.project_id) + '/todo/' + esc(t.type) + '/' + esc(t.id);
}
function todoStage(t) {
  const text = String(t.text || '');
  const separator = text.indexOf('：');
  return separator < 0 ? text : text.slice(separator + 1);
}
function viewTodo() {
  const todos = S.db.stats.todos;
  const iconMap = { design: 'pen', production: 'factory', purchase: 'package', ship: 'truck', install: 'wrench', aftersales: 'support' };
  const typeMap = { design: '设计', production: '生产', purchase: '外购', ship: '出货', install: '安装', aftersales: '售后' };
  return '<div class="page-head"><div><div class="t">我的待办</div><div class="sub">共 ' + todos.length + ' 项需要您处理</div></div></div>' +
    '<div class="card todo-list">' + (todos.length ? todos.map((t) => {
      const p = projOf(t.project_id);
      return '<div class="todo-item clickable" role="link" tabindex="0" onclick="navTo(\'' + todoHref(t) + '\', \'#/todo\')" onkeydown="if(event.key===\'Enter\'){navTo(\'' + todoHref(t) + '\', \'#/todo\')}" ><div class="todo-icon">' + ico(iconMap[t.type] || 'clipboard', 22) + '</div>' +
        '<div class="todo-main"><div class="todo-kicker">' + h(typeMap[t.type] || '待办事项') + '待办</div>' +
        (p ? '<div class="todo-identity"><strong class="project-number">' + h(p.project_no) + '</strong><span>' + h(p.customer_name) + '</span></div>' + projectAddressHtml(p) : '<div class="todo-identity"><strong>' + h(t.text) + '</strong></div>') +
        '<div class="todo-stage">' + h(todoStage(t)) + '</div></div>' +
        '<button class="btn primary todo-action" onclick="event.stopPropagation();navTo(\'' + todoHref(t) + '\', \'#/todo\')">去处理 ' + ico('chevronRight', 16) + '</button></div>';
    }).join('') : emptyBox('暂无待办事项，一切顺利！', 'sparkle')) + '</div>';
}
function viewSimpleDashboard() {
  return '<div class="simple-greeting"><h2>' + h(S.me.name) + '，您好</h2><p>您有 <strong>' + S.db.stats.todoCount + '</strong> 项待处理</p></div>' + viewTodo();
}
