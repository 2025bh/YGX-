'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const control = require('./workflow-control');
const spec = require('./spec');

async function main() {
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };
  check('未齐货不能派单', () => assert.equal(control.readyForInstallation({ batch_flow: true, batches_finalized: true }, [{ status: '已出货' }, { status: '生产完成' }]), false));
  check('未声明批次建齐不能派单', () => assert.equal(control.readyForInstallation({ batch_flow: true }, [{ status: '已出货' }]), false));
  check('已建齐且有效批次全出货可派单', () => assert.equal(control.readyForInstallation({ batch_flow: true, batches_finalized: true }, [{ status: '已出货' }, { valid: false }]), true));
  check('跳过节点不作为退回目标', () => assert.equal(control.previousStage(['a','b','c'], 'c', ['b']), 'a'));
  check('不合格验收不能推进', () => assert.ok(control.completionError('install', '验收确认', { accept_result: '不合格' })));
  check('客户有异议不能完结', () => assert.ok(control.completionError('install', '客户确认', { customer_confirm_status: '有异议' })));
  check('外购不需要无需入库日期', () => assert.equal(spec.fieldsFor('production', '外购入库').find(f => f.key === 'purchase_arrival_date').required, false));
  check('生产日期节点无今天默认值且分批选择必填', () => {
    for (const fields of Object.values(spec.NODE_FIELDS.production)) {
      for (const field of fields.filter(f => f.type === 'date')) assert.notEqual(field.default, 'today', field.label);
    }
    assert.equal(spec.fieldsFor('production', '材料到场').find(f => f.key === 'is_batch').required, true);
  });
  check('旧版本拒绝覆盖', () => assert.throws(() => control.assertCurrent({ status: 'a', updated_at: '2' }, { expected_status: 'a', expected_updated_at: '1' })));
  check('初稿确认字段按主流程表', () => assert.deepEqual(spec.fieldsFor('design', '初稿客户确认').map(f => f.label), ['初量尺报价表', '客户确认状态', '备注']));
  check('量尺人员为排除演示老板的多人字段', () => {
    const f = spec.fieldsFor('design', '上门量尺').find(x => x.key === 'measure_person');
    assert.equal(f.type, 'users'); assert.deepEqual(f.excludeNames, ['演示老板']);
  });
  check('五版图纸与三种确认状态', () => {
    assert.equal(spec.fieldsFor('design', '初稿图纸制作').find(f => f.key === 'drawing_version').options.length, 5);
    assert.deepEqual(spec.fieldsFor('design', '客户最终确认').find(f => f.key === 'customer_confirm_status').options, ['正在确认', '方案确认', '修改图纸']);
  });
  check('板式在木工后跳过打磨油漆外购', () => assert.deepEqual(spec.FLOW.BS.prodSkip['木工制作'], ['原件打磨', '油漆喷刷', '外购入库']));
  const port = 8500 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: 'test-' + Date.now() }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  const base = 'http://127.0.0.1:' + port;
  let cookie = '';
  async function request(url, body) {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { code: response.status, body: await response.json() };
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready, output);
    assert.equal((await request('/api/login', { username: 'demo_owner', password: '123456' })).code, 200);
    const boot = (await request('/api/bootstrap')).body;
    for (const name of ['演示开料负责人', '演示财务', '演示安装负责人', '演示管理员']) assert.ok(boot.users.some(u => u.name === name));
    assert.ok(boot.users.some(u => u.name === '演示管理员' && u.roles.includes('admin'))); checks.push('Word点名人员和演示管理员进入演示目录');
    assert.equal((await request('/api/staff/update', { id: 'demo-person-010', allow_zoom: true })).body.user.allow_zoom, true);
    checks.push('管理员可指定允许手机放大的人员');
    const design = boot.design.find(d => d.status === '上门量尺') || boot.design.find(d => d.status !== '设计完成');
    assert.ok(design);
    const before = await request('/api/projects/' + design.project_id);
    const rec = before.body.design;
    const field = spec.fieldsFor('design', rec.status).find(f => f.type === 'date');
    const payload = { expected_status: rec.status, expected_updated_at: rec.updated_at, data: { [field.key]: '2026-09-23' } };
    assert.equal((await request('/api/design/' + rec.id + '/save', payload)).code, 200);
    const after = (await request('/api/projects/' + rec.project_id)).body;
    assert.equal(after.design.status, rec.status); assert.equal(after.design[field.col], '2026-09-23'); checks.push('HTTP部分保存不推进');
    assert.equal((await request('/api/design/' + rec.id + '/save', payload)).code, 409); checks.push('HTTP旧版本保存拒绝');
    assert.equal((await request('/api/config', { feishu_app_id: 'blocked' })).code, 403); checks.push('隔离版禁止真实配置');
    const complete = boot.design.find(d => d.status === '设计完成' && boot.production.some(t => t.project_id === d.project_id));
    const item = (await request('/api/projects/' + complete.project_id)).body;
    assert.equal((await request('/api/design/' + complete.id + '/rollback', { expected_status: complete.status, expected_updated_at: complete.updated_at, reason: '测试图纸变更', target: spec.designStagesFor(item.project.project_type).slice(0, -1).at(-1) })).code, 200);
    const paused = (await request('/api/projects/' + complete.project_id)).body;
    assert.equal(paused.production.paused_by, complete.id); checks.push('退回暂停下游并保留生产资料');
    assert.equal((await request('/api/projects/' + complete.project_id + '/resume-downstream', { reason: '提前恢复测试' })).code, 409); checks.push('上游未完成拒绝恢复');
    const adminCookie = cookie;
    await request('/api/login', { username: 'demo_sales_5', password: '123456' });
    assert.equal((await request('/api/design/' + complete.id + '/save', { expected_status: paused.design.status, expected_updated_at: paused.design.updated_at, data: { remark: '越权' } })).code, 403); checks.push('非负责人越权拒绝');
    cookie = adminCookie;
    const upload = await fetch(base + '/api/upload?name=demo-test.txt', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'Synthetic workflow test only' });
    const file = await upload.json(); assert.ok(file.id);
    const corrected = {};
    for (const f of spec.fieldsFor('design', paused.design.status)) {
      if (f.type === 'date') corrected[f.key] = '2026-09-23';
      if (f.type === 'file') corrected[f.key] = file.id;
    }
    assert.equal((await request('/api/design/' + complete.id + '/advance', { expected_status: paused.design.status, expected_updated_at: paused.design.updated_at, data: corrected })).code, 200);
    assert.equal((await request('/api/projects/' + complete.project_id + '/resume-downstream', { reason: '测试重新确认通过' })).code, 200); checks.push('补正完成后可恢复下游');
    const batchTask = boot.production.find(t => t.batch_flow);
    const approval = boot.approvals.find(a => a.project_id === batchTask.project_id && a.status === '待发起');
    assert.equal((await request('/api/production/' + batchTask.id + '/batches', {})).code, 200);
    const batchProject = boot.projects.find(p => p.id === batchTask.project_id);
    const submit = { ship_doc: file.id, address_verified: true, phone_verified: true, name_verified: true, no_verified: true, is_multi_batch: '是',
      ship_customer_name: batchProject.customer_name, ship_customer_phone: batchProject.customer_phone || '00000000000',
      ship_address: batchProject.address, ship_project_no: batchProject.project_no };
    assert.equal((await request('/api/ship/' + approval.id + '/submit', { data: submit })).code, 200);
    await request('/api/login', { username: 'demo_approver', password: '123456' });
    assert.equal((await request('/api/bootstrap')).body.stats.todos.filter(t => t.id === approval.id && t.text.includes('演示审批主管审批')).length, 0);
    assert.equal((await request('/api/ship/' + approval.id + '/finance_confirm', { data: { finance_paid: '已收齐' } })).code, 403);
    assert.equal((await request('/api/ship/' + approval.id + '/approve', { data: { ship_condition_ok: '达到发货条件' } })).code, 409);
    checks.push('演示审批主管不能填写财务尾款或越过财务审批');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    assert.equal((await request('/api/ship/' + approval.id + '/finance_confirm', { data: { finance_paid: '已收齐' } })).code, 200);
    await request('/api/login', { username: 'demo_approver', password: '123456' });
    assert.equal((await request('/api/bootstrap')).body.stats.todos.filter(t => t.id === approval.id && t.text.includes('演示审批主管审批')).length, 1);
    assert.equal((await request('/api/ship/' + approval.id + '/approve', { data: { ship_condition_ok: '未达到' } })).code, 409);
    assert.equal((await request('/api/ship/' + approval.id + '/approve', { data: { ship_condition_ok: '达到发货条件' } })).code, 200);
    checks.push('财务确认后演示审批主管出现审批待办且只填发货条件');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    assert.equal((await request('/api/ship/' + approval.id + '/confirm', { data: { agreed_ship_date: '2026-12-01', dispatch_install: '是', customer_confirm_status: '已确认' } })).code, 200);
    assert.ok(!(await request('/api/projects/' + batchTask.project_id)).body.install); checks.push('仅约定发货不提前建安装');
    assert.equal((await request('/api/ship/' + approval.id + '/prepare', { data: { actual_ship_date: '2026-12-01', ship_status: '已出货' } })).code, 200);
    const shipped = (await request('/api/projects/' + batchTask.project_id)).body;
    assert.ok(shipped.install); checks.push('首批实际发货建立安装档案');
    const it = shipped.install;
    assert.equal((await request('/api/install/' + it.id + '/advance', { expected_status: it.status, expected_updated_at: it.updated_at, data: { install_address: '虚构地址', confirm_install_date: '2026-12-02' } })).code, 200);
    const readyInstall = (await request('/api/projects/' + batchTask.project_id)).body.install;
    assert.equal((await request('/api/install/' + it.id + '/advance', { expected_status: readyInstall.status, expected_updated_at: readyInstall.updated_at, data: { dispatch_date: '2026-12-02', manager_id: 'demo-person-002', installer_name: '演示安装员' } })).code, 409); checks.push('HTTP未齐货不能安装派单');
    assert.equal((await request('/api/ship/' + approval.id + '/prepare', { data: { actual_ship_date: '2026-12-01', ship_status: '已出货' } })).code, 400); checks.push('重复发货不重复创建安装');
    const created = (await request('/api/projects', { project_type: 'DZ', customer_name: '虚构回退测试', customer_phone: '00000000000', address: '虚构地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004' })).body;
    assert.ok(created.id);
    let testDesign = (await request('/api/projects/' + created.id)).body.design;
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: testDesign.status, expected_updated_at: testDesign.updated_at,
      data: { designer_id: 'demo-person-010', assign_date: '2026-09-23', intent_deposit_date: '2026-09-23' } })).code, 200);
    await request('/api/login', { username: 'demo_designer_1', password: '123456' });
    testDesign = (await request('/api/projects/' + created.id)).body.design;
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: testDesign.status, expected_updated_at: testDesign.updated_at,
      data: { measure_date: '2026-09-23', measure_person: 'demo-person-010,demo-person-004' } })).code, 200);
    testDesign = (await request('/api/projects/' + created.id)).body.design;
    assert.equal((await request('/api/design/' + testDesign.id + '/save', { expected_status: testDesign.status, expected_updated_at: testDesign.updated_at,
      data: { draft_drawings: file.id, draft_complete_date: '2026-09-23' } })).code, 200);
    testDesign = (await request('/api/projects/' + created.id)).body.design;
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: testDesign.status, expected_updated_at: testDesign.updated_at,
      data: { draft_drawings: file.id, draft_complete_date: '2026-09-23' } })).code, 200);
    let projectView = (await request('/api/projects/' + created.id)).body;
    assert.ok(projectView.rollback_targets.design.includes('初稿图纸制作'));
    assert.equal((await request('/api/design/' + testDesign.id + '/rollback', { expected_status: projectView.design.status,
      expected_updated_at: projectView.design.updated_at, target: '初稿图纸制作', reason: '销售确认前修改图纸' })).code, 200);
    checks.push('设计师点击节点退回正在确认的前一节点');
    projectView = (await request('/api/projects/' + created.id)).body;
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: projectView.design.status,
      expected_updated_at: projectView.design.updated_at, data: { draft_drawings: file.id, draft_complete_date: '2026-09-23' } })).code, 200);
    projectView = (await request('/api/projects/' + created.id)).body;
    assert.equal(projectView.design.rollback_pending, true);
    assert.equal(projectView.design.rollback_recover_stage, '初稿客户确认');
    checks.push('多节点退回未走回原节点前仍保持待补正');
    await request('/api/login', { username: 'demo_sales_1', password: '123456' });
    projectView = (await request('/api/projects/' + created.id)).body;
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: projectView.design.status,
      expected_updated_at: projectView.design.updated_at, data: { customer_confirm_status: '方案确认' } })).code, 400);
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: projectView.design.status,
      expected_updated_at: projectView.design.updated_at, data: { initial_quotation: file.id, customer_confirm_status: '正在确认' } })).code, 400);
    checks.push('初量尺报价表必填且正在确认不能推进');
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', { expected_status: projectView.design.status,
      expected_updated_at: projectView.design.updated_at,
      data: { initial_quotation: file.id, customer_confirm_status: '方案确认' } })).code, 200);
    projectView = (await request('/api/projects/' + created.id)).body;
    assert.equal(projectView.design.rollback_pending, false);
    checks.push('原确认节点重做完成后才解除待补正');
    await request('/api/login', { username: 'demo_designer_1', password: '123456' });
    projectView = (await request('/api/projects/' + created.id)).body;
    assert.ok(!projectView.rollback_targets.design.includes('初稿图纸制作'));
    assert.equal((await request('/api/design/' + testDesign.id + '/rollback', { expected_status: projectView.design.status,
      expected_updated_at: projectView.design.updated_at, target: '初稿图纸制作', reason: '越过销售节点' })).code, 403);
    checks.push('销售确认完成后设计师不能跨岗位回退');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    projectView = (await request('/api/projects/' + created.id)).body;
    const originalRecovery = projectView.design.status;
    const rollbackCount = (projectView.design.node_history || []).length;
    for (const target of ['初稿客户确认', '初稿图纸制作', '上门量尺']) {
      assert.ok(projectView.rollback_targets.design.includes(target), target);
      const result = await request('/api/design/' + testDesign.id + '/rollback', {
        expected_status: projectView.design.status, expected_updated_at: projectView.design.updated_at,
        target, reason: '管理员连续退回复核' + target,
      });
      assert.equal(result.code, 200, JSON.stringify(result.body));
      projectView = (await request('/api/projects/' + created.id)).body;
      assert.equal(projectView.design.status, target);
      assert.equal(projectView.design.rollback_recover_stage, originalRecovery);
      assert.equal(projectView.design.rollback_pending, true);
      assert.equal(projectView.design.draft_drawings, file.id);
      assert.equal(projectView.design.initial_quotation, file.id);
      assert.equal(projectView.design.measure_date, '2026-09-23');
    }
    assert.equal(projectView.design.node_history.length, rollbackCount + 3);
    assert.equal(projectView.design.node_values['初稿图纸制作'].draft_drawings, file.id);
    assert.equal(projectView.design.node_values['初稿客户确认'].initial_quotation, file.id);
    const oldFile = await fetch(base + '/api/files/' + file.id, { headers: { cookie } });
    assert.equal(oldFile.status, 200);
    assert.equal(await oldFile.text(), 'Synthetic workflow test only');
    checks.push('管理员可连续三次退回且原字段附件及退回历史保留');
    const quoteProject = (await request('/api/projects', { project_type: 'QC', customer_name: '虚构报价权限测试',
      customer_phone: '00000000000', address: '虚构地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004' })).body;
    assert.ok(quoteProject.id);
    const quoteUpload = await fetch(base + '/api/upload?name=final-quote.txt', {
      method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'Private synthetic final quotation',
    });
    const quoteFile = await quoteUpload.json();
    assert.ok(quoteFile.id);
    const quoteDesign = (await request('/api/projects/' + quoteProject.id)).body.design;
    assert.equal((await request('/api/design/' + quoteDesign.id + '/save', { expected_status: quoteDesign.status,
      expected_updated_at: quoteDesign.updated_at, data: { quotation: quoteFile.id } })).code, 200);
    const savedQuote = (await request('/api/projects/' + quoteProject.id)).body.design;
    assert.equal((await request('/api/design/' + quoteDesign.id + '/advance', { expected_status: savedQuote.status,
      expected_updated_at: savedQuote.updated_at, data: { quotation: quoteFile.id, contract_amount: 100,
        expected_delivery_date: '2026-12-01', customer_confirm_status: '方案确认' } })).code, 200);
    const completedQuote = (await request('/api/projects/' + quoteProject.id)).body.design;
    assert.equal((await request('/api/design/' + quoteDesign.id + '/rollback', { expected_status: completedQuote.status,
      expected_updated_at: completedQuote.updated_at, target: '客户最终确认', reason: '核对报价历史权限' })).code, 200);
    await request('/api/login', { username: 'demo_sales_1', password: '123456' });
    const salesQuote = (await request('/api/projects/' + quoteProject.id)).body;
    assert.equal(salesQuote.design.quotation, quoteFile.id);
    assert.equal((await fetch(base + '/api/files/' + quoteFile.id, { headers: { cookie } })).status, 200);
    await request('/api/login', { username: 'demo_wood', password: '123456' });
    const otherQuote = (await request('/api/projects/' + quoteProject.id)).body;
    assert.equal(otherQuote.can_view_final_quotation, false);
    assert.equal(otherQuote.design.quotation, undefined);
    assert.equal(otherQuote.design.node_values?.['客户最终确认']?.quotation, undefined);
    assert.equal(otherQuote.design.node_history[0].snapshot.quotation, undefined);
    assert.equal(otherQuote.design.node_history[0].snapshot.node_values?.['客户最终确认']?.quotation, undefined);
    const nonOwnerBoot = (await request('/api/bootstrap')).body;
    assert.equal(nonOwnerBoot.design.find(item => item.project_id === quoteProject.id).quotation, undefined);
    assert.equal((await fetch(base + '/api/files/' + quoteFile.id, { headers: { cookie } })).status, 403);
    await request('/api/login', { username: 'demo_designer_1', password: '123456' });
    const initialQuote = (await request('/api/projects/' + created.id)).body.design;
    assert.equal(initialQuote.initial_quotation, file.id);
    assert.equal((await fetch(base + '/api/files/' + file.id, { headers: { cookie } })).status, 200);
    checks.push('最终报价文件仅负责销售和管理员可见，初量尺报价表照常可见');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    assert.equal((await fetch(base + '/api/files/' + quoteFile.id, { headers: { cookie } })).status, 200);
    assert.equal((await request('/api/design/' + testDesign.id + '/advance', {
      expected_status: projectView.design.status, expected_updated_at: projectView.design.updated_at,
      data: { measure_date: '2026-09-23', measure_person: 'demo-person-010,demo-person-004' },
    })).code, 200);
    projectView = (await request('/api/projects/' + created.id)).body;
    const secondUpload = await fetch(base + '/api/upload?name=demo-revision.txt', {
      method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'Synthetic revised drawing',
    });
    const revisedFile = await secondUpload.json();
    assert.ok(revisedFile.id);
    assert.equal((await request('/api/design/' + testDesign.id + '/save', {
      expected_status: projectView.design.status, expected_updated_at: projectView.design.updated_at,
      data: { draft_drawings: revisedFile.id, draft_complete_date: '2026-09-23' },
    })).code, 200);
    projectView = (await request('/api/projects/' + created.id)).body;
    assert.equal(projectView.design.node_values['初稿图纸制作'].draft_drawings, revisedFile.id);
    assert.ok(projectView.design.file_history.some(item => item.file_id === file.id && item.stage === '初稿图纸制作'));
    assert.equal(projectView.design.rollback_recover_stage, originalRecovery);
    checks.push('重传图纸后旧附件进入可查看历史且原补正范围保留');
    const batchBefore = (await request('/api/projects/' + batchTask.project_id)).body;
    const shippedBatch = batchBefore.batches.find(b => b.status === '已出货');
    assert.ok(shippedBatch);
    const completedApprovalIds = batchBefore.approvals.filter(a => a.status === '已完成').map(a => a.id);
    assert.ok(batchBefore.production.batch_flow);
    assert.equal((await request('/api/production/' + batchBefore.production.id + '/rollback', {
      expected_status: batchBefore.production.status, expected_updated_at: batchBefore.production.updated_at,
      target: '下单备料', reason: '管理员复核分批主生产资料',
    })).code, 200);
    let batchReopened = (await request('/api/projects/' + batchTask.project_id)).body;
    assert.equal(batchReopened.production.batch_flow, false);
    assert.equal(batchReopened.batches.length, batchBefore.batches.length);
    assert.equal(batchReopened.batches.find(b => b.id === shippedBatch.id).status, '已出货');
    assert.ok(completedApprovalIds.every(id => batchReopened.approvals.some(a => a.id === id && a.status === '已完成')));
    assert.ok(batchReopened.batches.every(b => b.paused_by === batchBefore.production.id));
    checks.push('管理员退回分批主生产时保留已发货事实与原审批并暂停批次');
    const manager = batchReopened.production.production_manager_id;
    assert.equal((await request('/api/production/' + batchReopened.production.id + '/advance', {
      expected_status: batchReopened.production.status, expected_updated_at: batchReopened.production.updated_at,
      data: { material_order_status: '已下单', material_order_date: '2026-09-23', production_manager_id: manager },
    })).code, 200);
    batchReopened = (await request('/api/projects/' + batchTask.project_id)).body;
    const arrival = { wood_arrival_date: '2026-09-23', material_arrival_status: '部分材料到场',
      cutting_start_date: '2026-09-23', is_exception: '否', is_batch: '否' };
    assert.equal((await request('/api/production/' + batchReopened.production.id + '/advance', {
      expected_status: batchReopened.production.status, expected_updated_at: batchReopened.production.updated_at, data: arrival,
    })).code, 409);
    batchReopened = (await request('/api/projects/' + batchTask.project_id)).body;
    assert.equal((await request('/api/production/' + batchReopened.production.id + '/advance', {
      expected_status: batchReopened.production.status, expected_updated_at: batchReopened.production.updated_at,
      data: { ...arrival, is_batch: '是' },
    })).code, 200);
    batchReopened = (await request('/api/projects/' + batchTask.project_id)).body;
    assert.equal(batchReopened.production.batch_flow, true);
    assert.equal(batchReopened.production.rollback_pending, false);
    assert.equal(batchReopened.batches.length, batchBefore.batches.length);
    checks.push('分批主生产补正后沿用原批次，不可改为非分批或重复建批');
    let shippedCorrection = batchReopened.batches.find(b => b.id === shippedBatch.id);
    const originalShipment = { status: shippedCorrection.status, ship_status: shippedCorrection.ship_status,
      actual_ship_date: shippedCorrection.actual_ship_date, approval_ids: completedApprovalIds };
    for (const date of ['2026-01-01', '2026-01-02']) {
      const correctedBatch = await request('/api/batches/' + shippedBatch.id + '/correct', {
        stage: '开料/木工/打磨', reason: '管理员核实历史木工日期',
        expected_step: shippedCorrection.step, expected_updated_at: shippedCorrection.updated_at,
        data: { woodwork_complete_date: date },
      });
      assert.equal(correctedBatch.code, 200, JSON.stringify(correctedBatch.body));
      batchReopened = (await request('/api/projects/' + batchTask.project_id)).body;
      shippedCorrection = batchReopened.batches.find(b => b.id === shippedBatch.id);
      assert.equal(shippedCorrection.woodwork_complete_date, date);
      assert.equal(shippedCorrection.status, originalShipment.status);
      assert.equal(shippedCorrection.ship_status, originalShipment.ship_status);
      assert.equal(shippedCorrection.actual_ship_date, originalShipment.actual_ship_date);
      assert.ok(originalShipment.approval_ids.every(id => batchReopened.approvals.some(a => a.id === id && a.status === '已完成')));
    }
    assert.equal(shippedCorrection.correction_history.length, 2);
    assert.equal(shippedCorrection.correction_history[1].changes[0].old, '2026-01-01');
    checks.push('已发货批次可反复补正历史节点，旧值与实际发货审批均保留');
    await request('/api/login', { username: 'demo_wood', password: '123456' });
    assert.equal((await request('/api/batches/' + shippedBatch.id + '/correct', {
      stage: '开料/木工/打磨', reason: '越权补正', expected_step: shippedCorrection.step,
      expected_updated_at: shippedCorrection.updated_at, data: { woodwork_complete_date: '2026-01-03' },
    })).code, 403);
    checks.push('非管理员不能补正已发货批次历史资料');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    const parallelProject = boot.projects.find(p => p.project_type === 'WJ' && boot.production.some(t => t.project_id === p.id && t.status === '木工制作'));
    assert.ok(parallelProject);
    let parallel = (await request('/api/projects/' + parallelProject.id)).body.production;
    const advanceParallel = async data => {
      const response = await request('/api/production/' + parallel.id + '/advance', {
        expected_status: parallel.status, expected_updated_at: parallel.updated_at, data,
      });
      assert.equal(response.code, 200, JSON.stringify(response.body));
      parallel = (await request('/api/projects/' + parallelProject.id)).body.production;
    };
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    await advanceParallel({ woodwork_complete_date: '2026-09-23', is_exception: '否' });
    assert.equal(parallel.status, '原件打磨');
    await request('/api/login', { username: 'demo_purchase', password: '123456' });
    const purchaseTodos = async () => (await request('/api/bootstrap')).body.stats.todos.filter(t => t.type === 'purchase' && t.project_id === parallelProject.id);
    assert.equal((await purchaseTodos()).length, 1); checks.push('打磨开始即给演示采购负责人一条外购待办');
    assert.equal((await request('/api/production/' + parallel.id + '/purchase', {
      action: 'save', expected_status: parallel.status, expected_updated_at: parallel.updated_at,
      data: { purchase_order_status: '已下单' },
    })).code, 200);
    parallel = (await request('/api/projects/' + parallelProject.id)).body.production;
    assert.equal(parallel.status, '原件打磨'); checks.push('外购从打磨阶段独立保存，不推进主生产节点');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    await advanceParallel({ polishing_complete_date: '2026-09-23', is_exception: '否' });
    await advanceParallel({ painting_complete_date: '2026-09-23', is_exception: '否' });
    assert.equal(parallel.status, '组装打包'); checks.push('油漆完成可越过并行外购进入组装打包');
    await request('/api/login', { username: 'demo_purchase', password: '123456' });
    assert.equal((await purchaseTodos()).length, 1); checks.push('油漆和组装期间外购待办不丢失');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    await advanceParallel({ assembly_complete_date: '2026-09-23', packaging_complete_date: '2026-09-23', is_exception: '否' });
    assert.ok(parallel.packaging_done_at);
    assert.equal(parallel.status, '组装打包');
    assert.equal((await request('/api/projects/' + parallelProject.id)).body.approvals.length, 0);
    assert.equal((await purchaseTodos()).length, 1);
    checks.push('外购未完成时打包完成不提前生成出货申请');
    await request('/api/login', { username: 'demo_purchase', password: '123456' });
    assert.equal((await request('/api/production/' + parallel.id + '/purchase', {
      action: 'save', expected_status: parallel.status, expected_updated_at: parallel.updated_at,
      data: { purchase_order_status: '已入库', purchase_arrival_date: '2026-09-23' },
    })).code, 200);
    parallel = (await request('/api/projects/' + parallelProject.id)).body.production;
    assert.equal(parallel.status, '组装打包');
    assert.equal((await request('/api/projects/' + parallelProject.id)).body.approvals.length, 0);
    checks.push('只保存已入库状态不能代替完成外购');
    let purchaseResult = await request('/api/production/' + parallel.id + '/purchase', {
      action: 'complete', expected_status: parallel.status, expected_updated_at: parallel.updated_at,
      data: { purchase_order_status: '已入库', purchase_arrival_date: '2026-09-23' },
    });
    assert.equal(purchaseResult.code, 200, JSON.stringify(purchaseResult.body));
    let parallelDone = (await request('/api/projects/' + parallelProject.id)).body;
    assert.equal(parallelDone.production.status, '出货申请');
    assert.equal(parallelDone.approvals.length, 1);
    assert.equal((await purchaseTodos()).length, 0); checks.push('外购完成后待办消失');
    checks.push('外购完成后进入出货申请且只创建一张审批单');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    const purchaseBefore = parallelDone.production.purchase_completed_at;
    const approvalBefore = parallelDone.approvals[0].id;
    const correction = await request('/api/production/' + parallel.id + '/purchase-correct', {
      expected_status: parallelDone.production.status, expected_updated_at: parallelDone.production.updated_at,
      reason: '核对外购到货日期', data: { purchase_order_status: '已入库', purchase_arrival_date: '2026-09-24' },
    });
    assert.equal(correction.code, 200, JSON.stringify(correction.body));
    parallelDone = (await request('/api/projects/' + parallelProject.id)).body;
    assert.equal(parallelDone.production.purchase_arrival_date, '2026-09-24');
    assert.equal(parallelDone.production.purchase_completed_at, purchaseBefore);
    assert.equal(parallelDone.approvals[0].id, approvalBefore);
    assert.equal(parallelDone.production.status, '出货申请');
    assert.equal(parallelDone.production.purchase_corrections.length, 1);
    checks.push('管理员可补正外购资料，保留完成事实和原出货申请');
    await request('/api/login', { username: 'demo_purchase', password: '123456' });
    assert.equal((await request('/api/production/' + parallel.id + '/purchase-correct', {
      expected_status: parallelDone.production.status, expected_updated_at: parallelDone.production.updated_at,
      reason: '非管理员尝试补正', data: { purchase_order_status: '已入库', purchase_arrival_date: '2026-09-25' },
    })).code, 403);
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    checks.push('普通外购岗位不能调用管理员补正接口');
    assert.equal((await request('/api/production/' + parallel.id + '/purchase-correct', {
      expected_status: parallelDone.production.status, expected_updated_at: parallelDone.production.updated_at,
      reason: '没有变化', data: { purchase_order_status: '已入库', purchase_arrival_date: '2026-09-24' },
    })).code, 400);
    checks.push('无变化的外购补正被拒绝');
    assert.equal((await request('/api/production/' + parallel.id + '/purchase-correct', {
      expected_status: parallelDone.production.status, expected_updated_at: parallelDone.production.updated_at,
      reason: '外购核实为不需要', data: { purchase_order_status: '不需要' },
    })).code, 200);
    parallelDone = (await request('/api/projects/' + parallelProject.id)).body;
    assert.equal(parallelDone.production.purchase_arrival_date, '');
    assert.equal(parallelDone.production.node_values['外购入库'].purchase_arrival_date, '');
    assert.equal(parallelDone.production.purchase_corrections.at(-1).changes.find(item => item.field === '外购入库时间').old, '2026-09-24');
    assert.equal(parallelDone.approvals[0].id, approvalBefore);
    checks.push('外购改为不需要时日期当前值清空但旧值留在补正历史');
    purchaseResult = await request('/api/production/' + parallel.id + '/purchase', {
      action: 'complete', expected_status: parallelDone.production.status, expected_updated_at: parallelDone.production.updated_at,
      data: { purchase_order_status: '已入库', purchase_arrival_date: '2026-09-23' },
    });
    assert.equal(purchaseResult.code, 409);
    checks.push('出货审批处理中拒绝重复完成外购');
    await request('/api/login', { username: 'demo_wood', password: '123456' });
    const productionProject = boot.projects.find(p => boot.production.some(t => t.project_id === p.id && t.status === '木工制作'));
    projectView = (await request('/api/projects/' + productionProject.id)).body;
    assert.ok(projectView.rollback_targets.production.includes('生产开料'));
    assert.equal((await request('/api/production/' + projectView.production.id + '/rollback', {
      expected_status: projectView.production.status, expected_updated_at: projectView.production.updated_at,
      target: '生产开料', reason: '木工复核开料资料' })).code, 200);
    checks.push('木工可点击生产历史节点退回');
    await request('/api/login', { username: 'demo_owner', password: '123456' });
    projectView = (await request('/api/projects/' + productionProject.id)).body;
    assert.ok(projectView.rollback_targets.production.includes('材料到场'));
    assert.equal((await request('/api/production/' + projectView.production.id + '/rollback', {
      expected_status: projectView.production.status, expected_updated_at: projectView.production.updated_at,
      target: '材料到场', reason: '管理员继续核查材料到场记录' })).code, 200);
    projectView = (await request('/api/projects/' + productionProject.id)).body;
    assert.equal(projectView.production.rollback_recover_stage, '木工制作');
    assert.ok(projectView.production.wood_arrival_date);
    checks.push('管理员可接着退回主生产且材料数据保留');
    assert.equal((await request('/api/production/' + projectView.production.id + '/advance', {
      expected_status: projectView.production.status, expected_updated_at: projectView.production.updated_at,
      data: { wood_arrival_date: '2026-09-23', material_arrival_status: '全部材料到场',
        cutting_start_date: '2026-09-23', is_exception: '否', is_batch: '' },
    })).code, 400);
    assert.equal((await request('/api/projects/' + productionProject.id)).body.production.status, '材料到场');
    checks.push('未选择是否分批次制作不能进入下一节点');
    const installProject = boot.projects.find(p => boot.installations.some(t => t.project_id === p.id && t.status === '正在安装'));
    projectView = (await request('/api/projects/' + installProject.id)).body;
    assert.equal((await request('/api/install/' + projectView.install.id + '/save', {
      expected_status: projectView.install.status, expected_updated_at: projectView.install.updated_at,
      data: { exception_file: file.id, remark: '安装现场已拍照' },
    })).code, 200);
    projectView = (await request('/api/projects/' + installProject.id)).body;
    assert.ok(projectView.rollback_targets.install.includes('安装派单'));
    assert.equal((await request('/api/install/' + projectView.install.id + '/rollback', {
      expected_status: projectView.install.status, expected_updated_at: projectView.install.updated_at,
      target: '安装派单', reason: '安装派单信息复核' })).code, 200);
    checks.push('管理员可点击安装历史节点退回');
    projectView = (await request('/api/projects/' + installProject.id)).body;
    assert.ok(projectView.rollback_targets.install.includes('安装确认'));
    assert.equal((await request('/api/install/' + projectView.install.id + '/rollback', {
      expected_status: projectView.install.status, expected_updated_at: projectView.install.updated_at,
      target: '安装确认', reason: '管理员继续核查安装地址' })).code, 200);
    projectView = (await request('/api/projects/' + installProject.id)).body;
    assert.equal(projectView.install.exception_file, file.id);
    assert.equal(projectView.install.node_values['正在安装'].remark, '安装现场已拍照');
    assert.equal(projectView.install.rollback_recover_stage, '正在安装');
    checks.push('管理员可连续退回安装且现场附件与备注保留');
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
    fs.mkdirSync(path.join(__dirname, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'test-results', 'workflow-' + Date.now() + '.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally { child.kill(); await once(child, 'exit'); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
