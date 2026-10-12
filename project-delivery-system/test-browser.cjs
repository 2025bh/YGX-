const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
(async () => {
  const external = process.env.YGX_TEST_URL;
  if (external && process.env.YGX_TEST_ALLOW_WRITES !== '1') throw new Error('此脚本会保存演示字段；测试外部地址需明确设置 YGX_TEST_ALLOW_WRITES=1');
  const port = 9200 + Math.floor(Math.random() * 500);
  const baseUrl = external || 'http://127.0.0.1:' + port;
  const child = external ? null : spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: 'browser-test-' + Date.now() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let output = '';
  if (child) { child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data); }
  const folder = path.join(__dirname, 'test-results', 'browser-' + Date.now());
  fs.mkdirSync(folder, { recursive: true });
  const results = [], errors = [];
  try {
    if (child) {
      let ready = false;
      for (let i = 0; i < 80; i++) {
        try { const response = await fetch(baseUrl + '/'); if (response.ok) { ready = true; break; } } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(ready, output);
    }
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [360, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.stack));
      await page.goto(baseUrl + '/');
      await page.locator('#lg-user').fill('demo_owner');
      await page.locator('#lg-pass').fill('123456');
      await page.locator('#lg-pass').press('Enter');
      await page.waitForFunction(() => typeof S !== 'undefined' && S.db);
      const dateDefaults = await page.evaluate(() => {
        const results = [];
        for (const [scope, stages] of Object.entries(S.db.consts.NODE_FIELDS)) {
          for (const [stage, fields] of Object.entries(stages)) {
            for (const field of fields.filter(item => item.type === 'date')) {
              const empty = nodeFieldValue(field, { [field.col]: '', node_values: {} }, stage);
              const saved = nodeFieldValue(field, { [field.col]: '2025-01-02', node_values: {} }, stage);
              results.push({ key: field.key, empty, saved, hasDefault: field.default === 'today' });
            }
          }
        }
        return results;
      });
      assert.ok(dateDefaults.length > 15);
      assert.deepEqual(dateDefaults.filter(item => item.hasDefault).map(item => item.key), ['hardware_start_date']);
      assert.ok(dateDefaults.every(item => item.hasDefault ? /^\d{4}-\d{2}-\d{2}$/.test(item.empty) : item.empty === ''), '未填写的业务日期不应自动带入今天');
      assert.ok(dateDefaults.every(item => item.saved === '2025-01-02'), '已保存日期必须保留');
      assert.deepEqual(await page.evaluate(() => nodeFields('ship', 'approve').map(f => f.key)), ['ship_condition_ok', 'note']);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(folder, 'dashboard-' + width + '.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'dashboard overflow ' + width);
      const project = await page.evaluate(() => S.db.design.find(d => d.status === '初稿图纸制作')?.project_id || S.db.design[0].project_id);
      await page.goto(baseUrl + '/#/project/' + project + '/design');
      await page.locator('[data-save]').waitFor();
      if (width === 360) {
        await page.locator('[name=f_drawing_version]').selectOption('第二版');
        await context.setOffline(true);
        await page.locator('[data-save]').click();
        await page.waitForTimeout(200);
        assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('ygx-v22-draft:'))));
        await context.setOffline(false);
        await page.reload();
        await page.getByText('恢复未提交草稿', { exact: true }).click();
        assert.equal(await page.locator('[name=f_drawing_version]').inputValue(), '第二版');
      }
      await page.locator('[name=f_draft_complete_date]').click();
      await page.locator('.dp-pop [data-act=today]').click();
      await page.locator('[data-save]').click();
      await page.getByText('资料已保存，节点未推进', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(folder, 'design-' + width + '.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'form overflow ' + width);
      if (width === 390) {
        const customForms = await page.evaluate(async () => {
          const post = async (url, payload) => {
            const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await response.json();
            if (!response.ok) throw new Error(url + ': ' + JSON.stringify(data));
            return data;
          };
          const purchaseTask = S.db.production.find(t => t.status === '木工制作' && S.db.projects.some(p => p.id === t.project_id && p.project_type === 'WJ'));
          if (!purchaseTask) throw new Error('缺少虚构外购测试任务');
          await post('/api/production/' + purchaseTask.id + '/advance', { expected_status: purchaseTask.status, expected_updated_at: purchaseTask.updated_at,
            data: { woodwork_complete_date: '2026-09-25', is_exception: '否' } });
          const purchaseField = await post('/api/fields/create', { scope: 'production', stage: '外购入库', label: '浏览器外购字段', type: 'text', required: true });
          const approval = S.db.approvals.find(a => a.status === '待发起' && !a.batch_id);
          const shipProject = S.db.projects.find(p => p.id === approval.project_id);
          const upload = await fetch('/api/upload?name=browser-synthetic.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'Synthetic browser test' });
          if (!upload.ok) throw new Error('虚构附件上传失败');
          const file = await upload.json();
          await post('/api/ship/' + approval.id + '/submit', { data: {
            ship_doc: file.id, address_verified: true, phone_verified: true, name_verified: true, no_verified: true,
            is_multi_batch: '否', ship_customer_name: shipProject.customer_name,
            ship_customer_phone: shipProject.customer_phone || '00000000000', ship_address: shipProject.address, ship_project_no: shipProject.project_no,
          } });
          await post('/api/ship/' + approval.id + '/finance_confirm', { data: { finance_paid: '已收齐' } });
          await post('/api/ship/' + approval.id + '/approve', { data: { ship_condition_ok: '达到发货条件' } });
          await post('/api/ship/' + approval.id + '/confirm', { data: { agreed_ship_date: '2026-12-01', dispatch_install: '否', customer_confirm_status: '已确认' } });
          const shipField = await post('/api/fields/create', { scope: 'production', stage: '准备出货', label: '浏览器发货字段', type: 'text', required: true });
          return { purchaseProject: purchaseTask.project_id, purchaseKey: purchaseField.id, shipProject: shipProject.id, shipKey: shipField.id };
        });
        await page.goto(baseUrl + '/#/project/' + customForms.purchaseProject + '/production');
        await page.reload();
        try { await page.locator('#prod-purchase-action [data-cf="' + customForms.purchaseKey + '"]').waitFor({ timeout: 5000 }); }
        catch (error) {
          throw new Error('外购字段页面诊断：' + JSON.stringify(await page.evaluate(() => ({ hash: location.hash, user: S.me?.username,
            detail: S.detail?.project?.id, status: S.detail?.production?.status, fields: S.db?.field_defs?.map(f => f.key),
            box: !!document.querySelector('#prod-purchase-action'), text: document.body.innerText.slice(-500) }))) + '\n' + error.message);
        }
        await page.screenshot({ path: path.join(folder, 'purchase-custom-390.png'), fullPage: true });
        await page.goto(baseUrl + '/#/project/' + customForms.shipProject + '/ship');
        await page.locator('#ship-action [data-cf="' + customForms.shipKey + '"]').waitFor();
        assert.equal(await page.evaluate(() => /value="0"/.test(cfControl({ key: 'synthetic', type: 'number' }, 0))), true);
        await page.screenshot({ path: path.join(folder, 'shipment-custom-390.png'), fullPage: true });
      }
      if (width === 360) {
        await page.goto(baseUrl + '/#/my');
        await page.locator('.account-switch').click();
        await page.locator('#lg-user').waitFor();
        await page.locator('#lg-user').fill('demo_approver');
        await page.locator('#lg-pass').fill('123456');
        await page.locator('#lg-pass').press('Enter');
        await page.waitForFunction(() => S.me && S.me.username === 'demo_approver');
        await page.locator('.wang-approval-card').waitFor();
      }
      results.push({ width, dashboard: true, save: true, noOverflow: true, offlineDraft: width === 360 ? true : 'not-run' });
      await context.close();
    }
    for (const username of ['demo_paint', 'demo_shipping']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.stack));
      await page.goto(baseUrl + '/');
      await page.locator('#lg-user').fill(username);
      await page.locator('#lg-pass').fill('123456');
      await page.locator('#lg-pass').press('Enter');
      await page.locator('.simple-shell').waitFor();
      assert.equal(await page.locator('.sidebar').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(folder, 'simple-' + username + '-390.png'), fullPage: true });
      await page.getByRole('button', { name: '切换正式页面' }).click();
      await page.getByRole('button', { name: '切换简洁页面' }).waitFor();
      await page.locator('.tabbar').waitFor();
      await page.getByRole('button', { name: '切换简洁页面' }).click();
      await page.locator('.simple-shell').waitFor();
      await page.getByRole('button', { name: '退出' }).click();
      await page.locator('#lg-user').fill(username);
      await page.locator('#lg-pass').fill('123456');
      await page.locator('#lg-pass').press('Enter');
      await page.locator('.simple-shell').waitFor();
      results.push({ username, simpleMobile: true, modeSwitch: true });
      await context.close();
    }
    const purchaseContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const purchasePage = await purchaseContext.newPage();
    purchasePage.on('pageerror', e => errors.push(e.stack));
    await purchasePage.goto(baseUrl + '/');
    await purchasePage.locator('#lg-user').fill('demo_purchase');
    await purchasePage.locator('#lg-pass').fill('123456');
    await purchasePage.locator('#lg-pass').press('Enter');
    await purchasePage.waitForFunction(() => S.me?.username === 'demo_purchase');
    assert.ok(await purchasePage.evaluate(() => S.db.stats.todos.some(t => t.type === 'purchase')));
    await purchasePage.goto(baseUrl + '/#/todo');
    await purchasePage.getByText('外购待办', { exact: true }).first().waitFor();
    await purchasePage.screenshot({ path: path.join(folder, 'purchase-todo-390.png'), fullPage: true });
    await purchasePage.locator('.todo-item').filter({ hasText: '外购入库' }).first().locator('.todo-identity').click();
    await purchasePage.locator('#prod-purchase-action [data-purchase-save]').waitFor();
    assert.ok(purchasePage.url().includes('/todo/purchase/'));
    assert.equal(await purchasePage.locator('.tabs').count(), 0);
    assert.equal(await purchasePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await purchasePage.screenshot({ path: path.join(folder, 'purchase-direct-390.png'), fullPage: true });
    await purchasePage.goto(baseUrl + '/#/todo');
    await purchasePage.locator('.todo-item').filter({ hasText: '外购入库' }).first().locator('.todo-action').click();
    await purchasePage.locator('#prod-purchase-action [data-purchase-save]').waitFor();
    const legacyPurchaseUrl = purchasePage.url().replace(/\/todo\/purchase\/[^/]+$/, '/purchase');
    await purchasePage.goto(legacyPurchaseUrl);
    await purchasePage.locator('#prod-purchase-action [data-purchase-save]').waitFor();
    results.push({ username: 'demo_purchase', purchaseTodo: true, directForm: true, legacyLink: true });
    await purchaseContext.close();
    const routeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const routePage = await routeContext.newPage();
    routePage.on('pageerror', e => errors.push(e.stack));
    await routePage.goto(baseUrl + '/');
    await routePage.locator('#lg-user').fill('demo_owner');
    await routePage.locator('#lg-pass').fill('123456');
    await routePage.locator('#lg-pass').press('Enter');
    await routePage.waitForFunction(() => S.me?.username === 'demo_owner');
    const routeTodos = await routePage.evaluate(() => S.db.stats.todos.map(t => ({ ...t, href: todoHref(t) })));
    const selectors = { design: '#design-action', production: '#prod-action', purchase: '#prod-purchase-action', ship: '#ship-action', install: '#install-action', aftersales: '[id^="as-btns-"]' };
    const checkedTypes = [];
    for (const [type, selector] of Object.entries(selectors)) {
      const todo = routeTodos.find(t => t.type === type);
      if (!todo) continue;
      await routePage.goto(baseUrl + '/' + todo.href);
      await routePage.locator(selector).waitFor();
      assert.equal(await routePage.locator('.tabs').count(), 0, type + ' should open focused page');
      if (type === 'ship') assert.equal(await routePage.evaluate(() => SHIP_SEL), todo.id);
      checkedTypes.push(type);
    }
    assert.ok(checkedTypes.includes('design') && checkedTypes.includes('production') && checkedTypes.includes('purchase'));
    results.push({ username: 'demo_owner', directTodoTypes: checkedTypes });
    const standalone = await routePage.evaluate(async () => {
      const response = await fetch('/api/aftersales', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_name: '虚构售后客户', problem_desc: '隔离测试待派工' }) });
      if (!response.ok) throw new Error('创建隔离售后测试工单失败');
      return response.json();
    });
    await routePage.reload();
    await routePage.waitForFunction(id => S.db?.aftersales?.some(t => t.id === id), standalone.id);
    await routePage.goto(baseUrl + '/#/aftersales/' + standalone.id);
    try { await routePage.locator('#as-btns-' + standalone.id + ' button.primary').waitFor({ timeout: 5000 }); }
    catch (error) { throw new Error('独立售后待办诊断：' + JSON.stringify(await routePage.evaluate(id => ({
      route: location.hash, user: S.me?.username, ticket: S.db?.aftersales?.find(t => t.id === id)?.status,
      body: document.body.innerText.slice(-800), box: !!document.getElementById('as-btns-' + id),
    }), standalone.id)) + '\n' + error.message); }
    await routePage.locator('#as-btns-' + standalone.id + ' button.primary').click();
    await routePage.locator('select[name="assignee_name"]').selectOption({ index: 0 });
    assert.ok(await routePage.locator('select[name="assignee_name"] option').count() > 0);
    await routePage.locator('#as-adv').click();
    await routePage.waitForFunction(id => S.db.aftersales.find(t => t.id === id)?.status === '待执行', standalone.id);
    results.push({ standaloneAftersalesDirect: true, assignable: true });
    await routeContext.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ folder, results, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
