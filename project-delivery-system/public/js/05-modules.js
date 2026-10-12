/* ============ 05 模块视图：设计 / 生产 / 出货 / 安装 / 售后 ============ */
'use strict';

/* ---------- 设计任务中心 ---------- */
function viewDesign() {
  const C = S.db.consts;
  const tasks = S.db.design.filter((t) => {
    const p = projOf(t.project_id); return p && !t.terminated;
  });
  const cards = tasks.map((t) => {
    const p = projOf(t.project_id);
    return {
      status: t.status === '设计完成' ? '设计完成' : t.status,
      html: '<div class="kcard" onclick="nav(\'#/project/' + p.id + '/design\')">' +
        '<div class="no"><strong class="project-number">' + h(p.project_no) + '</strong> · ' + h(t.task_no) + '</div>' +
        '<div class="nm">' + h(p.customer_name) + '</div>' +
        projectAddressHtml(p) +
        '<div class="meta">' + typeBadge(p.project_type) + '</div>' +
        '<div class="foot"><span>' + ico('pen', 13) + ' ' + h(t.designer_id ? userNameById(t.designer_id) : '待分配') + '</span><span>' + fmtDate(p.expected_delivery_date) + '</span></div></div>',
    };
  });
  const todo = tasks.filter((t) => t.status !== '设计完成').length;
  return '<div class="page-head"><div><div class="t">设计任务中心</div><div class="sub">待完成设计任务 ' + todo + ' 个 · 点击卡片进入任务详情操作节点</div></div>' +
    '<button class="btn" onclick="toggleView(\'design-list\')">' + ico('swap', 15) + ' 切换列表视图</button></div>' +
    '<div id="design-board">' + (cards.length ? kanban(C.DESIGN_STAGES, cards) : emptyBox('暂无设计任务')) + '</div>' +
    '<div id="design-list" style="display:none"><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>任务编号</th><th>项目</th><th>客户</th><th>设计师</th><th>当前节点</th><th>销售</th></tr></thead><tbody>' +
    tasks.map((t) => { const p = projOf(t.project_id); return '<tr class="clickable" onclick="nav(\'#/project/' + p.id + '/design\')"><td class="num">' + h(t.task_no) + '</td><td class="num"><strong class="project-number">' + h(p.project_no) + '</strong></td><td>' + h(p.customer_name) + projectAddressHtml(p) + '</td><td>' + h(t.designer_id ? userNameById(t.designer_id) : '待分配') + '</td><td><span class="badge b-blue">' + h(t.status) + '</span></td><td>' + h(userNameById(p.sales_id)) + '</td></tr>'; }).join('') +
    '</tbody></table></div></div></div>';
}

/* ---------- 生产看板 ---------- */
function viewProduction() {
  const C = S.db.consts;
  const tasks = S.db.production.filter((t) => projOf(t.project_id) && t.status !== '已终止');
  const cards = tasks.map((t) => {
    const p = projOf(t.project_id);
    return {
      status: t.status,
      html: '<div class="kcard" onclick="nav(\'#/project/' + p.id + '/production\')">' +
        '<div class="no"><strong class="project-number">' + h(p.project_no) + '</strong> · ' + h(t.task_no) + '</div>' +
        '<div class="nm">' + h(p.customer_name) + (t.is_exception ? ' <span class="badge b-red">异常</span>' : '') + '</div>' +
        projectAddressHtml(p) +
        '<div class="meta">' + typeBadge(p.project_type) + '</div>' +
        '<div class="foot"><span>' + ico('calendar', 13) + ' 预计 ' + fmtDate(p.expected_delivery_date) + '</span></div></div>',
    };
  });
  const excCount = tasks.filter((t) => t.is_exception).length;
  return '<div class="page-head"><div><div class="t">生产看板</div><div class="sub">生产中任务 ' + tasks.filter((t) => !['出货完成', '已终止'].includes(t.status)).length + ' 个' + (excCount ? ' · <span style="color:var(--red)">异常 ' + excCount + ' 个</span>' : '') + '</div></div></div>' +
    (cards.length ? kanban(C.PROD_STAGES, cards) : emptyBox('暂无生产任务'));
}

