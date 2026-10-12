const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

(async () => {
  const namespace = 'external-test-' + Date.now();
  const port = 9600 + Math.floor(Math.random() * 300);
  const base = 'http://127.0.0.1:' + port;
  const dataFile = path.join(__dirname, 'demo-data', namespace, 'db.json');
  let child;
  let browser;
  let cookie = '';
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: __dirname,
      env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: namespace },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/')).ok) return; } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('隔离服务未启动：' + output);
  }
  async function stop() {
    if (!child) return;
    child.kill();
    await once(child, 'exit');
    child = null;
  }
  async function request(url, body) {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const session = response.headers.get('set-cookie');
    if (session) cookie = session.split(';')[0];
    return { code: response.status, body: await response.json() };
  }
  try {
    await start();
    assert.equal((await request('/api/login', { username: 'demo_owner', password: '123456' })).code, 200);
    const project = (await request('/api/projects', { project_type: 'DZ', customer_name: '虚构共同负责人测试',
      customer_phone: '00000000000', address: '虚构地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004' })).body;
    const unassigned = (await request('/api/projects', { project_type: 'DZ', customer_name: '虚构未分配测试',
      customer_phone: '00000000000', address: '虚构地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004' })).body;
    const upload = await fetch(base + '/api/upload?name=synthetic.txt', { method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' }, body: 'Synthetic file' });
    const file = await upload.json();
    assert.ok(file.id);
    async function advance(expected, data) {
      const detail = (await request('/api/projects/' + project.id)).body;
      assert.equal(detail.design.status, expected);
      const result = await request('/api/design/' + detail.design.id + '/advance', {
        expected_status: detail.design.status, expected_updated_at: detail.design.updated_at, data });
      assert.equal(result.code, 200, JSON.stringify(result.body));
    }
    const date = '2026-09-23';
    await advance('设计师分配', { designer_id: 'demo-person-010', assign_date: date, intent_deposit_date: date });
    await advance('上门量尺', { measure_date: date, measure_person: ['demo-person-010'] });
    await advance('初稿图纸制作', { draft_drawings: file.id, draft_complete_date: date });
    await advance('初稿客户确认', { initial_quotation: file.id, customer_confirm_status: '方案确认' });
    await advance('复尺确认', { remeasure_date: date, final_drawing_date: date, final_drawings: file.id, splitter_id: 'demo-person-010' });
    await advance('客户最终确认', { quotation: file.id, contract_amount: 100, expected_delivery_date: date,
      customer_confirm_status: '方案确认' });
    await advance('开始拆单', { splitter_start_date: date, split_status: '已完成' });
    await advance('转接生产', { split_status: '已完成', splitter_transfer_date: date, split_drawings: file.id,
      production_manager_ids: ['demo-person-014', 'demo-person-018'] });
    let detail = (await request('/api/projects/' + project.id)).body;
    assert.deepEqual(detail.production.production_manager_ids, ['demo-person-014', 'demo-person-018']);
    assert.equal(detail.production.production_manager_id, 'demo-person-014');
    assert.equal((await request('/api/login', { username: 'demo_external', password: '123456' })).code, 200);
    const boot = (await request('/api/bootstrap')).body;
    assert.ok(boot.projects.some(item => item.id === project.id));
    assert.ok(boot.production.some(item => item.project_id === project.id));
    assert.ok(!boot.projects.some(item => item.id === unassigned.id));
    assert.equal((await request('/api/projects/' + unassigned.id)).code, 404);
    detail = (await request('/api/projects/' + project.id)).body;
    assert.equal(detail.can_view_final_quotation, false);
    assert.equal(detail.design.quotation, undefined);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(base);
    await page.locator('#lg-user').fill('demo_external');
    await page.locator('#lg-pass').fill('123456');
    await page.locator('#lg-pass').press('Enter');
    await page.waitForFunction(() => S.me?.username === 'demo_external');
    await page.goto(base + '/#/project/' + project.id + '/production');
    await page.locator('#prod-action').waitFor();
    assert.match(await page.locator('.readonly-field-value').innerText(), /演示木工主管、演示外接负责人/);
    assert.equal(await page.locator('[name=f_production_manager_ids]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await browser.close(); browser = null;

    assert.equal((await request('/api/production/' + detail.production.id + '/advance', {
      expected_status: detail.production.status, expected_updated_at: detail.production.updated_at,
      data: { material_order_status: '已下单', material_order_date: date, production_manager_ids: ['demo-person-014'] },
    })).code, 200);
    detail = (await request('/api/projects/' + project.id)).body;
    assert.deepEqual(detail.production.production_manager_ids, ['demo-person-014', 'demo-person-018']);
    assert.equal((await request('/api/production/' + detail.production.id + '/save', {
      expected_status: detail.production.status, expected_updated_at: detail.production.updated_at,
      data: { remark: '演示外接负责人核对材料到场' },
    })).code, 200);
    assert.ok((await request('/api/bootstrap')).body.stats.todos.some(item => item.project_id === project.id));

    const ownFileResponse = await fetch(base + '/api/upload?name=external-own.txt', { method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' }, body: 'Synthetic external project file' });
    const ownFile = await ownFileResponse.json();
    const own = (await request('/api/projects', { project_type: 'WJ', customer_name: '虚构自建外接测试',
      customer_phone: '00000000000', address: '虚构地址', customer_type: 'B端', source_channel: '合作商家' })).body;
    let ownDetail = (await request('/api/projects/' + own.id)).body;
    assert.equal(ownDetail.project.sales_id, 'demo-person-018');
    assert.equal((await request('/api/design/' + ownDetail.design.id + '/advance', {
      expected_status: ownDetail.design.status, expected_updated_at: ownDetail.design.updated_at,
      data: { quotation: ownFile.id, contract_amount: 100, expected_delivery_date: date,
        customer_confirm_status: '方案确认' },
    })).code, 200);
    ownDetail = (await request('/api/projects/' + own.id)).body;
    assert.ok(ownDetail.production);
    async function advanceOwnProduction(expected, data) {
      ownDetail = (await request('/api/projects/' + own.id)).body;
      assert.equal(ownDetail.production.status, expected);
      const result = await request('/api/production/' + ownDetail.production.id + '/advance', {
        expected_status: ownDetail.production.status, expected_updated_at: ownDetail.production.updated_at, data });
      assert.equal(result.code, 200, JSON.stringify(result.body));
    }
    await advanceOwnProduction('下单备料', { material_order_status: '已下单', material_order_date: date });
    await advanceOwnProduction('材料到场', { wood_arrival_date: date, material_arrival_status: '全部材料到场',
      cutting_start_date: date, is_exception: '否', is_batch: '否' });
    await advanceOwnProduction('生产开料', { cutting_complete_date: date,
      cutting_owner: (await request('/api/bootstrap')).body.users.find(user => user.name === '演示开料负责人').id, is_exception: '否' });
    await advanceOwnProduction('木工制作', { woodwork_complete_date: date, is_exception: '否' });
    await advanceOwnProduction('原件打磨', { polishing_complete_date: date, is_exception: '否' });
    ownDetail = (await request('/api/projects/' + own.id)).body;
    assert.equal(ownDetail.production.status, '油漆喷刷');
    assert.equal((await request('/api/production/' + ownDetail.production.id + '/save', {
      expected_status: ownDetail.production.status, expected_updated_at: ownDetail.production.updated_at,
      data: { painting_complete_date: date },
    })).code, 403);

    assert.equal((await request('/api/login', { username: 'demo_wood', password: '123456' })).code, 200);
    detail = (await request('/api/projects/' + project.id)).body;
    assert.equal((await request('/api/production/' + detail.production.id + '/save', {
      expected_status: detail.production.status, expected_updated_at: detail.production.updated_at,
      data: { remark: '演示木工主管共同核对材料到场' },
    })).code, 200);

    await stop();
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const task = saved.production.find(item => item.project_id === project.id);
    task.production_manager_ids = ['demo-person-014'];
    fs.writeFileSync(dataFile, JSON.stringify(saved, null, 1));
    await start();
    assert.equal((await request('/api/login', { username: 'demo_external', password: '123456' })).code, 200);
    detail = (await request('/api/projects/' + project.id)).body;
    assert.deepEqual(detail.production.production_manager_ids, ['demo-person-014', 'demo-person-018']);
    console.log(JSON.stringify({ ok: true, checks: ['转接生产多人完整继承', '下单备料只读同步',
      '演示外接负责人仅见自建或分配项目', '演示外接负责人与演示木工主管共同编辑木工节点', '自建外接木工可编辑且油漆拒绝',
      '最终报价仍隐藏', '旧单人任务补齐共同负责人', '390px无横向溢出'] }));
  } finally {
    if (browser) await browser.close();
    await stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
