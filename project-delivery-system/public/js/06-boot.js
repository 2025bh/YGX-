/* ============ 06 报表 / 我的 / 渲染入口 ============ */
'use strict';

/* ---------- 数据报表 ---------- */
function viewReports() {
  const st = S.db.stats;
  const C = S.db.consts;
  const isAdmin = isA();
  let html = '<div class="page-head"><div><div class="t">数据报表</div><div class="sub">' + (isAdmin ? '全局视角（管理层）' : '个人视角 · 仅统计您权限范围内的数据') + '</div></div></div>';

  // 关键指标
  html += '<div class="stat-grid">' +
    '<div class="stat-card">' + icoBadge('folder', 'var(--blue-l)', 'var(--blue)') + '<div><div class="v">' + st.projTotal + '</div><div class="l">项目总数</div></div></div>' +
    '<div class="stat-card">' + icoBadge('target', 'var(--green-l)', 'var(--green)') + '<div><div class="v">' + (st.onTimeRate === null ? '—' : st.onTimeRate + '%') + '</div><div class="l">交付准时率</div></div></div>' +
    '<div class="stat-card">' + icoBadge('star', 'var(--amber-l)', 'var(--amber)') + '<div><div class="v">' + (st.avgInstallRating === null ? '—' : st.avgInstallRating) + '</div><div class="l">安装平均评分</div></div></div>' +
    '<div class="stat-card">' + icoBadge('yuan', 'var(--purple-l,#ede9fe)', '#7c3aed') + '<div><div class="v" style="font-size:20px;padding-top:4px">' + money(st.contractTotal) + '</div><div class="l">合同总额</div></div></div>' +
  '</div>';

  // 阶段漏斗
  const funnel = [
    ['设计中', S.db.design.filter((t) => t.status !== '设计完成' && !t.terminated).length],
    ['生产中', S.db.production.filter((t) => !['出货完成', '已终止'].includes(t.status)).length],
    ['出货审批中', S.db.approvals.filter((a) => !['已完成', '已终止'].includes(a.status)).length],
    ['安装中', S.db.installations.filter((t) => t.status !== '安装完成' && !t.terminated).length],
    ['已完成交付', S.db.projects.filter((p) => p.project_status === '已完成').length],
  ];
  const maxF = Math.max.apply(null, funnel.map((f) => f[1]).concat([1]));
  const statusColors = { '设计中': '#3b82f6', '生产中': '#f59e0b', '安装中': '#8b5cf6', '已完成': '#16a34a', '异常': '#dc2626', '未启动': '#94a3b8', '已终止': '#94a3b8' };
  const segs = Object.entries(st.statusDist).filter(([, v]) => v > 0).map(([k, v]) => ({ label: k, value: v, color: statusColors[k] || '#94a3b8' }));
  html += '<div class="grid2">' +
    '<div class="card"><h3>' + ico('funnel', 17) + '项目进度漏斗</h3>' + funnel.map((f) => hbar(f[0], f[1], maxF)).join('') + '</div>' +
    '<div class="card"><h3>' + ico('pie', 17) + '项目状态分布</h3><div class="donut-wrap">' + donutChart(segs) + legendHtml(segs) + '</div></div>' +
  '</div>';

  // 工作量
  const wlLabel = { sales: '销售组', designer: '设计组', production: '生产组', install: '安装/售后组' };
  html += '<div class="grid2" style="margin-top:16px">' +
    '<div class="card"><h3>' + ico('users', 17) + '各组在办工作量</h3>' +
    Object.keys(wlLabel).filter((r) => isAdmin || ['sales', 'designer'].includes(r)).map((r) =>
      '<div style="font-size:13px;color:var(--gray);margin:8px 0 4px">' + wlLabel[r] + '</div>' +
      (st.workload[r] || []).map((w) => hbar(w.name, w.active, Math.max.apply(null, (st.workload[r] || []).map((x) => x.active).concat([1])))).join('')
    ).join('') + '</div>' +
    '<div class="card"><h3>' + ico('factory', 17) + '生产各工序分布</h3>' +
    Object.entries(st.prodDist).filter(([, v]) => v > 0).map(([k, v]) => hbar(k, v, Math.max.apply(null, Object.values(st.prodDist).concat([1])), '#f59e0b')).join('') +
    '<div style="margin-top:14px;font-size:13px;color:var(--gray)">设计节点分布</div>' +
    Object.entries(st.designDist).filter(([, v]) => v > 0).map(([k, v]) => hbar(k, v, Math.max.apply(null, Object.values(st.designDist).concat([1])), '#3b82f6')).join('') +
    '</div>' +
  '</div>';
  return html;
}