/* ---------- 出货审批中心 ---------- */
function viewShip() {
  const list = S.db.approvals.filter((a) => a.status !== '已终止').slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups = [['待发起', '待发起'], ['已驳回', '已驳回'], ['审批中', '管理层审批'], ['审批中', '待确认发货时间'], ['审批中', '待约定发货时间'], ['审批中', '待发货'], ['审批中', '待确认到货'], ['已完成', '已完成']];
  const smap = { '待发起': 'b-amber', '已驳回': 'b-red', '管理层审批': 'b-blue', '待确认发货时间': 'b-amber', '待约定发货时间': 'b-amber', '待发货': 'b-blue', '待确认到货': 'b-amber', '已完成': 'b-green', '已终止': 'b-gray' };
  return '<div class="page-head"><div><div class="t">出货审批中心</div><div class="sub">审批操作与飞书审批联动（预留接口），系统内完成状态追踪</div></div></div>' +
    (list.length ? '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>项目</th><th>客户</th><th>审批状态</th><th>最快发货</th><th>约定发货</th><th>实际发货</th><th>发起时间</th><th>操作</th></tr></thead><tbody>' +
    list.map((a) => {
      const p = projOf(a.project_id);
      return '<tr class="clickable" onclick="nav(\'#/project/' + a.project_id + '/ship\')"><td class="num"><strong class="project-number">' + h(p.project_no) + '</strong></td><td>' + h(p.customer_name) + projectAddressHtml(p) + '</td><td><span class="badge ' + (smap[a.status] || 'b-gray') + '">' + h(a.status) + '</span>' + (a.is_multi_batch ? ' <span class="badge b-purple">多批次</span>' : '') + '</td><td>' + fmtDate(a.fastest_ship_date) + '</td><td>' + fmtDate(a.agreed_ship_date) + '</td><td>' + fmtDate(a.actual_ship_date) + '</td><td>' + fmtDT(a.created_at).slice(0, 10) + '</td><td><button class="btn sm primary">' + ico('play', 14) + ' 查看 / 处理</button></td></tr>';
    }).join('') + '</tbody></table></div></div>' : emptyBox('暂无出货审批单'));
}

/* ---------- 安装管理 ---------- */
function viewInstall() {
  const C = S.db.consts;
  const tasks = S.db.installations.filter((t) => projOf(t.project_id) && !t.terminated);
  const cards = tasks.map((t) => {
    const p = projOf(t.project_id);
    return {
      status: t.status,
      html: '<div class="kcard" onclick="nav(\'#/project/' + p.id + '/install\')">' +
        '<div class="no"><strong class="project-number">' + h(p.project_no) + '</strong> · ' + h(t.task_no) + '</div>' +
        '<div class="nm">' + h(p.customer_name) + (t.is_exception ? ' <span class="badge b-red">异常</span>' : '') + '</div>' +
        projectAddressHtml(p) +
        '<div class="foot"><span>' + ico('wrench', 13) + ' ' + h(t.installer_name || '待派单') + '</span><span>' + fmtDate(t.confirm_install_date) + '</span></div></div>',
    };
  });
  return '<div class="page-head"><div><div class="t">安装管理</div><div class="sub">待派单 → 派单 → 确认日期 → 安装 → 验收 → 客户确认 · 成都/经销商/外接单自动过滤</div></div></div>' +
    (cards.length ? kanban(C.INSTALL_STAGES, cards) : emptyBox('暂无安装任务'));
}

