'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('@playwright/test');
const adapter = require('./feishu');

(async () => {
  const namespace = 'reminders-' + Date.now();
  const port = 10500 + Math.floor(Math.random() * 500);
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: namespace }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', browser;
  child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  const checks = [], errors = [], screenshots = [];
  const folder = path.join(__dirname, 'test-results', namespace);
  fs.mkdirSync(folder, { recursive: true });
  const cookies = {};
  async function request(user, url, body) {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie: cookies[user] || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookie = response.headers.get('set-cookie'); if (cookie) cookies[user] = cookie.split(';')[0];
    return { code: response.status, body: await response.json() };
  }
  async function login(name) { assert.equal((await request(name, '/api/login', { username: name, password: '123456' })).code, 200); }
  const detail = async id => (await request('demo_owner', '/api/projects/' + id)).body;
  async function advance(id, data) {
    const view = await detail(id), t = view.design;
    const result = await request('demo_owner', '/api/design/' + t.id + '/advance', { expected_status: t.status, expected_updated_at: t.updated_at, data });
    assert.equal(result.code, 200, JSON.stringify(result.body));
  }
  async function create(type) {
    const result = await request('demo_sales_1', '/api/projects', { project_type: type, customer_name: '催促隔离测试', customer_phone: '00000000000', address: '虚构测试地址：催促验收栋1单元101（仅测试）', customer_type: 'C端', source_channel: '其他渠道' });
    assert.equal(result.code, 200); return result.body.id;
  }
  async function remind(id, user = 'demo_sales_1', overrides = {}) {
    const view = await detail(id), t = view.design;
    return request(user, '/api/design/' + t.id + '/remind', { stage: t.status, expected_status: t.status, expected_updated_at: t.updated_at, request_id: 'test-' + Math.random().toString(36).slice(2), ...overrides });
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { await fetch(base + '/healthz'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready, output);
    for (const name of ['demo_owner', 'demo_sales_1', 'demo_sales_2', 'demo_designer_1', 'demo_designer_2']) await login(name);
    const boot = (await request('demo_owner', '/api/bootstrap')).body;
    const designer = boot.users.find(u => u.username === 'demo_designer_1');
    const splitter = boot.users.find(u => u.username === 'demo_designer_2');
    const dz = await create('DZ'), bs = await create('BS'), cp = await create('CP');
    assert.equal((await remind(dz)).code, 409);
    checks.push('未分配/销售节点不能误催设计师');
    for (const id of [dz, bs]) await advance(id, { designer_id: designer.id, assign_date: '2026-10-01', intent_deposit_date: '2026-10-01' });
    const before = await detail(dz);
    assert.equal((await remind(dz, 'demo_sales_2')).code, 404);
    assert.equal((await remind(dz, 'demo_designer_1')).code, 403);
    assert.equal((await remind(cp)).code, 403);
    assert.equal((await remind(dz, 'demo_sales_1', { stage: '初稿图纸制作' })).code, 409);
    assert.equal((await remind(dz, 'demo_sales_1', { expected_updated_at: 'old' })).code, 409);
    assert.equal((await remind(dz, 'demo_sales_1', { request_id: '' })).code, 400);
    checks.push('服务端拒绝非本人销售、设计师、成品、未来节点和旧版本请求');
    const first = await remind(dz, 'demo_sales_1', { request_id: 'stable-reminder-001' });
    assert.equal(first.code, 200); assert.equal(first.body.recipient_name, designer.name); assert.equal(first.body.feishu_status, 'not_connected');
    assert.equal((await remind(dz, 'demo_sales_1', { request_id: 'stable-reminder-001' })).body.duplicate, true);
    assert.equal((await remind(dz)).body.duplicate, true);
    const received = (await request('demo_designer_1', '/api/notifications')).body.notifications.filter(n => n.kind === 'design_reminder');
    assert.equal(received.length, 1); assert.ok(received[0].text.includes(before.project.project_no)); assert.ok(received[0].text.includes(before.project.address));
    assert.equal((await request('demo_designer_2', '/api/notifications')).body.notifications.filter(n => n.kind === 'design_reminder').length, 0);
    const after = await detail(dz);
    assert.deepEqual(after.design, before.design); assert.deepEqual(after.project, before.project);
    assert.equal(after.logs.filter(l => l.text.includes('系统通知已发送')).length, 1);
    checks.push('系统仅通知负责设计师，包含编号/地址/节点且不推进流程；重复发送仅一条');
    assert.equal((await remind(bs, 'demo_owner')).code, 200);
    checks.push('板式项目与管理员代催可用');
    await request('demo_owner', '/api/staff/update', { id: designer.id, active: false });
    assert.equal((await remind(dz)).code, 409);
    await request('demo_owner', '/api/staff/update', { id: designer.id, active: true });
    checks.push('停用设计师不会继续收到催促');
    const uploadResponse = await fetch(base + '/api/upload?name=fictional.txt', { method: 'POST', headers: { cookie: cookies.demo_owner, 'content-type': 'text/plain' }, body: 'isolated test file' });
    const file = (await uploadResponse.json()).id; assert.ok(file);
    await advance(bs, { remeasure_date: '2026-10-01', final_drawing_date: '2026-10-01', final_drawings: file, splitter_id: splitter.id });
    assert.equal((await remind(bs)).code, 409);
    await advance(bs, { quotation: file, contract_amount: 100, expected_delivery_date: '2026-10-10', customer_confirm_status: '方案确认' });
    assert.equal((await remind(bs)).body.recipient_name, splitter.name);
    assert.equal((await request('demo_designer_2', '/api/projects/' + bs)).code, 200);
    const splitNotifications = (await request('demo_designer_2', '/api/notifications')).body.notifications;
    assert.equal(splitNotifications.filter(n => n.kind === 'design_reminder').length, 1);
    checks.push('拆单节点通知指定拆单人员，接收人可查看办理项目');
    const contract = adapter.notifyDesignReminder({ notification: received[0], project: before.project, sender: boot.users.find(u => u.username === 'demo_sales_1'), recipient: designer });
    assert.equal(contract.attempted, false); assert.equal(contract.payload.event_id, received[0].id); assert.equal(contract.payload.recipient_local_user_id, designer.id);
    checks.push('飞书通知适配契约预留稳定人员/事件ID，不伪报外部已发送');

    const uiProject = await create('DZ');
    await advance(uiProject, { designer_id: designer.id, assign_date: '2026-10-01', intent_deposit_date: '2026-10-01' });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const receiverContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const receiver = await receiverContext.newPage();
    const senderContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const sender = await senderContext.newPage();
    for (const [page, name] of [[sender, 'demo_sales_1'], [receiver, 'demo_designer_1']]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base); await page.locator('#lg-user').fill(name); await page.locator('#lg-pass').fill('123456'); await page.locator('#lg-pass').press('Enter');
      await page.waitForFunction(() => typeof S !== 'undefined' && S.db);
    }
    await receiver.goto(base + '/#/project/' + uiProject + '/design');
    await receiver.locator('#design-action').waitFor();
    await receiver.locator('textarea[name="f_remark"]').fill('接收通知时必须保留的未提交文本');
    await sender.goto(base + '/#/project/' + uiProject + '/design');
    await sender.locator('#design-reminder-bar [data-design-remind]').click();
    await sender.locator('#design-reminder-bar .design-reminder-note').filter({ hasText: '已催促' }).waitFor();
    await receiver.waitForFunction(() => S.db.notifications.some(n => n.kind === 'design_reminder' && n.project_id === location.hash.split('/')[2]), null, { timeout: 20000 });
    assert.equal(await receiver.locator('textarea[name="f_remark"]').inputValue(), '接收通知时必须保留的未提交文本');
    checks.push('接收方页面自动收到消息且保留未提交表单');
    await receiver.locator('.bell').click();
    await receiver.locator('.notif-item').filter({ hasText: '【设计催促】' }).filter({ hasText: (await detail(uiProject)).project.project_no }).click();
    await receiver.locator('#design-action [name="f_measure_date"]').waitFor();
    assert.ok((await receiver.url()).includes('/todo/design/'));
    checks.push('设计师点击系统催促直达待填写节点');
    for (const width of [360, 390, 768, 1440]) {
      await sender.setViewportSize({ width, height: 900 });
      await sender.goto(base + '/#/project/' + uiProject + '/design');
      await sender.locator('[data-node-stage="上门量尺"]').click();
      assert.equal(await sender.locator('.mfoot [data-design-remind]').count(), 1);
      await sender.locator('.modal').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
      assert.equal(await sender.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const screenshot = path.join(folder, 'reminder-' + width + '.png'); await sender.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot);
      await sender.locator('[data-close]').click();
    }
    await sender.goto(base + '/#/project/' + cp + '/design');
    await sender.locator('[data-node-stage="客户最终确认"]').click();
    assert.equal(await sender.locator('[data-design-remind]').count(), 0);
    assert.deepEqual(errors, []);
    checks.push('360/390/768/1440节点催促无溢出，成品不显示，页面错误0');
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ passed: checks.length, checks, errors, screenshots }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, checks, report: path.join(folder, 'report.json') }, null, 2));
  } finally {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(folder, 'server.log'), output);
    const exited = once(child, 'exit'); child.kill(); await exited;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
