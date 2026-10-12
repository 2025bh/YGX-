const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const port = 8800 + Math.floor(Math.random() * 500);
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: 'ui-test-' + Date.now() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', d => output += d);
  child.stderr.on('data', d => output += d);
  let browser;
  const folder = path.join(__dirname, 'test-results', 'node-ui-' + Date.now());
  fs.mkdirSync(folder, { recursive: true });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(base + '/'); if (r.ok) { ready = true; break; } } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, output);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.locator('#lg-user').fill('demo_owner');
    await page.locator('#lg-pass').fill('123456');
    await page.locator('#lg-pass').press('Enter');
    await page.waitForFunction(() => S.me && S.db);
    assert.match(await page.locator('meta[name=viewport]').getAttribute('content'), /maximum-scale=1/);
    const productionDefaults = await page.evaluate(() => {
      const root = document.createElement('div');
      root.innerHTML = nodeFormHtml('production', '材料到场', { is_batch: '', node_values: {} });
      const batch = document.createElement('div');
      batch.innerHTML = batchNodeFieldsHtml({}, '开料/木工/打磨');
      return {
        batchChoice: root.querySelector('[name=f_is_batch]').value,
        dates: [...root.querySelectorAll('.dp-input')].map(input => input.value),
        batchDates: [...batch.querySelectorAll('.dp-input')].map(input => input.value),
      };
    });
    assert.equal(productionDefaults.batchChoice, '');
    assert.ok(productionDefaults.dates.length && productionDefaults.dates.every(value => value === ''));
    assert.ok(productionDefaults.batchDates.length && productionDefaults.batchDates.every(value => value === ''));
    const parallelProjectId = await page.evaluate(() => {
      const task = S.db.production.find(item => item.status === '木工制作' &&
        S.db.projects.some(project => project.id === item.project_id && project.project_type === 'WJ'));
      return task?.project_id;
    });
    assert.ok(parallelProjectId);
    const parallelBefore = await page.evaluate(id => api('/api/projects/' + id), parallelProjectId);
    await page.evaluate(task => api('/api/production/' + task.id + '/advance', { method: 'POST', body: {
      expected_status: task.status, expected_updated_at: task.updated_at,
      data: { woodwork_complete_date: '2026-09-23', is_exception: '否' },
    } }), parallelBefore.production);
    await page.goto(base + '/#/project/' + parallelProjectId + '/production');
    await page.locator('[data-node-stage="外购入库"]').click();
    assert.ok(await page.getByText('并行节点 · 待处理，不是跳过').count());
    await page.getByRole('button', { name: '编辑外购入库' }).click();
    await page.locator('#prod-purchase-action [name=f_purchase_order_status]').waitFor();
    await page.locator('#prod-purchase-action [name=f_purchase_order_status]').selectOption('已下单');
    await page.locator('#prod-purchase-action [data-purchase-save]').click();
    await page.waitForFunction(() => S.detail?.production?.purchase_order_status === '已下单');
    assert.equal((await page.evaluate(() => S.detail.production.status)), '原件打磨');
    const approvedProjectId = await page.evaluate(() => {
      const approval = S.db.approvals.find(item => item.status === '已完成' &&
        S.db.projects.some(project => project.id === item.project_id && project.project_type === 'DZ'));
      return approval?.project_id;
    });
    assert.ok(approvedProjectId);
    const approvedBefore = await page.evaluate(id => api('/api/projects/' + id), approvedProjectId);
    await page.goto(base + '/#/project/' + approvedProjectId + '/production');
    await page.locator('[data-node-stage="外购入库"]').click();
    await page.getByRole('button', { name: '补正外购资料' }).click();
    await page.locator('#prod-purchase-action [name=f_purchase_order_status]').selectOption('不需要');
    await page.locator('[name=purchase_correction_reason]').fill('核对旧项目外购资料');
    await page.locator('#prod-purchase-action [data-purchase-save]').click();
    await page.waitForFunction(() => S.detail?.production?.purchase_order_status === '不需要');
    assert.equal((await page.evaluate(() => S.detail.approvals[0].status)), '已完成');
    assert.equal((await page.evaluate(() => S.detail.production.actual_ship_date)), approvedBefore.production.actual_ship_date);
    const created = await page.evaluate(() => api('/api/projects', { method: 'POST', body: {
      project_type: 'DZ', customer_name: '虚构界面测试', customer_phone: '00000000000', address: '虚构地址1号',
      customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004',
    } }));
    const projectId = created.id;
    let detail = await page.evaluate(id => api('/api/projects/' + id), projectId);
    await page.evaluate(d => api('/api/design/' + d.id + '/advance', { method: 'POST', body: {
      expected_status: d.status, expected_updated_at: d.updated_at,
      data: { designer_id: 'demo-person-010', assign_date: '2026-09-23', intent_deposit_date: '2026-09-23' },
    } }), detail.design);
    await page.goto(base + '/#/project/' + projectId + '/design');
    await page.locator('.person-picker').waitFor();
    const names = await page.locator('.person-picker label span').allTextContents();
    assert.ok(names.includes('演示管理员'));
    assert.ok(!names.includes('演示老板'));
    await page.locator('.person-picker summary').click();
    await page.locator('.person-picker label').filter({ hasText: '演示管理员' }).locator('input').check();
    await page.locator('.person-picker label').filter({ hasText: '演示设计甲' }).locator('input').check();
    const selected = await page.evaluate(() => collectNodeForm(document.querySelector('#design-action'), 'design', '上门量尺').measure_person);
    assert.equal(selected.split(',').length, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(folder, 'measure-390.png'), fullPage: true });
    detail = await page.evaluate(id => api('/api/projects/' + id), projectId);
    await page.evaluate(({ d, selected }) => api('/api/design/' + d.id + '/advance', { method: 'POST', body: {
      expected_status: d.status, expected_updated_at: d.updated_at,
      data: { measure_date: '2026-09-23', measure_person: selected },
    } }), { d: detail.design, selected });
    const upload = await context.request.post(base + '/api/upload?name=synthetic.txt', { data: 'synthetic test file', headers: { 'content-type': 'text/plain' } });
    assert.equal(upload.status(), 200);
    const file = await upload.json();
    detail = await page.evaluate(id => api('/api/projects/' + id), projectId);
    await page.evaluate(d => { S.detail = d; }, detail);
    await page.evaluate(({ d, fid }) => api('/api/design/' + d.id + '/advance', { method: 'POST', body: {
      expected_status: d.status, expected_updated_at: d.updated_at,
      data: { draft_drawings: fid, draft_complete_date: '2026-09-23' },
    } }), { d: detail.design, fid: file.id });
    await page.evaluate(async () => { await loadBootstrap(); await render(); });
    try { await page.locator('[name=f_customer_confirm_status]').waitFor({ timeout: 5000 }); }
    catch (error) {
      await page.screenshot({ path: path.join(folder, 'debug-confirm.png'), fullPage: true });
      console.log('确认节点调试：', await page.evaluate(() => ({ status: S.detail?.design?.status, text: document.body.innerText.slice(-1200) })));
      throw error;
    }
    assert.equal(await page.locator('[name=f_initial_quotation]').count(), 0);
    assert.ok(await page.getByText('初量尺报价表', { exact: false }).count());
    assert.equal(await page.getByText('客户确认结果', { exact: true }).count(), 0);
    assert.deepEqual(await page.locator('[name=f_customer_confirm_status] option').allTextContents(), ['请选择', '正在确认', '方案确认', '修改图纸']);
    await page.screenshot({ path: path.join(folder, 'confirm-390.png'), fullPage: true });
    await page.evaluate(() => doLogout());
    await page.locator('#lg-user').fill('demo_designer_1');
    await page.locator('#lg-pass').fill('123456');
    await page.locator('#lg-pass').press('Enter');
    await page.waitForFunction(() => S.me?.username === 'demo_designer_1');
    await page.goto(base + '/#/project/' + projectId + '/design');
    await page.locator('[data-node-stage="初稿客户确认"]').click();
    assert.ok(await page.getByText('初量尺报价表', { exact: true }).count());
    assert.equal(await page.getByRole('button', { name: '退回此节点' }).count(), 0);
    await page.getByRole('button', { name: '关闭', exact: true }).last().click();
    await page.locator('[data-node-stage="初稿图纸制作"]').click();
    assert.ok(await page.getByText('初稿完成时间', { exact: true }).count());
    assert.equal(await page.locator('#rollback-reason').count(), 0);
    await page.getByRole('button', { name: '退回此节点' }).click();
    await page.locator('#rollback-reason').fill('虚构测试退回原因');
    await page.getByRole('button', { name: '确认退回' }).click();
    await page.waitForFunction(() => S.detail?.design?.status === '初稿图纸制作');
    assert.equal(await page.locator('#design-action a[href="/api/files/' + file.id + '"]').count(), 1);
    await page.evaluate(() => doLogout());
    await page.locator('#lg-user').fill('demo_owner');
    await page.locator('#lg-pass').fill('123456');
    await page.locator('#lg-pass').press('Enter');
    await page.waitForFunction(() => S.me?.username === 'demo_owner');
    await page.goto(base + '/#/project/' + projectId + '/design');
    await page.locator('[data-node-stage="上门量尺"]').click();
    assert.ok(await page.getByText('量尺时间', { exact: true }).count());
    assert.equal(await page.locator('#rollback-reason').count(), 0);
    await page.getByRole('button', { name: '退回此节点' }).click();
    await page.locator('#rollback-reason').fill('管理员继续退回核对量尺资料');
    await page.getByRole('button', { name: '确认退回' }).click();
    await page.waitForFunction(() => S.detail?.design?.status === '上门量尺');
    await page.locator('details.saved-node-data summary').click();
    assert.ok(await page.locator('details.saved-node-data a[href="/api/files/' + file.id + '"]').count());
    assert.equal((await page.evaluate(() => S.detail.design.measure_person)).length, 2);
    const batchProject = await page.evaluate(() => {
      const task = S.db.production.find(item => item.batch_flow);
      return task?.project_id;
    });
    assert.ok(batchProject);
    await page.goto(base + '/#/project/' + batchProject + '/production');
    const shippedRow = page.locator('tr').filter({ hasText: '已出货' }).filter({ has: page.getByRole('button', { name: '补正资料' }) }).first();
    await shippedRow.getByRole('button', { name: '补正资料' }).click();
    await page.locator('[name=correction_reason]').fill('手机端核实历史生产内容');
    await page.locator('#batch-correction-fields [name=batch_content]').fill('演示批次内容补正');
    await page.getByRole('button', { name: '保存补正' }).click();
    await page.waitForFunction(() => !document.querySelector('.modal-mask') &&
      S.detail?.batches?.some(batch => batch.batch_content === '演示批次内容补正'));
    assert.ok(await page.getByText('演示批次内容补正').count());
    assert.ok(await page.getByText('已出货', { exact: true }).count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const quoteProject = await page.evaluate(() => api('/api/projects', { method: 'POST', body: {
      project_type: 'QC', customer_name: '虚构界面报价权限', customer_phone: '00000000000',
      address: '虚构地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004',
    } }));
    const finalUpload = await context.request.post(base + '/api/upload?name=private-final.txt', {
      data: 'synthetic final quote', headers: { 'content-type': 'text/plain' },
    });
    const finalFile = await finalUpload.json();
    const quoteDetail = await page.evaluate(id => api('/api/projects/' + id), quoteProject.id);
    await page.evaluate(({ detail, fid }) => api('/api/design/' + detail.design.id + '/save', { method: 'POST', body: {
      expected_status: detail.design.status, expected_updated_at: detail.design.updated_at, data: { quotation: fid },
    } }), { detail: quoteDetail, fid: finalFile.id });
    await page.evaluate(() => doLogout());
    await page.locator('#lg-user').fill('demo_wood');
    await page.locator('#lg-pass').fill('123456');
    await page.locator('#lg-pass').press('Enter');
    await page.waitForFunction(() => S.me?.username === 'demo_wood');
    await page.goto(base + '/#/project/' + quoteProject.id + '/design');
    await page.locator('[data-node-stage="客户最终确认"]').click();
    assert.ok(await page.getByText('仅项目负责销售和管理员可见').count());
    assert.equal(await page.locator('.modal-mask a[href="/api/files/' + finalFile.id + '"]').count(), 0);
    assert.equal((await context.request.get(base + '/api/files/' + finalFile.id)).status(), 403);
    assert.equal(await page.getByRole('button', { name: '退回此节点' }).count(), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ ok: true, errors, projectId }, null, 2));
    console.log(JSON.stringify({ ok: true, folder, checks: ['手机缩放默认锁定', '生产日期与分批选择默认留空', '管理员点击并行外购节点可编辑', '已审批外购资料可留痕补正且不改发货', '量尺人员多选', '初稿报价字段', '节点先只读查看再按权限退回', '旧附件在退回表单可见', '管理员在手机页面连续退回', '旧附件在历史资料可见', '手机端补正已发货批次资料', '可见项目人员无权查看最终报价', '无整页横向溢出'] }));
  } finally {
    if (browser) await browser.close();
    child.kill();
    await once(child, 'exit');
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