/* ---------- 售后服务中心 ---------- */
function viewAfterSales(focusId) {
  if (focusId) {
    const t = S.db.aftersales.find(item => item.id === focusId);
    if (!t) return '<div class="card"><div class="notice">这项售后待办已完成，或当前不再由您处理。</div></div>';
    return '<div class="page-head"><div><div class="t">处理售后工单 · ' + h(t.ticket_no) + '</div><div class="sub">' + h(t.status) + '</div></div></div>' +
      '<div class="card"><h3>' + h(t.customer_name) + '</h3><div>问题：' + h(t.problem_desc) + '</div>' +
      (t.address ? '<div class="project-address">' + ico('pin', 13) + '<span>' + h(t.address) + '</span></div>' : '') +
      '<div id="as-btns-' + h(t.id) + '" style="margin-top:16px"></div></div>';
  }
  const list = S.db.aftersales.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const canCreate = isA() || hasRole('sales') || hasRole('install');
  const smap = { '待派工': 'b-amber', '待执行': 'b-amber', '执行中': 'b-blue', '已完成': 'b-blue', '已完结': 'b-green', '已结束': 'b-green', '已终止': 'b-gray' };
  return '<div class="page-head"><div><div class="t">售后服务中心</div><div class="sub">工单编号规则：YGX + 年月 + 3位流水号 + -SH</div></div>' +
    (canCreate ? '<button class="btn primary" onclick="openAfterSalesGlobal()">' + ico('plus', 16) + ' 新建售后工单</button>' : '') + '</div>' +
    (list.length ? '<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>工单号</th><th>客户</th><th>问题描述</th><th>状态</th><th>派工</th><th>申报时间</th><th>评分</th><th></th></tr></thead><tbody>' +
    list.map((t) => { const p = projOf(t.project_id); return '<tr><td class="num">' + h(t.ticket_no) + '</td><td>' + (p ? '<strong class="project-number">' + h(p.project_no) + '</strong><br>' : '') + h(t.customer_name) + (p ? projectAddressHtml(p) : (t.address ? '<div class="project-address">' + ico('pin', 13) + '<span>' + h(t.address) + '</span></div>' : '')) + '</td><td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + h(t.problem_desc) + '">' + h(t.problem_desc) + '</td><td><span class="badge ' + (smap[t.status] || 'b-gray') + '">' + h(t.status) + '</span></td><td>' + h(t.assignee_name || '—') + '</td><td>' + fmtDate(t.apply_date) + '</td><td>' + (t.customer_rating ? starsHtml(t.customer_rating) : '—') + '</td><td>' + (t.project_id ? '<button class="btn sm" onclick="nav(\'#/project/' + t.project_id + '/aftersales\')">详情</button>' : '') + '</td></tr>'; }).join('') +
    '</tbody></table></div></div>' : emptyBox('暂无售后工单'));
}
function openAfterSalesGlobal() {
  const projs = S.db.projects.map((p) => ({ v: p.id, t: p.project_no + ' · ' + (p.address || '地址待补充') + ' · ' + p.customer_name }));
  const mask = openModal('<div class="mhead"><div class="t">' + ico('plus', 18) + '新建售后工单</div><button class="x">✕</button></div>' +
    '<div class="mbody"><div class="form-grid">' +
    fld('关联项目（可选）', sel('project_id', [{ v: '', t: '不关联项目' }].concat(projs))) +
    fld('客户姓名', inp('customer_name'), 1) +
    fld('联系电话', inp('customer_phone', 'tel'), 1) +
    fld('详细住址', inp('address'), 1, 1) +
    fld('问题描述', '<textarea name="problem_desc"></textarea>', 1, 1) +
    fld('预计完成时间', inp('expected_finish_date', 'date')) +
    '</div></div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="asg-create">创建工单</button></div>');
  $('select[name=project_id]', mask).onchange = (e) => {
    const p = projOf(e.target.value);
    if (p) {
      $('input[name=customer_name]', mask).value = p.customer_name;
      $('input[name=customer_phone]', mask).value = p.customer_phone;
      $('input[name=address]', mask).value = p.address;
    }
  };
  $('#asg-create', mask).onclick = async () => {
    try { const r = await api('/api/aftersales', { method: 'POST', body: formData($('.mbody', mask)) }); closeModal(); await loadBootstrap(); render(); toast('工单 ' + r.ticket_no + ' 已创建', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
}