/* ---------- 我的 ---------- */
function viewMy() {
  const st = S.db.stats;
  const pm = myPerms();
  const mine = S.db.projects.filter((p) => pm.scope === 'all' || (hasCap('sales') && p.sales_id === S.me.id));
  const done = mine.filter((p) => p.project_status === '已完成').length;
  let html = '<div class="page-head"><div><div class="t">我的</div><div class="sub">' + h(S.me.name) + ' · ' + h(rolesLabel(S.me.roles)) + (S.me.title ? ' · ' + h(S.me.title) : '') + '</div></div>' +
    '<button class="btn account-switch" type="button" onclick="doLogout()">' + ico('swap', 16) + ' 更换账号</button></div>';
  html += '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="stat-card">' + icoBadge('folder', 'var(--blue-l)', 'var(--blue)') + '<div><div class="v">' + mine.length + '</div><div class="l">' + (pm.scope === 'all' ? '可见项目' : '我的项目') + '</div></div></div>' +
    '<div class="stat-card">' + icoBadge('checkCircle', 'var(--green-l)', 'var(--green)') + '<div><div class="v">' + done + '</div><div class="l">已完成</div></div></div>' +
    '<div class="stat-card">' + icoBadge('clock', 'var(--amber-l)', 'var(--amber)') + '<div><div class="v">' + st.todoCount + '</div><div class="l">待办任务</div></div></div>' +
  '</div>';

  /* 我的权限一目了然 */
  html += '<div class="card"><h3>' + ico('shield', 17) + '我的权限</h3>' +
    '<div class="my-perm-row"><span class="k">数据可见范围</span><span class="v">' + h(scopeLabel(pm.scope)) + '</span></div>' +
    '<div class="my-perm-row"><span class="k">可访问页面</span><span class="v">' + ((pm.pages || []).length ? h((pm.pages || []).map(pageLabel).join('、')) : '无') + '</span></div>' +
    '<div class="my-perm-row"><span class="k">关键权限</span><span class="v">' + ((pm.actions || []).length ? h((pm.actions || []).map(actionLabel).join('、')) : '—') + '</span></div>' +
    '<div class="hint">权限由管理员在「员工管理」里设置，如有需要请找演示审批主管或演示老板调整。</div></div>';

  html += '<div class="card"><h3>' + ico('key', 17) + '修改密码</h3><div class="form-grid" style="max-width:520px">' +
    fld('原密码', '<input type="password" id="pw-old">', 1) +
    fld('新密码（至少6位）', '<input type="password" id="pw-new">', 1) +
    '</div><button class="btn primary" style="margin-top:14px" id="pw-save">保存新密码</button></div>';

  html += '<div class="card"><h3>' + ico('book', 17) + '使用说明</h3><div style="font-size:13.5px;line-height:2;color:var(--ink-2)">' +
    '1. 销售在「新建项目」录入客户成交信息，系统自动生成设计任务并自动编号（类型+年月+流水号）<br>' +
    '2. 设计阶段 10 个节点依次流转，「转接生产」后自动创建生产任务，禁止跳过<br>' +
    '3. 生产打包完成后系统自动通知销售发起出货审批（5 步审批流：发起 → 管理层 → 最快发货时间 → 约定时间 → 发货到货）<br>' +
    '4. 只有「定制」项目可能走安装；成品 / 板式 / 外接 / 清仓一律不走安装<br>' +
    '5. 权限：每位员工能看哪些页面、能看到谁的数据，都在「员工管理」里逐项设置<br>' +
    '6. 手机端文本输入框支持「语音输入」，说完还能点「AI 整理」自动填进对应字段<br>' +
    '7. 异常报备只能追加不能覆盖；通知中心的消息后续将对接飞书消息推送（配置见系统设置）' +
    '</div></div>';

  if (isA()) {
    const c = S.db.config || {};
    html += '<div class="card"><h3>' + ico('settings', 17) + '系统设置 · 飞书应用对接</h3>' +
      '<div class="notice">App ID / App Secret 用于让系统代表企业自建应用去调飞书接口（消息推送、出货审批）。App Secret 属于密钥，请勿外传。</div>' +
      '<div class="form-grid" style="max-width:640px">' +
      fld('飞书应用 ID（App ID）', '<input id="fs-id" value="' + h(c.feishu_app_id || '') + '" placeholder="cli_xxxxxxxxxxxxxxxx">') +
      fld('飞书应用密钥（App Secret）', '<input id="fs-secret" type="password" value="' + h(c.feishu_app_secret || '') + '">') +
      fld('出货审批流程编号（definitionCode）', '<input id="fs-code" value="' + h(c.approval_code || '') + '" placeholder="审批后台地址栏 definitionCode= 后面那段">', 0, 0, '在飞书审批后台打开「出货申请」审批 → 地址栏 definitionCode= 后面那串') +
      '</div><button class="btn primary" style="margin-top:14px" id="fs-save">保存飞书配置</button></div>';

    html += '<div class="card"><h3>' + ico('bot', 17) + '系统设置 · 大模型（语音转文字后自动识别填入）</h3>' +
      '<div class="notice">填任意「OpenAI 兼容」的大模型服务即可，例如 DeepSeek、通义千问、Kimi、智谱等。开启后，手机端文本域旁会出现「语音输入 / AI 整理」按钮。</div>' +
      '<div class="form-grid" style="max-width:640px">' +
      fld('大模型接口地址', '<input id="lm-url" value="' + h(c.llm_base_url || '') + '" placeholder="https://api.deepseek.com/v1">') +
      fld('大模型 API 密钥（API Key）', '<input id="lm-key" type="password" value="' + h(c.llm_api_key || '') + '">') +
      fld('大模型名称（模型名）', '<input id="lm-model" value="' + h(c.llm_model || '') + '" placeholder="deepseek-chat">') +
      fld('是否启用', '<label class="checkline"><input type="checkbox" id="lm-on"' + (c.llm_enabled ? ' checked' : '') + '> 启用大模型辅助录入</label>') +
      '</div><div style="margin-top:14px;display:flex;gap:10px">' +
      '<button class="btn primary" id="lm-save">保存大模型配置</button>' +
      '<button class="btn" id="lm-test">' + ico('bolt', 15) + ' 测试连接</button>' +
      '</div></div>';
  }
  return html;
}
function bindMy() {
  const pw = $('#pw-save');
  if (pw) pw.onclick = async () => {
    try { await api('/api/me/password', { method: 'POST', body: { old: $('#pw-old').value, newP: $('#pw-new').value } }); toast('密码已修改', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const fs = $('#fs-save');
  if (fs) fs.onclick = async () => {
    try {
      await api('/api/config', { method: 'POST', body: { feishu_app_id: $('#fs-id').value, feishu_app_secret: $('#fs-secret').value, approval_code: $('#fs-code').value } });
      await loadBootstrap(); render(); toast('飞书配置已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const lm = $('#lm-save');
  if (lm) lm.onclick = async () => {
    try {
      await api('/api/config', { method: 'POST', body: { llm_base_url: $('#lm-url').value, llm_api_key: $('#lm-key').value, llm_model: $('#lm-model').value, llm_enabled: $('#lm-on').checked } });
      await loadBootstrap(); render(); toast('大模型配置已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const lt = $('#lm-test');
  if (lt) lt.onclick = async () => {
    const old = lt.innerHTML;
    lt.disabled = true; lt.innerHTML = ico('clock', 15) + ' 测试中…';
    try {
      await api('/api/config', { method: 'POST', body: { llm_base_url: $('#lm-url').value, llm_api_key: $('#lm-key').value, llm_model: $('#lm-model').value, llm_enabled: true } });
      const r = await api('/api/llm/test', { method: 'POST', body: {} });
      toast('连接成功，模型回复：' + r.reply, 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { lt.disabled = false; lt.innerHTML = old; }
  };
}

/* ---------- 视图切换辅助 ---------- */
function toggleView(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

/* ---------- 数据加载与渲染 ---------- */
async function loadBootstrap() {
  const data = await api('/api/bootstrap');
  S.me = data.me; S.db = data;
  S.simpleMode = ['demo-person-015', 'demo-person-017'].includes(S.me.id) && sessionStorage.getItem('ygx-page-mode:' + S.me.id) !== 'full';
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content = S.me.allow_zoom
    ? 'width=device-width, initial-scale=1, viewport-fit=cover'
    : 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.documentElement.classList.toggle('zoom-locked', !S.me.allow_zoom);
}

let rendering = false;
async function render() {
  if (rendering) return; rendering = true;
  try {
    const app = $('#app');
    if (!S.me || !S.db) { renderLogin(); rendering = false; return; }
    const route = parseRoute();

    // 详情页自己渲染外壳
    if (route.name === 'project') {
      try { await viewProject(route); }
      catch (e) {
        console.error('项目详情渲染失败', e);
        renderShell(route, '<div class="card">' + emptyBox('项目详情加载失败：' + e.message, 'alert') + '</div>');
      }
      rendering = false; return;
    }

    let html = '';
    try {
      switch (route.name) {
        case 'dashboard': html = S.simpleMode ? viewSimpleDashboard() : viewDashboard(); break;
        case 'projects': html = viewProjects(); break;
        case 'design': html = viewDesign(); break;
        case 'production': html = viewProduction(); break;
        case 'ship': html = viewShip(); break;
        case 'install': html = viewInstall(); break;
        case 'aftersales': html = viewAfterSales(route.args[0]); break;
        case 'reports': html = viewReports(); break;
        case 'todo': html = viewTodo(); break;
        case 'drill': html = viewDrill(route); break;
        case 'my': html = viewMy(); break;
        case 'staff': html = canStaff() ? viewStaff() : '<div class="card">' + emptyBox('您没有员工管理权限，请联系管理员', 'lock') + '</div>'; break;
        case 'fields': html = canStaff() ? viewFields() : '<div class="card">' + emptyBox('您没有字段设置权限，请联系管理员', 'lock') + '</div>'; break;
        default: html = viewDashboard();
      }
    } catch (e) {
      // 单个页面出错不影响整体：外壳仍然渲染，导航可继续使用
      console.error('页面渲染失败', e);
      html = '<div class="card">' + emptyBox('该页面加载失败：' + e.message + '（其他菜单仍可正常使用）', 'alert') + '</div>';
    }
    renderShell(route, html);
    if (route.name === 'projects') {
      renderProjTable();
      ['#pf-q', '#pf-status', '#pf-type', '#pf-sales'].forEach((s) => { const el = $(s); if (el) el.oninput = renderProjTable; });
    }
    if (route.name === 'my') bindMy();
    if (route.name === 'aftersales' && route.args[0]) bindAftersales();
    window.scrollTo(0, 0);
  } catch (e) {
    if (S.me) $('#app').innerHTML = '<div class="content"><div class="card">' + emptyBox('加载失败：' + e.message, 'alert') + '</div></div>';
  }
  rendering = false;
}

/* ---------- 启动 ---------- */
window.addEventListener('hashchange', render);
setInterval(() => { if (!document.hidden) refreshNotifications(); }, 15000);
window.addEventListener('focus', refreshNotifications);
window.addEventListener('online', refreshNotifications);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNotifications(); });
(async function boot() {
  try { await loadBootstrap(); } catch (e) { /* 未登录 */ }
  render();
})();
