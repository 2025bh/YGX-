/* ============ 04 项目详情：全流程节点操作 ============ */
'use strict';

const PROJ_TABS = [
  ['overview', 'clipboard', '概览'], ['design', 'pen', '设计阶段'], ['production', 'factory', '生产阶段'],
  ['ship', 'truck', '出货审批'], ['install', 'wrench', '安装阶段'], ['aftersales', 'support', '售后服务'], ['logs', 'activity', '操作动态'],
];

async function viewProject(route) {
  const id = route.args[0];
  const tab = route.args[1] || 'overview';
  const todoType = tab === 'todo' ? route.args[2] : tab === 'purchase' ? 'purchase' : '';
  const todoId = tab === 'todo' ? route.args[3] : '';
  CF_PANELS.length = 0; // 每次进详情页重置「附加字段」面板登记（避免上一次渲染残留）
  try {
    S.detail = await api('/api/projects/' + esc(id));
  } catch (e) { return '<div class="card">' + emptyBox(e.message, 'lock') + '</div>'; }
  const p = S.detail.project;
  const todoItem = todoType ? (S.db.stats.todos || []).find(t => t.project_id === p.id && t.type === todoType && (!todoId || t.id === todoId)) : null;

  const canTerminateNow = (isA() || canAct('project_terminate')) && !['已完成', '已终止'].includes(p.project_status);
  let html = '<div class="ph-toolbar"><button class="btn back-btn" onclick="goBack()" title="返回上一页">' + ico('arrowLeft', 16) + '返回</button>' +
    (canTerminateNow ? '<button class="btn danger" style="margin-left:auto" onclick="openTerminate()">' + ico('alert', 15) + ' 终止项目</button>' : '') +
    '</div>' + projHeadHtml(p);
  if (p.project_status === '已终止') html += '<div class="notice" style="background:var(--red-l);border-color:#fecaca;color:#b91c1c">' + ico('alert', 16) +
    '<b>项目已终止</b>（原状态：' + h(p.terminate_from || '—') + '）· 原因：' + h(p.terminate_reason || '—') +
    '<div style="margin-top:4px;font-size:12.5px">终止人：' + h(p.terminated_by || '—') + ' · ' + h(p.terminated_at ? fmtDT(p.terminated_at) : '—') + '</div></div>';
  if (todoType) {
    html += '<div class="ph-toolbar"><b>' + (todoItem ? h(todoStage(todoItem)) : '待办状态已变化') + '</b><button class="btn" onclick="nav(\'#/project/' + p.id + '/overview\')">查看完整项目</button></div>';
    if (!todoItem) html += '<div class="card"><div class="notice">这项待办已完成，或当前不再由您处理。返回待办列表可查看最新事项。</div></div>';
    else if (todoType === 'design') html += tabDesign();
    else if (todoType === 'production') html += tabProduction();
    else if (todoType === 'purchase') html += tabPurchaseTodo();
    else if (todoType === 'ship') { SHIP_SEL = todoItem.id; html += tabShip(); }
    else if (todoType === 'install') html += tabInstall();
    else if (todoType === 'aftersales') html += tabAftersales(todoItem.id);
  } else {
    html += '<div class="tabs">' + PROJ_TABS.map((t) => {
      return '<div class="tab' + (tab === t[0] ? ' active' : '') + '" onclick="nav(\'#/project/' + p.id + '/' + t[0] + '\')">' + t[2] + '</div>';
    }).join('') + '</div>';
    if (tab === 'overview') html += tabOverview();
    else if (tab === 'design') html += tabDesign();
    else if (tab === 'production') html += tabProduction();
    else if (tab === 'ship') html += tabShip();
    else if (tab === 'install') html += tabInstall();
    else if (tab === 'aftersales') html += tabAftersales();
    else html += tabLogs();
  }

  renderShell(route, html);
  mountDesignReminder($('#design-reminder-bar'), S.detail.design?.status);
  if (!todoType || todoItem) bindProjectTab(todoType || tab);
  if (todoItem) {
    const selector = { design: '#design-action', production: '#prod-action', purchase: '#prod-purchase-action', ship: '#ship-action', install: '#install-action', aftersales: '#as-btns-' + todoItem.id }[todoType];
    requestAnimationFrame(() => { if (selector) $(selector)?.scrollIntoView({ block: 'start' }); });
  }
  if (S.focusPurchaseOnRender && tab === 'production') {
    S.focusPurchaseOnRender = false;
    requestAnimationFrame(() => $('#prod-purchase-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
  $$('[data-node-stage]').forEach(button => {
    button.onclick = () => openNodeDetails(button.dataset.nodeScope, button.dataset.nodeStage);
  });
  const toolbar = document.querySelector('.ph-toolbar');
  if (toolbar && isA()) {
    const button = document.createElement('button'); button.className = 'btn'; button.textContent = '核对并恢复下游';
    button.onclick = async () => {
      const reason = prompt('请填写重新核对依据。未完成的出货审批将需要重新发起。');
      if (!reason?.trim()) return;
      button.disabled = true;
      try { await api('/api/projects/' + p.id + '/resume-downstream', { method: 'POST', body: { reason } }); await refreshAfterAction(); }
      catch(e) { toast(e.message, 'err'); button.disabled = false; }
    };
    toolbar.appendChild(button);
  }
  return null; // 已直接渲染
}

function readOnlyNodeValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'file') return fileLink(value, '查看' + field.label);
  if (field.type === 'user') return h(userNameById(value));
  if (field.type === 'users') return h((Array.isArray(value) ? value : String(value).split(',')).map(userNameById).join('、'));
  if (field.type === 'multiselect') return h((Array.isArray(value) ? value : []).join('、'));
  if (field.type === 'checkbox') return value ? '是' : '否';
  if (field.type === 'date') return h(fmtDate(value));
  if (field.type === 'money') return h(money(value));
  return h(value);
}

function openNodeDetails(scope, stage) {
  const record = S.detail?.[scope];
  const project = S.detail?.project;
  if (!record || !project) return;
  const stages = scope === 'design' ? designStageList(project.project_type) :
    scope === 'production' ? prodStageList(project.project_type) : installStageList();
  if (!stages.includes(stage)) return;
  const saved = record.node_values?.[stage];
  const current = record.status === stage;
  const reached = stages.indexOf(stage) <= stages.indexOf(record.status) || !!saved;
  const fields = nodeFields(scope, stage).concat(cfAll().filter(f => f.scope === scope && f.stage === stage && (f.active !== false || record.custom?.[f.key] !== undefined)));
  const restricted = scope === 'design' && !S.detail.can_view_final_quotation;
  const items = fields.map(field => {
    const privateQuote = restricted && (field.key === 'quotation' || field.label === '最终报价表');
    const uniqueNativeField = !!field.col && stages.filter(name => nodeFields(scope, name).some(item => item.key === field.key)).length === 1;
    const value = saved && Object.prototype.hasOwnProperty.call(saved, field.key) ? saved[field.key] :
      !field.col ? record.custom?.[field.key] : current || (reached && uniqueNativeField) ? record[field.col] : undefined;
    return '<div><div class="k">' + h(field.label) + '</div><div class="v">' +
      (privateQuote ? '仅项目负责销售和管理员可见' : readOnlyNodeValue(field, value)) + '</div></div>';
  });
  const oldFiles = (record.file_history || []).filter(item => item.stage === stage)
    .map(item => '<div>' + h(item.field) + '：' + fileLink(item.file_id, '查看旧版') + '</div>');
  const parallelPurchase = scope === 'production' && stage === '外购入库' && purchaseVisible(project, record);
  const purchaseDone = record.parallel_purchase ? !!record.purchase_completed_at : ['不需要', '已入库'].includes(record.purchase_order_status);
  const status = parallelPurchase ? (purchaseDone ? '并行节点 · 已完成' : '并行节点 · 待处理，不是跳过') :
    (record.skipped_stages || []).includes(stage) ? '已跳过' : current ? '当前节点' : reached ? '已办理' : '尚未到达';
  const canBack = (S.detail.rollback_targets?.[scope] || []).includes(stage);
  const approvalLocked = (S.detail.approvals || []).some(a => !['待发起', '已驳回', '已终止'].includes(a.status));
  const canEditPurchase = parallelPurchase && (isA() || (hasRole('hardware') && !approvalLocked));
  const mask = openModal('<div class="mhead"><div class="t">' + ico('clipboard', 18) + ' ' + h(stage) +
    '</div><button class="x" aria-label="关闭">×</button></div>' +
    '<div class="mbody"><div class="notice">' + status + '</div>' +
    (items.length ? '<div class="node-detail-grid">' + items.join('') + '</div>' : '<div class="notice">该节点无独立填写字段</div>') +
    (oldFiles.length ? '<div class="node-detail-history"><strong>历史附件</strong>' + oldFiles.join('') + '</div>' : '') +
    '</div><div class="mfoot"><button class="btn" data-close>' + ico('x', 15) + ' 关闭</button>' +
    (canEditPurchase ? '<button class="btn primary" data-edit-purchase>' + ico('pen', 15) + ' ' + (approvalLocked ? '补正外购资料' : '编辑外购入库') + '</button>' : '') +
    (canBack ? '<button class="btn danger" data-node-rollback>' + ico('refresh', 15) + ' 退回此节点</button>' : '') + '</div>', true);
  if (scope === 'design') mountDesignReminder(mask.querySelector('.mfoot'), stage);
  $('[data-close]', mask).onclick = closeModal;
  if (canEditPurchase) $('[data-edit-purchase]', mask).onclick = () => {
    closeModal();
    const target = '#/project/' + project.id + '/production';
    if (location.hash === target) $('#prod-purchase-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else { S.focusPurchaseOnRender = true; nav(target); }
  };
  if (canBack) $('[data-node-rollback]', mask).onclick = () => openRollbackModal(scope, stage);
}

function mountDesignReminder(container, stage) {
  const info = S.detail?.design_reminders?.[stage];
  if (!info || !container) return;
  const task = S.detail.design;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn';
  button.dataset.designRemind = stage;
  button.innerHTML = ico('bell', 15) + ' 催促';
  button.title = info.allowed ? '催促' + info.recipient_name + '填写' + stage : info.reason;
  const note = document.createElement('span'); note.className = 'hint design-reminder-note';
  container.appendChild(button); container.appendChild(note);
  function cooldown(seconds) {
    button.disabled = !info.allowed || seconds > 0;
    note.textContent = !info.allowed ? info.reason : seconds > 0 ? '已催促' + info.recipient_name + '，1分钟后可再次发送' : '接收人：' + info.recipient_name;
    if (info.allowed && seconds > 0) setTimeout(() => { if (button.isConnected) cooldown(0); }, seconds * 1000);
  }
  cooldown(info.retry_after_seconds);
  button.onclick = async () => {
    button.disabled = true; button.textContent = '发送中…';
    const requestId = button.dataset.requestId || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    button.dataset.requestId = requestId;
    try {
      const result = await api('/api/design/' + esc(task.id) + '/remind', { method: 'POST', body: {
        stage, expected_status: task.status, expected_updated_at: task.updated_at, request_id: requestId,
      } });
      delete button.dataset.requestId;
      info.retry_after_seconds = result.retry_after_seconds;
      button.innerHTML = ico('bell', 15) + ' 催促'; cooldown(result.retry_after_seconds);
      toast((result.duplicate ? '已催促过' : '已发送系统催促给') + result.recipient_name, 'ok');
    } catch (error) { button.innerHTML = ico('bell', 15) + ' 催促'; button.disabled = false; toast(error.message, 'err'); }
  };
}

function openRollbackModal(scope, target) {
  const record = S.detail?.[scope];
  const p = S.detail?.project;
  if (!record || !(S.detail.rollback_targets?.[scope] || []).includes(target)) return;
  const reopen = p.project_status === '已完成';
  const mask = openModal('<div class="mhead"><div class="t">退回到【' + h(target) + '】</div><button class="x" aria-label="关闭">×</button></div>' +
    '<div class="mbody"><p class="workflow-warning">当前节点【' + h(record.status) + '】将退回；相关下游任务暂停，原资料和操作记录保留。</p>' +
    '<div class="field"><label for="rollback-reason">退回原因<span class="req">*</span></label><textarea id="rollback-reason" rows="4" placeholder="写明需要修改的内容"></textarea></div>' +
    (reopen ? '<p class="workflow-warning">项目已经完成，提交后将重新打开，请核对已有出货和安装记录。</p>' : '') + '</div>' +
    '<div class="mfoot"><button class="btn" data-cancel>取消</button><button class="btn primary" data-confirm>确认退回</button></div>');
  $('[data-cancel]', mask).onclick = closeModal;
  $('[data-confirm]', mask).onclick = async (event) => {
    const reason = $('#rollback-reason', mask).value.trim();
    if (!reason) return toast('请填写退回原因', 'err');
    event.currentTarget.disabled = true;
    try {
      await api('/api/' + scope + '/' + record.id + '/rollback', { method: 'POST', body: { target, reason, reopen } });
      closeModal(); await refreshAfterAction(); toast('已退回【' + target + '】', 'ok');
    } catch (e) { toast(e.message, 'err'); event.currentTarget.disabled = false; }
  };
  $('#rollback-reason', mask).focus();
}

function savedNodeDataHtml(scope, stages, record) {
  const groups = stages.map(stage => {
    const saved = record.node_values?.[stage];
    if (!saved) return '';
    const items = nodeFields(scope, stage).filter(f => saved[f.key] !== undefined && saved[f.key] !== '' && saved[f.key] !== null)
      .map(f => {
        const value = saved[f.key];
        const shown = f.type === 'file' ? fileLink(value, '查看附件') :
          f.type === 'user' ? h(userNameById(value)) :
          f.type === 'users' ? h((Array.isArray(value) ? value : String(value).split(',')).map(userNameById).join('、')) :
          f.type === 'checkbox' ? (value ? '是' : '否') : h(value);
        return '<div><span class="k">' + h(f.label) + '</span><span class="v">' + shown + '</span></div>';
      });
    return items.length ? '<section><strong>' + h(stage) + '</strong><div class="saved-node-items">' + items.join('') + '</div></section>' : '';
  }).filter(Boolean);
  const oldFiles = (record.file_history || []).map(item => '<div>' + h(item.stage || '历史') + ' · ' + h(item.field) + '：' + fileLink(item.file_id, '查看旧版') + '</div>');
  if (!groups.length && !oldFiles.length) return '';
  return '<details class="saved-node-data"><summary>已保存的各节点资料与附件</summary>' + groups.join('') +
    (oldFiles.length ? '<section><strong>历史附件</strong>' + oldFiles.join('') + '</section>' : '') + '</details>';
}

function projHeadHtml(p) {
  return '<div class="proj-head">' +
    '<div class="r1"><span class="nm">' + h(p.customer_name) + '</span>' + typeBadge(p.project_type) + statusBadge(p.project_status) +
    (p.exception_status !== '无异常' ? '<span class="badge b-red">' + ico('alert', 13) + h(p.exception_status) + '</span>' : '') +
    (p.is_showroom ? '<span class="badge b-purple">样板间</span>' : '') +
    (p.skip_install ? '<span class="badge b-gray">免安装</span>' : '<span class="badge b-blue">需安装</span>') +
    '<span class="no">' + h(p.project_no) + '</span></div>' +
    '<div class="r2">' +
    '<span>' + ico('phone', 14) + '<b>' + h(p.customer_phone) + '</b></span>' +
    '<span>' + ico('pin', 14) + h(p.address) + '</span>' +
    '<span>' + ico('user', 14) + '销售：<b>' + h(userNameById(p.sales_id)) + '</b></span>' +
    '<span>' + ico('pen', 14) + '设计师：<b>' + (p.designer_id ? h(userNameById(p.designer_id)) : '待分配') + '</b></span>' +
    '<span>' + ico('yuan', 14) + '合同：<b>' + (p.contract_amount ? money(p.contract_amount) : '未签') + '</b></span>' +
    '<span>' + ico('calendar', 14) + '预计交付：<b>' + fmtDate(p.expected_delivery_date) + '</b></span>' +
    (p.actual_delivery_date ? '<span>' + ico('checkCircle', 14) + '实际交付：<b>' + fmtDate(p.actual_delivery_date) + '</b></span>' : '') +
    '</div></div>';
}

/* ---------- 概览 ---------- */
function tabOverview() {
  const { project: p, design: d, production: pr, approval: ap, install: it } = S.detail;
  const C = S.db.consts;
  const flow = flowOfType(p.project_type) || {};
  const batches = (S.detail.batches || []);
  const items = [
    ['项目编号', p.project_no], ['项目类型', C.PROJECT_TYPES[p.project_type] + '（' + p.project_type + '）'],
    ['客户类型', p.customer_type], ['来源渠道', p.source_channel], ['成交日期', fmtDate(p.deal_date)],
    ['合同金额', p.contract_amount ? money(p.contract_amount) : '—'], ['预计交付', fmtDate(p.expected_delivery_date)], ['实际交付', fmtDate(p.actual_delivery_date)],
    ['负责销售', userNameById(p.sales_id)], ['设计师', p.designer_id ? userNameById(p.designer_id) : '待分配'],
    ['设计任务', d ? d.task_no + '（' + d.status + '）' : '未创建'],
    ['生产任务', pr ? pr.task_no + '（' + (pr.batch_flow ? '分批生产/出货中' : pr.status) + '）' : '未创建'],
    ['安装任务', it ? it.task_no + (it.installer_name ? '（' + it.installer_name + '）' : '') : (flow.install ? '未创建' : '该项目无需安装')],
    ['出货审批', ap ? ap.status : '未发起'],
    ['是否分批生产', pr && pr.batch_flow ? '是（' + batches.length + ' 个生产批次）' : '否'],
  ];
  if (p.project_status === '已终止') {
    items.push(['终止原因', p.terminate_reason || '—']);
    items.push(['终止人 / 时间', (p.terminated_by || '—') + ' · ' + (p.terminated_at ? fmtDT(p.terminated_at) : '—')]);
  }
  let progress = '';
  if (d) progress += '<div style="margin-bottom:10px;font-size:13px;color:var(--gray)">设计阶段（' + designStageList(p.project_type).length + ' 个节点）</div>' + stepsBar(designStageList(p.project_type), d.status, d.skipped_stages, { scope: 'design' });
  if (pr) progress += '<div style="margin:14px 0 10px;font-size:13px;color:var(--gray)">生产阶段</div>' + stepsBar(prodStageList(p.project_type), pr.status, pr.skipped_stages, { scope: 'production' });
  if (it) progress += '<div style="margin:14px 0 10px;font-size:13px;color:var(--gray)">安装阶段</div>' + stepsBar(installStageList(), it.status, it.skipped_stages, { scope: 'install' });
  let html = '<div class="grid2"><div class="card"><h3>基本信息</h3><div class="info-grid">' +
    items.map((i) => '<div><div class="k">' + i[0] + '</div><div class="v">' + h(i[1]) + '</div></div>').join('') +
    (p.remark ? '<div style="grid-column:1/-1"><div class="k">备注</div><div class="v">' + h(p.remark) + '</div></div>' : '') +
    '</div></div>' +
    '<div class="card"><h3>整体进度</h3>' + (progress || emptyBox('项目刚创建，暂无进度')) + '</div></div>';
  /* 分批生产 / 多批次出货：主项目汇总 */
  if (pr && pr.batch_flow) html += batchSummaryCard(p, pr, batches);
  /* 项目总表附加字段 */
  if (cfScopeDefs('project').length || cfInfoItems('project', p).length) {
    const canEditCf = p.project_status !== '已终止' && (isA() || (hasCap('sales') && p.sales_id === S.me.id) || canAct('new_external'));
    if (canEditCf && cfScopeDefs('project').length) html += cfPanelHtml('project', p, '/api/projects/' + p.id + '/fields', 'sliders',
      '项目总表 · 附加字段', '这些是管理员为「项目总表」配置的字段，随项目一起保存，任何状态下都可以补充或修改。');
    else html += '<div class="card"><h3>' + ico('sliders', 17) + '项目总表 · 附加字段</h3><div class="info-grid">' +
      (cfInfoGridHtml('project', p) || emptyBox('暂无内容')) + '</div></div>';
  }
  return html;
}

/* ---------- 设计阶段 ---------- */
function tabDesign() {
  const d = S.detail.design;
  if (!d) return '<div class="card">' + emptyBox('设计任务尚未创建') + '</div>';
  const p = S.detail.project;
  const stages = designStageList(p.project_type);
  const canOp = canOperateNode(p, 'design', d.status);
  let html = '<div class="card"><h3>设计流程 · 当前节点【' + h(d.status) + '】</h3>' + stepsBar(stages, d.status, d.skipped_stages, { scope: 'design', targets: S.detail.rollback_targets?.design || [] });
  if (S.detail.design_reminders) html += '<div class="workflow-controls" id="design-reminder-bar"></div>';
  if (p.project_status === '已终止') html += '<div class="notice" style="background:var(--red-l);border-color:#fecaca;color:#b91c1c">项目已终止，设计任务停止</div>';
  else if (d.status === '设计完成') html += '<div class="notice" style="background:var(--green-l);border-color:#bbf7d0;color:#15803d">✓ 设计阶段已全部完成</div>';
  else if (canOp) html += nodeBannerHtml('design', d.status) + '<div id="design-action"></div>';
  else html += '<div class="notice">当前节点【' + h(d.status) + '】由 ' + h(nodeActorsLabel('design', d.status)) + ' 操作' + (p.project_type === 'WJ' ? '（外接单可由生产部代录）' : '') + '</div>';
  const flow = flowOfType(p.project_type) || {};
  const rows = [
    ['任务编号', d.task_no], ['设计师', d.designer_id ? userNameById(d.designer_id) : '待分配'],
    ['分配时间', fmtDate(d.assign_date)], ['交意向金时间', fmtDate(d.intent_deposit_date)], ['设计负责人', d.design_owner || '—'],
    ['量尺时间', fmtDate(d.measure_date)], ['初量尺人员', (Array.isArray(d.measure_person) ? d.measure_person : String(d.measure_person || '').split(',')).map(userNameById).filter(n => n !== '—').join('、') || '—'],
    ['初稿完成', fmtDate(d.draft_complete_date)], ['初稿客户确认', d.customer_confirm_status || '—'],
    ['复尺时间', fmtDate(d.remeasure_date)], ['图纸版本', d.drawing_version || '—'], ['复尺图纸版本', d.drawing_version_remeasure || '—'],
    ['拆单开始', fmtDate(d.splitter_start_date)], ['拆单完成', fmtDate(d.splitter_complete_date)],
    ['拆单人员', d.splitter_id ? userNameById(d.splitter_id) : '—'],
    ['转接生产', fmtDate(d.splitter_transfer_date)], ['生产负责人', (d.production_manager_ids || []).map(userNameById).filter(Boolean).join('、') || (d.production_manager_id ? userNameById(d.production_manager_id) : '—')],
    ['五金单转交', fmtDate(d.hardware_transfer_date)], ['最终图纸', fmtDate(d.final_drawing_date)],
    ['客户确认状态', d.customer_confirm_status || '—'], ['客户反馈', d.customer_feedback || '—'],
  ];
  html += '</div><div class="card"><h3>设计信息与文档</h3><div class="info-grid">' +
    rows.map((i) => '<div><div class="k">' + i[0] + '</div><div class="v">' + h(i[1]) + '</div></div>').join('') +
    cfInfoGridHtml('design', d) + '</div>' +
    '<div style="margin-top:14px;display:flex;gap:16px;flex-wrap:wrap;font-size:13.5px">' +
    (flow.hardware ? '' : '') +
    '<span>初稿最终图纸：' + (d.draft_drawings ? fileLink(d.draft_drawings, '查看图纸') : '—') + '</span>' +
    '<span>初量尺报价表：' + (d.initial_quotation ? fileLink(d.initial_quotation, '查看报价表') : '—') + '</span>' +
    '<span>最终图纸：' + (d.final_drawings ? fileLink(d.final_drawings, '查看最终图纸') : '—') + '</span>' +
    '<span>最终报价表：' + (!S.detail.can_view_final_quotation ? '仅项目负责销售和管理员可见' : d.quotation ? fileLink(d.quotation, '查看报价表') : '—') + '</span>' +
    '<span>正式合同：' + (d.contract ? fileLink(d.contract, '查看合同') : '—') + '</span>' +
    (flow.hardware ? '<span>五金单：' + (d.hardware_list ? fileLink(d.hardware_list, '查看五金单') : '—') + '</span>' : '') +
    '</div>' + savedNodeDataHtml('design', stages, d) + '</div>';
  return html;
}
function bindDesign() {
  const box = $('#design-action'); if (!box) return;
  const d = S.detail.design, p = S.detail.project;
  const st = d.status;
  const cfb = cfBox('design', st, d.custom || {});
  box.innerHTML = '<div class="card" style="background:#f8faff;border-color:#c7d6f5"><h3>' + ico('bolt', 17) + '完成【' + h(st) + '】</h3>' +
    nodeFormHtml('design', st, d) + cfb.html +
    '<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn primary big" id="design-submit">提交并进入下一节点 →</button></div></div>';
  mountNodeForm(box);
  cfb.mount(box);
  $('#design-submit', box).onclick = async () => {
    const btn = $('#design-submit', box);
    const data = collectNodeForm(box, 'design', st); data.custom = cfb.get();
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const r = await api('/api/design/' + d.id + '/advance', { method: 'POST', body: { data } });
      await refreshAfterAction();
      toast(r.returned ? '客户要求修改图纸，已退回【' + r.prev + '】' : '【' + st + '】已完成', 'ok');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '提交并进入下一节点 →'; }
  };
}

/* ---------- 生产阶段 ---------- */
const PROD_NATIVE = ['下单备料', '材料到场', '生产开料', '木工制作', '原件打磨', '油漆喷刷', '外购入库', '组装打包'];
function purchaseVisible(project, task) {
  return ['DZ', 'WJ'].includes(project.project_type) && !task.batch_flow &&
    prodStageList(project.project_type).indexOf(task.status) >= prodStageList(project.project_type).indexOf('原件打磨') &&
    project.project_status !== '已终止' && task.status !== '已终止';
}
function tabPurchaseTodo() {
  const p = S.detail.project, pr = S.detail.production;
  if (!pr || !purchaseVisible(p, pr)) return '<div class="card"><div class="notice">当前项目没有待填写的外购入库节点。</div></div>';
  return '<div class="card"><h3>外购入库 · ' + h(pr.purchase_order_status || '待处理') + '</h3><div id="prod-purchase-action"></div></div>';
}
function tabProduction() {
  const pr = S.detail.production;
  if (!pr) return '<div class="card">' + emptyBox('生产任务尚未创建（需设计阶段「转接生产」后自动生成；成品/清仓新建即自动创建）') + '</div>';
  const p = S.detail.project;
  const batches = S.detail.batches || [];
  const assignedExternal = canEditExternalProduction(p, pr, pr.status);
  const canProd = isA() || hasRole('production') || assignedExternal;
  const externalOnly = assignedExternal && !isA() && !hasRole('production');
  const native = PROD_NATIVE.includes(pr.status);
  const extraForm = !native && !['已终止'].includes(pr.status) && cfHas('production', pr.status);
  let html = '<div class="card"><h3>生产流程 · 当前节点【' + h(pr.batch_flow ? '分批生产 / 出货中' : pr.status) + '】</h3>' +
    stepsBar(prodStageList(p.project_type), pr.batch_flow ? '材料到场' : pr.status, pr.skipped_stages, {
      scope: 'production', targets: S.detail.rollback_targets?.production || [],
      pendingStages: pr.parallel_purchase && !pr.purchase_completed_at ? ['外购入库'] : [],
    });
  if (pr.status === '已终止' || p.project_status === '已终止') html += '<div class="notice" style="background:var(--red-l);border-color:#fecaca;color:#b91c1c">项目已终止，生产任务停止' + (pr.terminated_reason ? '：' + h(pr.terminated_reason) : '') + '</div>';
  else if (pr.batch_flow) html += '<div class="notice warn">' + ico('package', 15) + '项目已进入【分批生产 / 出货中】，主项目不再跟随单个批次节点。请在下方【生产批次】中逐批推进。</div>';
  else if (pr.status === '组装打包' && pr.packaging_done_at) html += '<div class="notice warn">组装打包已完成，等待外购入库完成后生成出货申请。</div>';
  else if (native) {
    if (canProd) html += nodeBannerHtml('production', pr.status) + '<div id="prod-action"></div>';
    else html += '<div class="notice">当前节点由 ' + h(nodeActorsLabel('production', pr.status)) + ' 操作' + (pr.status === '下单备料' || pr.status === '材料到场' || pr.status === '生产开料' || pr.status === '木工制作' || pr.status === '原件打磨' ? '（木工负责人）' : (pr.status === '油漆喷刷' || pr.status === '组装打包' ? '（油漆负责人）' : '（五金采购）')) + '</div>';
  } else if (pr.status === '出货申请') html += '<div class="notice warn">' + ico('package', 15) + '生产打包完成，等待销售到【出货审批】一键提交出货申请' + (hasCap('sales') ? ' <a onclick="nav(\'#/project/' + p.id + '/ship\')">去提交 →</a>' : '') + '</div>';
  else if (pr.status === '准备出货') html += '<div class="notice">出货流程进行中，请在【出货审批】处理准备出货节点</div>';
  else html += '<div class="notice" style="background:var(--green-l);border-color:#bbf7d0;color:#15803d">✓ 生产与出货已完成</div>';
  if (extraForm) {
    if (canProd) html += '<div id="prod-action"></div>';
    else html += '<div class="notice">当前节点由生产部操作</div>';
  }
  html += '</div>';

  if (purchaseVisible(p, pr)) {
    const ready = pr.parallel_purchase ? !!pr.purchase_completed_at : ['不需要', '已入库'].includes(pr.purchase_order_status);
    const approvalLocked = (S.detail.approvals || []).some(a => !['待发起', '已驳回', '已终止'].includes(a.status));
    html += '<div class="card" id="prod-purchase-card"><h3>外购入库 <span class="badge ' + (ready ? 'b-green' : 'b-amber') + '">' +
      (ready ? '已完成' : (pr.purchase_order_status || '待处理')) + '</span></h3>' +
      ((isA() || hasRole('hardware')) && (!approvalLocked || isA()) ? '<div id="prod-purchase-action"></div>' :
        '<div class="notice">由五金采购负责人填写；当前状态：' + h(pr.purchase_order_status || '待处理') + '</div>') + '</div>';
  }

  /* 分批生产汇总（主项目只看汇总条件） */
  if (pr.batch_flow) html += batchSummaryCard(p, pr, batches);

  /* 生产批次管理 */
  html += '<div class="card"><h3>' + ico('package', 17) + '生产批次' + (batches.length ? '<span class="badge b-blue">' + batches.length + ' 个生产批次</span>' : '') + '</h3>';
  if (!pr.batch_flow) {
    html += batches.length
      ? '<div class="notice warn" style="margin:0">已有生产批次和出货记录已保留。当前主生产节点正在补正，批次暂停；重新完成【材料到场】并选择分批制作后，继续使用原批次。</div>' +
        (isA() ? '<div class="row-act" style="margin-top:12px;flex-wrap:wrap">' + batches.map(b =>
          '<button class="btn sm" onclick="openBatchCorrection(\'' + b.id + '\')">补正 ' + h(b.batch_name) + ' 资料</button>').join('') + '</div>' : '')
      : '<div class="notice" style="margin:0">项目尚未进入分批生产。在【材料到场】节点选择「是否分批次制作 = 是」后，系统会自动固定创建第 1、第 2 生产批次。</div>' +
        ((canProd) ? '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button class="btn" id="bt-start">' + ico('plus', 15) + ' 手动进入分批生产（创建第1、第2批次）</button></div>' : '');
  } else {
    if (batches.length) html += '<div class="tw"><table class="table"><thead><tr><th>生产批次</th><th>有效性</th><th>当前步骤</th><th>生产状态</th><th>出货</th><th>约定发货</th><th>实际发货</th><th>异常</th><th>操作</th></tr></thead><tbody>' +
      batches.map((b) => {
        const stCls = b.status === '已出货' ? 'b-green' : (b.status === '生产完成' ? 'b-blue' : 'b-amber');
        const dead = b.valid === false;
        return '<tr' + (dead ? ' class="row-void"' : '') + '><td><b>' + h(b.batch_name) + '</b>' +
            (b.batch_content ? '<div class="sub">本批内容：' + h(b.batch_content) + '</div>' : '') +
            (b.ship_content ? '<div class="sub">出货内容：' + h(b.ship_content) + '</div>' : '') + '</td>' +
          '<td>' + (dead ? '<span class="badge b-gray">已作废</span>' : '<span class="badge b-green">有效</span>') +
            (dead && b.void_reason ? '<div class="sub">原因：' + h(b.void_reason) + '</div>' : '') + '</td>' +
          '<td>' + h(b.step) + '</td><td><span class="badge ' + stCls + '">' + h(b.status) + '</span></td>' +
          '<td>' + h(b.ship_status || '—') + '</td><td>' + fmtDate(b.agreed_ship_date) + '</td><td>' + fmtDate(b.actual_ship_date) + '</td>' +
          '<td>' + (b.exception === '是' ? '<span class="badge b-red">异常</span>' : '—') + '</td>' +
          '<td><div class="row-act">' +
            (canProd && !dead && b.status !== '已出货' && ['开料/木工/打磨', '油漆/包装'].includes(b.step) && (!externalOnly || b.step === '开料/木工/打磨')
              ? '<button class="btn sm primary" onclick="openBatchAdvance(\'' + b.id + '\')">推进本批次</button>' : '') +
            (isA() && !dead ? '<button class="btn sm" onclick="openBatchCorrection(\'' + b.id + '\')">补正资料</button>' : '') +
            (canProd && !dead && b.status !== '已出货' ? '<button class="btn sm ghost" onclick="voidBatch(\'' + b.id + '\')">作废</button>' : '') +
            (canProd && dead ? '<button class="btn sm ghost" onclick="restoreBatch(\'' + b.id + '\')">恢复有效</button>' : '') +
            ((canProd && (dead || b.status === '已出货' || ['开料/木工/打磨', '油漆/包装'].includes(b.step))) ? '' : '—') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">' +
      (canProd ? '<button class="btn" id="bt-add">' + ico('plus', 15) + ' 新增下一生产批次</button>' : '') +
      '<span class="hint" style="align-self:center">批次编号由系统按现有最大批次号 +1 自动生成，不允许手动输入。</span></div>';
  }
  html += '</div>';

  // 生产异常（全生产阶段唯一报备字段，历史只追加不覆盖）
  html += '<div class="card"><h3>' + ico('alert', 17) + '生产异常记录' +
    (pr.is_exception ? '<span class="badge b-red">当前异常未解决</span>' : (pr.exception_logs || []).length ? '<span class="badge b-green">已解决</span>' : '') + '</h3>';
  if ((pr.exception_logs || []).length) {
    html += '<div class="exc-panel"><div class="ex-t">' + (pr.is_exception ? dot('var(--red)') + '当前异常未解决' : dot('var(--green)') + '异常已解决') +
      (pr.exception_date ? '（发生：' + fmtDate(pr.exception_date) + (pr.exception_resolve_date ? ' → 解决：' + fmtDate(pr.exception_resolve_date) : '') + '）' : '') + '</div>' +
      pr.exception_logs.map((l) => '<div class="ex-log"><b>' + fmtDT(l.at) + ' ' + h(l.by) + '：</b>' + h(l.desc) + '</div>').join('') + '</div>';
  } else html += '<div class="notice" style="margin:0">当前无生产异常记录。「生产是否异常」在生产各节点填写，填写「是」时必须说明异常情况。</div>';
  html += '</div>';

  // 生产信息
  html += '<div class="card"><h3>生产信息</h3><div class="info-grid">' + [
    ['任务编号', pr.task_no], ['生产负责人', (pr.production_manager_ids || [pr.production_manager_id]).filter(Boolean).map(userNameById).join('、') || '—'],
    ['材料下单', pr.material_order_status || '—'], ['材料下单时间', fmtDate(pr.material_order_date)],
    ['木材到厂', fmtDate(pr.wood_arrival_date)], ['板材到厂', fmtDate(pr.board_arrival_date)], ['材料到场状态', pr.material_arrival_status || '—'],
    ['是否分批制作', pr.is_batch || '—'], ['开料开始', fmtDate(pr.cutting_start_date)],
    ['开料完成', fmtDate(pr.cutting_complete_date)], ['开料负责人', userNameById(pr.cutting_owner) !== '—' ? userNameById(pr.cutting_owner) : (pr.cutting_owner || '—')],
    ['木工完成', fmtDate(pr.woodwork_complete_date)], ['打磨完成', fmtDate(pr.polishing_complete_date)],
    ['油漆完成', fmtDate(pr.painting_complete_date)], ['外购下单', pr.purchase_order_status || '—'], ['外购入库', fmtDate(pr.purchase_arrival_date)],
    ['组装完成', fmtDate(pr.assembly_complete_date)], ['包装完成', fmtDate(pr.packaging_complete_date)],
    ['约定发货', fmtDate(pr.agreed_ship_date)], ['实际发货', fmtDate(pr.actual_ship_date)], ['出货状态', pr.ship_status || '—'],
    ['是否分派安装', pr.dispatch_install || '—'],
  ].map((i) => '<div><div class="k">' + i[0] + '</div><div class="v">' + h(i[1]) + '</div></div>').join('') +
    cfInfoGridHtml('production', pr) + '</div>' +
    (pr.material_list ? '<div style="margin-top:12px;font-size:13.5px">材料单：' + fileLink(pr.material_list, '查看') + '</div>' : '') +
    savedNodeDataHtml('production', prodStageList(p.project_type), pr) + '</div>';
  return html;
}
function bindProduction() {
  const box = $('#prod-action');
  const pr = S.detail.production;
  if (pr?.batch_flow && !pr.batches_finalized && (isA() || hasRole('production') ||
      canEditExternalProduction(S.detail.project, pr, pr.status))) {
    const target = box || document.querySelector('.page-body') || document.querySelector('main');
    if (target) {
      const button = document.createElement('button'); button.className = 'btn'; button.textContent = '确认生产批次已建齐';
      button.onclick = async () => {
        if (!confirm('确认所有计划生产批次已经建立？新增批次会取消此确认。')) return;
        button.disabled = true;
        try { await api('/api/production/' + pr.id + '/finalize-batches', { method: 'POST', body: {} }); await refreshAfterAction(); }
        catch (e) { toast(e.message, 'err'); button.disabled = false; }
      };
      target.prepend(button);
    }
  }
  if (box && pr) {
    const native = PROD_NATIVE.includes(pr.status);
    const cfb = cfBox('production', pr.status, pr.custom || {});
    if (native || cfb.defs.length) {
      box.innerHTML = '<div class="card" style="background:#fffbeb;border-color:#fde68a"><h3>' + ico('bolt', 17) + '完成【' + h(pr.status) + '】</h3>' +
        (native ? '' : '<div class="hint" style="margin:-4px 0 10px">当前节点由出货审批流程驱动，这里只保存附加字段，不会改变生产状态。</div>') +
        (native ? nodeFormHtml('production', pr.status, pr) : '') + cfb.html +
        '<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn primary big" id="prod-submit">' +
        (native ? '提交并进入下一节点 →' : '保存附加字段') + '</button></div></div>';
      mountNodeForm(box);
      cfb.mount(box);
      $('#prod-submit', box).onclick = async () => {
        const btn = $('#prod-submit', box);
        const custom = cfb.get();
        btn.disabled = true; btn.textContent = '提交中…';
        try {
          if (native) {
            const data = collectNodeForm(box, 'production', pr.status);
            data.custom = custom;
            const r = await api('/api/production/' + pr.id + '/advance', { method: 'POST', body: { data } });
            await refreshAfterAction();
            toast(r.batch ? '已转入【分批生产 / 出货中】，系统已创建第1、第2生产批次' : '【' + pr.status + '】已完成', 'ok');
          } else {
            await api('/api/production/' + pr.id + '/fields', { method: 'POST', body: { custom } });
            await refreshAfterAction(); toast('附加字段已保存', 'ok');
          }
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = native ? '提交并进入下一节点 →' : '保存附加字段'; }
      };
    }
  }
  const bs = $('#bt-start');
  if (bs) bs.onclick = async () => {
    if (!confirm('确认进入分批生产？系统将固定创建第1、第2生产批次。')) return;
    try { await api('/api/production/' + pr.id + '/batches', { method: 'POST', body: {} }); await refreshAfterAction(); toast('已进入分批生产，创建第1、第2生产批次', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const ba = $('#bt-add');
  if (ba) ba.onclick = async () => {
    try { const r = await api('/api/production/' + pr.id + '/batches', { method: 'POST', body: {} }); await refreshAfterAction(); toast('已新增 ' + r.batch_name, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
}
function bindPurchase() {
  const box = $('#prod-purchase-action');
  const pr = S.detail?.production;
  if (!box || !pr) return;
  const approvalLocked = (S.detail.approvals || []).some(a => !['待发起', '已驳回', '已终止'].includes(a.status));
  const correction = approvalLocked && isA();
  const customFields = correction ? null : cfBox('production', '外购入库', pr.custom || {});
  box.innerHTML = nodeFormHtml('production', '外购入库', pr) +
    (customFields ? '<div class="form-grid">' + customFields.html + '</div>' : '') +
    (correction ? '<div class="notice warn">原审批和已发货事实保持不变。本次修改将记录补正原因。</div>' +
      fld('补正原因', '<textarea name="purchase_correction_reason" rows="2" placeholder="请写明核实依据"></textarea>', true, true) : '') +
    '<div class="workflow-controls"><button class="btn' + (correction ? ' primary' : '') + '" data-purchase-save>' + (correction ? '保存补正' : '保存进度') + '</button>' +
    (!correction && !pr.purchase_completed_at ? '<button class="btn primary" data-purchase-complete>完成外购入库</button>' : '') + '</div>';
  mountNodeForm(box);
  if (customFields) customFields.mount(box);
  for (const [selector, action] of [['[data-purchase-save]', 'save'], ['[data-purchase-complete]', 'complete']]) {
    const button = $(selector, box);
    if (!button) continue;
    button.onclick = async () => {
      button.disabled = true;
      try {
        const data = collectNodeForm(box, 'production', '外购入库');
        if (customFields) data.custom = customFields.get();
        const reason = correction ? $('[name=purchase_correction_reason]', box).value.trim() : '';
        if (correction && reason.length < 2) throw new Error('请填写至少 2 个字的补正原因');
        const result = await api('/api/production/' + pr.id + (correction ? '/purchase-correct' : '/purchase'), { method: 'POST', body: {
          action, data, reason, expected_status: pr.status, expected_updated_at: pr.updated_at,
        } });
        await refreshAfterAction();
        toast(correction ? '外购资料已补正' : action === 'complete' ? (result.status === '出货申请' ? '外购完成，已进入出货申请' : '外购入库已完成') : '外购进度已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); button.disabled = false; }
    };
  }
}
/* 主项目「分批生产 / 出货中」汇总卡片 */
/* 主项目「分批生产 / 出货中」汇总卡片 —— v2.1：只统计有效批次，另列实际出货次数与作废批次数 */
function batchSummaryCard(p, pr, batches) {
  const alive = batches.filter((b) => b.valid !== false);
  const total = alive.length;
  const prodDone = alive.filter((b) => ['生产完成', '已出货'].includes(b.status)).length;
  const shipped = alive.filter((b) => b.status === '已出货').length;
  const shipCount = (S.detail.approvals || []).filter((a) => a.status === '已完成').length;
  const voidCount = batches.length - total;
  const openExc = alive.some((b) => b.exception === '是') || !!pr.is_exception;
  const pp = total ? Math.round((prodDone / total) * 100) : 0;
  const sp = total ? Math.round((shipped / total) * 100) : 0;
  let endNote;
  if (total && prodDone === total && shipped === total && !openExc) endNote = '所有有效生产批次已完成、均被「已完成」出货记录覆盖，且无未关闭异常 → 满足闭环条件';
  else if (total && prodDone === total && !openExc) endNote = '生产已完成，仍有有效批次未实际出货 → 继续保持【分批生产 / 出货中】';
  else if (!total) endNote = '当前没有有效生产批次（全部已作废）→ 请恢复或新增批次';
  else endNote = '仍有有效生产批次未完成 → 继续保持【分批生产 / 出货中】';
  const needIns = p.need_install === true;
  return '<div class="card"><h3>' + ico('package', 17) + '主项目汇总 · 分批生产 / 出货中' +
    (openExc ? '<span class="badge b-red">存在异常</span>' : '<span class="badge b-green">无异常</span>') + '</h3>' +
    '<div class="info-grid">' + [
      ['总有效生产批次数', total],
      ['已完成生产批次数', prodDone + ' / ' + total],
      ['已出货生产批次数', shipped + ' / ' + total],
      ['实际出货次数', shipCount],
      ['生产完成进度', pp + '%'],
      ['出货覆盖进度', sp + '%'],
      ['项目级安装意向', p.need_install === null || p.need_install === undefined ? '未确定' : (needIns ? '需要安装' : '不需要安装')],
      ['项目风险状态', openExc ? '异常' : '正常'],
      ['已作废批次', voidCount],
    ].map((i) => '<div><div class="k">' + i[0] + '</div><div class="v">' + h(i[1]) + '</div></div>').join('') + '</div>' +
    '<div class="hint" style="margin-top:10px">' + h(endNote) + '。主项目不跟「最后一批」走，只看汇总条件；作废批次不参与任何进度与闭环判断。</div></div>';
}
/* 生产批次作废 / 恢复（v2.1） */
function voidBatch(bid) {
  const b = (S.detail.batches || []).find((x) => x.id === bid); if (!b) return;
  openModal('<div class="mhead"><div class="t">' + ico('alert', 18) + '作废 ' + h(b.batch_name) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody"><div class="notice warn" style="margin:0 0 14px">作废后该批次不会参与生产进度、出货覆盖进度与闭环判断；如果它已有在途出货审批，审批单会被一并终止。' +
    (b.status === '生产完成' ? '该批次已生产完成，作废前请确认确实不需要它。' : '') + '</div>' +
    '<div class="form-grid">' + fld('作废原因', '<input name="void_reason" type="text" placeholder="例：重复创建 / 客户取消该部分内容">', 0, 1) + '</div></div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="bt-void">确认作废</button></div>');
  $('#bt-void').onclick = async () => {
    const reason = ($('#bt-void').closest('.modal').querySelector('input[name=void_reason]') || {}).value || '';
    if (String(reason).trim().length < 2) { toast('请填写作废原因（至少 2 个字）', 'err'); return; }
    try { await api('/api/batches/' + bid + '/void', { method: 'POST', body: { reason: reason.trim() } }); closeModal(); await refreshAfterAction(); toast('该批次已作废', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
}
async function restoreBatch(bid) {
  if (!confirm('确认把该批次恢复为有效批次？它将重新参与生产进度与闭环判断。')) return;
  try { await api('/api/batches/' + bid + '/restore', { method: 'POST', body: {} }); await refreshAfterAction(); toast('已恢复为有效批次', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}
function batchNodeFieldsHtml(b, stage, correction = false) {
  const d = '';
  let fields = '';
  if (stage === '开料/木工/打磨') {
    fields = fld('本批生产内容', '<input name="batch_content" type="text" value="' + h(b.batch_content || '') + '" placeholder="例：主卧衣柜柜门 · 客厅背景墙板">', 0, 1) +
      fld('材料到场时间', inp('material_arrival_date', 'date', b.material_arrival_date || d), 1) +
      fld('开料完成时间', inp('cutting_complete_date', 'date', b.cutting_complete_date || d), 1) +
      fld('木工制作完成时间', inp('woodwork_complete_date', 'date', b.woodwork_complete_date || d), 1) +
      fld('木工打磨完成时间', inp('woodwork_polish_date', 'date', b.polishing_complete_date || d), 1) +
      fld('生产是否异常', sel('batch_exception', correction ? [{ v: '', t: '请选择' }, { v: '否', t: '否' }, { v: '是', t: '是' }] : ['否', '是'], b.exception || (correction ? '' : '否')), 1) +
      fld('异常说明（异常时必填）', '<textarea name="batch_exception_desc">' + h(b.exception_desc || '') + '</textarea>', 0, 1);
  } else {
    fields = fld('油漆完成时间', inp('painting_complete_date', 'date', b.painting_complete_date || d), 1) +
      fld('包装完成时间', inp('packaging_complete_date', 'date', b.packaging_complete_date || d), 1);
  }
  return fields;
}
/* 单个生产批次推进弹窗 */
function openBatchAdvance(bid) {
  const b = (S.detail.batches || []).find((x) => x.id === bid); if (!b) return;
  openModal('<div class="mhead"><div class="t">' + ico('package', 18) + '推进 ' + h(b.batch_name) + ' · ' + h(b.step) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody"><div class="form-grid">' + batchNodeFieldsHtml(b, b.step) + '</div></div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="bt-do">提交</button></div>');
  $('#bt-do').onclick = async () => {
    const data = formData($('.mbody'));
    if (data.batch_exception === '是' && !String(data.batch_exception_desc || '').trim()) { toast('请填写异常说明', 'err'); return; }
    try { await api('/api/batches/' + bid + '/advance', { method: 'POST', body: { data } }); closeModal(); await refreshAfterAction(); toast('批次已推进', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
}

function openBatchCorrection(bid) {
  const batch = (S.detail.batches || []).find(b => b.id === bid);
  if (!batch || !isA()) return;
  const stages = ['开料/木工/打磨'];
  if (batch.painting_complete_date || ['生产完成', '已出货'].includes(batch.status)) stages.push('油漆/包装');
  const mask = openModal('<div class="mhead"><div class="t">补正 ' + h(batch.batch_name) + ' 的历史资料</div><button class="x" aria-label="关闭">×</button></div>' +
    '<div class="mbody"><div class="notice warn" style="margin-bottom:12px">原资料和补正记录保留；已实际发货的批次不会退回未出货，原审批不变。</div>' +
    fld('生产节点', sel('correction_stage', stages.map(stage => ({ v: stage, t: stage })), stages[0]), true, true) +
    '<div class="form-grid" id="batch-correction-fields"></div>' +
    fld('补正原因', '<textarea name="correction_reason" rows="3"></textarea>', true, true) + '</div>' +
    '<div class="mfoot"><button class="btn" data-cancel>取消</button><button class="btn primary" data-confirm>保存补正</button></div>');
  const stageSelect = $('[name=correction_stage]', mask);
  const fieldsBox = $('#batch-correction-fields', mask);
  const renderFields = () => { fieldsBox.innerHTML = batchNodeFieldsHtml(batch, stageSelect.value, true); };
  stageSelect.onchange = renderFields;
  renderFields();
  $('[data-cancel]', mask).onclick = closeModal;
  $('[data-confirm]', mask).onclick = async event => {
    const reason = $('[name=correction_reason]', mask).value.trim();
    if (reason.length < 2) return toast('请填写至少 2 个字的补正原因', 'err');
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/api/batches/' + batch.id + '/correct', { method: 'POST', body: {
        stage: stageSelect.value, reason, data: formData(fieldsBox),
        expected_step: batch.step, expected_updated_at: batch.updated_at,
      } });
      closeModal(); await refreshAfterAction();
      toast('已补正 ' + result.changed + ' 项，原出货记录保留', 'ok');
    } catch (error) { toast(error.message, 'err'); button.disabled = false; }
  };
}

/* ---------- 出货审批 ---------- */
const SHIP_STATUS_MAP = {
  '待发起': ['b-amber', 0], '已驳回': ['b-red', 0], '管理层审批': ['b-blue', 1],
  '待填出货信息': ['b-amber', 2], '待出货': ['b-blue', 3], '已完成': ['b-green', 4], '已终止': ['b-gray', 0],
};
let SHIP_SEL = null;   // 当前查看的审批单 id（多批次时切换）
function tabShip() {
  const p = S.detail.project;
  const all = S.db.approvals.filter((a) => a.project_id === p.id);
  if (!all.length) return '<div class="card">' + emptyBox('出货申请尚未发起（生产打包完成后自动提醒销售提交）') + '</div>';
  if (!SHIP_SEL || !all.find((x) => x.id === SHIP_SEL)) {
    SHIP_SEL = (all.find((x) => !['已完成', '已终止'].includes(x.status)) || all[0]).id;
  }
  const a = all.find((x) => x.id === SHIP_SEL);
  const batch = a.batch_id ? (S.detail.batches || []).find((b) => b.id === a.batch_id) : null;
  const steps = (S.db.consts.SHIP_STEPS) || [];
  const [cls, stepIdx] = SHIP_STATUS_MAP[a.status] || ['b-gray', 0];
  let html = '';
  if (all.length > 1) {
    html += '<div class="card" style="padding:12px 16px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<b style="font-size:13px;color:var(--gray)">出货批次：</b>' +
      all.sort((x, y) => (x.batch_no || 0) - (y.batch_no || 0)).map((x) =>
        '<button class="btn sm ' + (x.id === a.id ? 'primary' : '') + '" onclick="SHIP_SEL=\'' + x.id + '\';render()">' +
        (x.batch_no ? '第' + x.batch_no + '批' : '单批次') + ' · ' + x.status + '</button>').join('') + '</div></div>';
  }
  html += '<div class="card"><h3>出货审批 · 当前状态 <span class="badge ' + cls + '">' + h(a.status) + '</span>' +
    (batch ? '<span class="badge b-purple">' + h(batch.batch_name) + '</span>' : '') + '</h3>' +
    stepsBar(steps, steps[Math.min(stepIdx, steps.length - 1)], []) +
    '<div style="font-size:13px;color:var(--ink-2);margin-top:6px">约定发货：<b>' + fmtDate(a.agreed_ship_date) + '</b> · 实际发货：<b>' + fmtDate(a.actual_ship_date) + '</b>' +
    ' · 是否分派安装：<b>' + h(a.dispatch_install || '—') + '</b>' +
    (a.feishu_instance_id ? ' · 飞书审批实例：<b>' + h(a.feishu_instance_id) + '</b>' + (a.feishu_synced_at ? '（已同步 ' + fmtDT(a.feishu_synced_at) + '）' : '（本地模式，未真正接入飞书）') : '') + '</div>';
  if (a.status === '已驳回') html += '<div class="exc-panel"><div class="ex-t">' + ico('x', 15) + '审批被驳回</div><div class="ex-log"><b>驳回原因：</b>' + h(a.reject_reason) + '</div></div>';
  html += '<div id="ship-action"></div></div>';

  html += '<div class="card"><h3>审批时间线</h3><div class="appr-steps">' + steps.map((st, i) => {
    const recs = a.steps.filter((s) => s.name === st);
    const done = recs.length > 0;
    const cur = !done && a.steps.length === i;
    return '<div class="appr-step ' + (done ? 'done' : cur ? 'cur' : '') + '"><div class="rail"><div class="nd">' + (done ? '✓' : i + 1) + '</div>' + (i < steps.length - 1 ? '<div class="ln"></div>' : '') + '</div><div class="abody"><div class="an">' + h(st) + '</div>' +
      (done ? recs.map((r) => '<div class="ad">' + fmtDT(r.at) + ' · ' + h(r.by) + (r.note ? ' · ' + h(r.note) : '') + '</div>').join('') : '<div class="ad" style="color:#94a3b8">待处理</div>') + '</div></div>';
  }).join('') + '</div></div>';
  return html;
}
function bindShip() {
  const box = $('#ship-action'); if (!box) return;
  const p = S.detail.project;
  const all = S.db.approvals.filter((x) => x.project_id === p.id);
  const a = all.find((x) => x.id === SHIP_SEL) || all[0];
  if (!a) return;
  const isSales = isA() || (hasCap('sales') && p.sales_id === S.me.id);
  const isProdUser = isA() || hasRole('production');
  const isFinanceReviewer = S.me.id !== 'demo-person-002' && (hasRole('finance') || isA());
  const isManagerReviewer = isA() && !hasRole('finance');
  const batch = a.batch_id ? (S.detail.batches || []).find((b) => b.id === a.batch_id) : null;
  const head = (title, note, style) => '<div class="card" style="' + (style || 'background:#f0f9ff;border-color:#bae6fd') + '"><h3>' + ico('bolt', 17) + title +
    (batch ? '<span class="badge b-purple">' + h(batch.batch_name) + '</span>' : '') + '</h3>' + (note ? '<div class="hint" style="margin:-4px 0 10px">' + note + '</div>' : '');
  const foot = (label) => '<div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px"><button class="btn primary big" id="ship-submit">' + label + '</button></div></div>';

  if (a.status === '待发起' || a.status === '已驳回') {
    if (isSales) {
      box.innerHTML = head(a.status === '已驳回' ? '重新提交出货申请' : '一键提交出货申请', '提交后系统自动按当前项目与本批次数据创建飞书《出货审批》，项目编号 / 客户 / 关联批次 / 出货内容等字段自动带入，无需重复填写。') +
        nodeFormHtml('ship', 'submit', { ...a, ship_customer_name: a.ship_customer_name || p.customer_name,
          ship_customer_phone: a.ship_customer_phone || p.customer_phone, ship_address: a.ship_address || p.address,
          ship_project_no: a.ship_project_no || p.project_no }) + foot(ico('rocket', 16) + ' 提交模拟出货审批');
      mountNodeForm(box);
      bindShipSubmit(a.id, 'submit', () => collectNodeForm(box, 'ship', 'submit'));
    } else box.innerHTML = head('等待销售提交出货申请', '') + '<div class="notice" style="margin:0">等待负责销售提交出货申请</div></div>';
  } else if (a.status === '管理层审批') {
    const financePending = a.finance_paid !== '已收齐';
    if ((financePending && isFinanceReviewer) || (!financePending && isManagerReviewer)) {
      box.innerHTML = head(financePending ? '财务确认尾款' : '演示审批主管审批发货条件',
        financePending ? '财务先核对尾款；未收齐时不会进入发货条件审批。' : '财务已确认尾款收齐，本节点只需确认货物是否达到发货条件。') +
        (financePending ? nodeFormHtml('ship', 'finance_confirm', a) : '<div class="hint">财务确认：已收齐</div>' + nodeFormHtml('ship', 'approve', a)) +
        '<div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px"><button class="btn danger" id="ship-reject">' + ico('x', 15) + ' 驳回</button><button class="btn success big" id="ship-approve">' + ico('check', 15) + (financePending ? ' 保存财务结果' : ' 审批通过') + '</button></div></div>';
      const doAct = async (action, data) => {
        try { await api('/api/ship/' + a.id + '/' + action, { method: 'POST', body: { data } }); await refreshAfterAction(); toast(action === 'finance_confirm' ? '财务结果已保存' : action === 'approve' ? '审批已通过，已通知销售填写出货信息' : '已驳回，已通知销售', 'ok'); }
        catch (e) { toast(e.message, 'err'); }
      };
      $('#ship-approve', box).onclick = () => doAct(financePending ? 'finance_confirm' : 'approve', collectNodeForm(box, 'ship', financePending ? 'finance_confirm' : 'approve'));
      $('#ship-reject', box).onclick = () => { const reason = prompt('请填写驳回原因：'); if (reason) doAct('reject', { reason }); };
    } else box.innerHTML = head('等待审批', '') + '<div class="notice" style="margin:0">' + (financePending ? '等待财务确认尾款' : '等待演示审批主管确认发货条件') + '</div></div>';
  } else if (a.status === '待填出货信息') {
    if (isSales) {
      box.innerHTML = head('填写出货信息', '审批通过后由销售填写。当「客户确认状态 = 已确认」且「约定发货时间」已填写时，系统自动：更新发货安排 / 发送飞书群通知 / 生成出货待办 / 进入待出货 / 按需自动创建安装任务。') +
        (batch ? '<div class="form-grid"><div class="field full"><label>本次出货内容</label>' + inp('ship_content', 'text', batch.ship_content || '') + '</div></div>' : '') +
        nodeFormHtml('ship', 'confirm', a) + foot('保存并进入待出货');
      mountNodeForm(box);
      box.querySelector('#ship-submit').onclick = () => {
        const d = collectNodeForm(box, 'ship', 'confirm');
        const sc = box.querySelector('input[name=ship_content]');
        if (sc) d.ship_content = sc.value;
        (async () => {
          try { await api('/api/ship/' + a.id + '/confirm', { method: 'POST', body: { data: d } }); await refreshAfterAction(); toast('出货信息已保存', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        })();
      };
    } else box.innerHTML = head('等待销售填写出货信息', '') + '<div class="notice" style="margin:0">等待负责销售填写约定发货时间 / 是否分派安装 / 客户确认状态</div></div>';
  } else if (a.status === '待出货') {
    if (isProdUser) {
      const customFields = !batch && S.detail.production ? cfBox('production', '准备出货', S.detail.production.custom || {}) : null;
      box.innerHTML = head('准备出货（发货负责人 演示发货负责人）', '本节点只处理本次出货。当出货状态填「已出货」时，系统自动记录实际发货时间并推进本批次闭环。') +
        nodeFormHtml('ship', 'prepare', a) + (customFields ? '<div class="form-grid">' + customFields.html + '</div>' : '') + foot(ico('truck', 16) + ' 保存出货结果');
      mountNodeForm(box);
      if (customFields) customFields.mount(box);
      bindShipSubmit(a.id, 'prepare', () => {
        const data = collectNodeForm(box, 'ship', 'prepare');
        if (customFields) data.custom = customFields.get();
        return data;
      });
    } else box.innerHTML = head('等待发货负责人安排出货', '') + '<div class="notice" style="margin:0">约定发货时间 ' + fmtDate(a.agreed_ship_date) + '，等待出货负责人处理</div></div>';
  } else if (a.status === '已完成') {
    box.innerHTML = head('本次出货已完成 ✓', '', 'background:#f0fdf4;border-color:#bbf7d0') +
      '<div class="notice" style="margin:0;background:#f0fdf4;border-color:#bbf7d0;color:#15803d">实际发货 ' + fmtDate(a.actual_ship_date) + ' · 出货状态：' + h(a.ship_status || '已出货') + '</div></div>';
  } else {
    box.innerHTML = head('审批已终止', '') + '<div class="notice" style="margin:0">项目已终止，本次出货审批作废</div></div>';
  }
}
function bindShipSubmit(aid, action, getData) {
  const btn = $('#ship-submit'); if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; const old = btn.innerHTML; btn.textContent = '提交中…';
    try { await api('/api/ship/' + aid + '/' + action, { method: 'POST', body: { data: getData() } }); await refreshAfterAction(); toast('操作成功', 'ok'); }
    catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = old; }
  };
}

/* ---------- 安装阶段 ---------- */
function tabInstall() {
  const it = S.detail.install;
  const p = S.detail.project;
  const flow = flowOfType(p.project_type) || {};
  if (!it) return '<div class="card">' + emptyBox(flow.install ? '安装任务尚未创建（出货申请里「是否分派安装 = 是」后才自动创建）' : '该项目类型不走安装流程') + '</div>';
  const stages = installStageList();
  const canOp = canOperateNode(p, 'install', it.status);
  let html = '<div class="card"><h3>安装流程 · 当前节点【' + h(it.status) + '】</h3>' + stepsBar(stages, it.status, it.skipped_stages, { scope: 'install', targets: S.detail.rollback_targets?.install || [] });
  if (p.project_status === '已终止') html += '<div class="notice" style="background:var(--red-l);border-color:#fecaca;color:#b91c1c">项目已终止，安装任务停止</div>';
  else if (it.status === '安装完成') html += '<div class="notice" style="background:var(--green-l);border-color:#bbf7d0;color:#15803d">✓ 安装完成，项目已交付 ' + (it.customer_rating ? starsHtml(it.customer_rating) : '') + '</div>';
  else if (canOp) html += nodeBannerHtml('install', it.status) + '<div id="install-action"></div>';
  else html += '<div class="notice">当前节点由 ' + h(nodeActorsLabel('install', it.status)) + ' 操作</div>';
  html += '</div>';
  // 安装异常
  html += '<div class="card"><h3>' + ico('alert', 17) + '安装异常</h3>';
  if (it.is_exception) html += '<div class="exc-panel"><div class="ex-t">' + dot('var(--red)') + '安装异常（' + fmtDate(it.exception_date) + '）</div><div class="ex-log">' + h(it.exception_desc) + '</div>' +
    (it.exception_file ? '<div style="margin-top:8px;font-size:13px">异常证明：' + fileLink(it.exception_file, '查看') + '</div>' : '') + '</div>';
  else if (it.exception_desc) html += '<div class="notice" style="margin:0">曾有异常（已解决）：' + h(it.exception_desc) + '</div>';
  else html += '<div class="notice" style="margin:0">无安装异常</div>';
  html += '</div>';
  html += '<div class="card"><h3>安装信息</h3><div class="info-grid">' + [
    ['任务编号', it.task_no], ['安装地址', it.install_address || '—'],
    ['确认安装时间', fmtDate(it.confirm_install_date)], ['安装负责人', it.manager_id ? userNameById(it.manager_id) : '—'],
    ['安装人员', it.installer_name || '待派单'], ['派单时间', fmtDate(it.dispatch_date)],
    ['开始安装', fmtDate(it.start_install_date)], ['验收时间', fmtDate(it.accept_date)],
    ['验收结果', it.accept_result || '—'], ['整改说明', it.rectification_desc || '—'],
    ['客户确认状态', it.customer_confirm_status || '—'], ['客户评价', it.customer_rating ? starsHtml(it.customer_rating) : '—'],
    ['实际交付', fmtDate(it.actual_delivery_date)],
  ].map((i) => '<div><div class="k">' + i[0] + '</div><div class="v">' + i[1] + '</div></div>').join('') +
    cfInfoGridHtml('install', it) + '</div>' +
    (it.customer_confirm_file ? '<div style="margin-top:12px;font-size:13.5px">客户确认文件：' + fileLink(it.customer_confirm_file, '查看') + '</div>' : '') +
    savedNodeDataHtml('install', stages, it) + '</div>';
  return html;
}
function bindInstall() {
  const box = $('#install-action'); const it = S.detail.install; if (!box || !it) return;
  const cfb = cfBox('install', it.status, it.custom || {});
  box.innerHTML = '<div class="card" style="background:#faf5ff;border-color:#e9d5ff"><h3>' + ico('bolt', 17) + '完成【' + h(it.status) + '】</h3>' +
    nodeFormHtml('install', it.status, it) + cfb.html +
    '<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn primary big" id="install-submit">提交并进入下一节点 →</button></div></div>';
  mountNodeForm(box);
  cfb.mount(box);
  $('#install-submit', box).onclick = async () => {
    const btn = $('#install-submit', box);
    const data = collectNodeForm(box, 'install', it.status); data.custom = cfb.get();
    btn.disabled = true; btn.textContent = '提交中…';
    try { await api('/api/install/' + it.id + '/advance', { method: 'POST', body: { data } }); await refreshAfterAction(); toast('【' + it.status + '】已完成', 'ok'); }
    catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '提交并进入下一节点 →'; }
  };
}

/* ---------- 售后服务 ---------- */
function tabAftersales(focusId) {
  const list = focusId ? S.detail.aftersales.filter(t => t.id === focusId) : S.detail.aftersales;
  const canCreate = isA() || hasRole('sales') || hasRole('install');
  let html = '<div class="card"><h3>售后工单' + (list.length ? ' <span class="badge b-blue">' + list.length + '</span>' : '') +
    (canCreate ? '<span class="more"><button class="btn sm primary" onclick="openNewAfterSales()">' + ico('plus', 14) + ' 新建售后工单</button></span>' : '') + '</h3>';
  if (!list.length) html += emptyBox('该项目暂无售后工单');
  else html += list.map((t) => {
    const smap = { '待派工': 'b-amber', '待执行': 'b-amber', '执行中': 'b-blue', '已完成': 'b-blue', '已完结': 'b-green', '已结束': 'b-green', '已终止': 'b-gray' };
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b>' + h(t.ticket_no) + '</b><span class="badge ' + (smap[t.status] || 'b-gray') + '">' + h(t.status) + '</span>' +
      (t.customer_rating ? starsHtml(t.customer_rating) : '') + '<span style="margin-left:auto;font-size:12px;color:var(--gray)">申报：' + fmtDate(t.apply_date) + '</span></div>' +
      '<div style="font-size:13.5px;margin:8px 0;color:var(--ink-2)">问题：' + h(t.problem_desc) + '</div>' +
      '<div style="font-size:12.5px;color:var(--gray)">派工：' + h(t.assignee_name || '待派工') + ' · 开始：' + fmtDate(t.start_date) + ' · 完成：' + fmtDate(t.actual_finish_date) + (t.customer_feedback ? ' · 客户反馈：' + h(t.customer_feedback) : '') + '</div>' +
      '<div class="info-grid">' + cfInfoGridHtml('aftersales', t) + '</div>' +
      '<div style="margin-top:10px" id="as-btns-' + t.id + '"></div></div>';
  }).join('');
  html += '</div>';
  return html;
}
function bindAftersales() {
  const list = parseRoute().name === 'project' ? S.detail.aftersales : S.db.aftersales;
  for (const t of list) {
    const box = $('#as-btns-' + t.id); if (!box) continue;
    const canInstall = isA() || hasRole('install');
    const isSales = isA() || hasRole('sales');
    let btn = '';
    if (t.status === '待派工' && canInstall) btn = '<button class="btn sm primary" onclick="advanceAfterSales(\'' + t.id + '\')">派工</button>';
    else if (t.status === '待执行' && canInstall) btn = '<button class="btn sm primary" onclick="advanceAfterSales(\'' + t.id + '\')">开始执行</button>';
    else if (t.status === '执行中' && (canInstall || isSales)) btn = '<button class="btn sm primary" onclick="advanceAfterSales(\'' + t.id + '\')">提交完工</button>';
    else if (t.status === '已完成' && canInstall) btn = '<button class="btn sm primary" onclick="advanceAfterSales(\'' + t.id + '\')">确认完结</button>';
    else if (t.status === '已完结' && (canInstall || isSales)) btn = '<button class="btn sm primary" onclick="advanceAfterSales(\'' + t.id + '\')">客户确认结束</button>';
    if (isA() && !['已结束', '已终止'].includes(t.status)) btn += ' <button class="btn sm danger" onclick="terminateAfterSales(\'' + t.id + '\')">终止</button>';
    box.innerHTML = btn;
  }
}
function advanceAfterSales(id) {
  const list = parseRoute().name === 'project' ? S.detail.aftersales : S.db.aftersales;
  const t = list.find((x) => x.id === id); if (!t) return;
  const customFields = cfBox('aftersales', t.status, t.custom || {});
  const installers = S.db.users.filter((u) => u.active !== false && (u.roles || []).some((role) => groupsMeta().some((group) => group.key === role && (group.caps || []).includes('install')))).map((u) => u.name);
  let fields = [];
  if (t.status === '待派工') fields = [fld('派工人员', sel('assignee_name', installers), 1)];
  else if (t.status === '已完结') fields = [fld('客户评分（1-5星）', starsHtml(5, true), 1), fld('客户评价（可选）', '<textarea name="customer_feedback"></textarea>', 0, 1)];
  openModal('<div class="mhead"><div class="t">处理工单 ' + h(t.ticket_no) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody">' + (fields.length || customFields.defs.length ? '<div class="form-grid">' + fields.join('') + customFields.html + '</div>' : '<div class="notice">确认推进工单到下一状态？</div>') + '</div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="as-adv">确认</button></div>');
  customFields.mount($('.mbody'));
  $('#as-adv').onclick = async () => {
    const button = $('#as-adv'); button.disabled = true;
    try {
      await api('/api/aftersales/' + id + '/advance', { method: 'POST', body: { data: { ...formData($('.mbody')), custom: customFields.get() } } });
      closeModal(); await refreshAfterAction(); toast('工单已推进', 'ok');
    } catch (e) { toast(e.message, 'err'); button.disabled = false; }
  };
}
function openTerminate() {
  const p = S.detail.project; if (!p) return;
  openModal('<div class="mhead"><div class="t">' + ico('alert', 18) + '终止项目 ' + h(p.project_no) + ' · ' + h(p.customer_name) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody"><div class="notice" style="background:var(--red-l);border-color:#fecaca;color:#b91c1c">终止后：设计 / 生产 / 安装任务全部停止，未完成的出货审批作废，项目状态变为「已终止」。<b>此操作不可撤销。</b></div>' +
    '<div class="form-grid">' +
    fld('终止原因（必填）', '<textarea name="reason" placeholder="如：客户取消订单 / 改做其他方案 / 长期联系不上…"></textarea>', 1, 1) +
    fld('确认终止', '<div class="checkline"><input type="checkbox" name="confirm" style="width:17px;height:17px;accent-color:var(--red)"> 我已确认，终止该项目</div>', 1) +
    '</div></div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="pt-do">' + ico('alert', 15) + ' 确认终止</button></div>');
  $('#pt-do').onclick = async () => {
    const d = formData($('.mbody'));
    if (!d.confirm) { toast('请勾选「我已确认」后再终止', 'err'); return; }
    try {
      await api('/api/projects/' + p.id + '/terminate', { method: 'POST', body: { reason: d.reason, confirm: true } });
      closeModal(); await refreshAfterAction(); toast('项目已终止', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
}
async function terminateAfterSales(id) {
  if (!confirm('确认终止该售后工单？（仅管理层）')) return;
  try { await api('/api/aftersales/' + id + '/terminate', { method: 'POST', body: {} }); await refreshAfterAction(); toast('工单已终止', 'ok'); } catch (e) { toast(e.message, 'err'); }
}
function openNewAfterSales() {
  const p = S.detail.project;
  openModal('<div class="mhead"><div class="t">' + ico('plus', 18) + '新建售后工单</div><button class="x">✕</button></div>' +
    '<div class="mbody"><div class="form-grid">' +
    fld('客户姓名', inp('customer_name', 'text', p.customer_name), 1) +
    fld('联系电话', inp('customer_phone', 'tel', p.customer_phone), 1) +
    fld('详细住址', inp('address', 'text', p.address), 1, 1) +
    fld('问题描述', '<textarea name="problem_desc"></textarea>', 1, 1) +
    fld('预计完成时间', inp('expected_finish_date', 'date'), 0) +
    '</div></div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="as-create">创建工单</button></div>');
  $('#as-create').onclick = async () => {
    const d = formData($('.mbody')); d.project_id = p.id;
    try { const r = await api('/api/aftersales', { method: 'POST', body: d }); closeModal(); await refreshAfterAction(); toast('工单 ' + r.ticket_no + ' 已创建，已通知售后负责人', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* ---------- 动态 ---------- */
function tabLogs() {
  const logs = S.detail.logs;
  if (!logs.length) return '<div class="card">' + emptyBox('暂无操作记录') + '</div>';
  return '<div class="card"><h3>操作动态（全流程留痕）</h3><div class="timeline">' +
    logs.map((l) => '<div class="tl-item hot"><div style="white-space:pre-wrap">' + h(l.text) + '</div><div class="tl-meta">' + fmtDT(l.at) + ' · ' + h(l.by) + '</div></div>').join('') +
    '</div></div>';
}

/* ---------- 绑定与刷新 ---------- */
function bindProjectTab(tab) {
  mountCfPanels();  // 先挂「附加字段」面板（文件控件 + 保存按钮）
  if (tab === 'design') bindDesign();
  else if (tab === 'production') { bindPurchase(); bindProduction(); }
  else if (tab === 'purchase') bindPurchase();
  else if (tab === 'ship') bindShip();
  else if (tab === 'install') bindInstall();
  else if (tab === 'aftersales') bindAftersales();
}
async function refreshAfterAction() {
  await loadBootstrap();
  const route = parseRoute();
  if (route.name === 'project') await viewProject(route);
  else await render();
  window.scrollTo(0, 0);
}
