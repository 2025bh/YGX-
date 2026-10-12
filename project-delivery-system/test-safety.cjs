'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createJsonStore, validateDatabase } = require('./json-store');

const runId = Date.now() + '-' + process.pid;
const namespace = 'safety-' + runId;
const results = path.join(__dirname, 'test-results', namespace);
const checks = [];
fs.mkdirSync(results, { recursive: true });
const blank = () => ({ users: [], projects: [], design: [], production: [], batches: [], installations: [],
  aftersales: [], approvals: [], notifications: [], logs: [], sessions: {}, files: {}, counters: {}, config: {} });
function check(name, fn) { fn(); checks.push(name); }

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  for (const [index, contents] of ['{', 'null', 'false', '0', '[]', '{}', JSON.stringify({ ...blank(), projects: [null] })].entries()) {
    check('invalid database preserved ' + index, () => {
      const file = path.join(results, 'invalid-' + index + '.json');
      fs.writeFileSync(file, contents);
      assert.throws(() => createJsonStore(file).read(), /原文件未修改/);
      assert.equal(fs.readFileSync(file, 'utf8'), contents);
    });
  }
  check('missing database can be explicitly initialized', () => {
    assert.equal(createJsonStore(path.join(results, 'missing.json')).read(), undefined);
  });
  check('legacy optional field catalogs remain compatible', () => assert.doesNotThrow(() => validateDatabase(blank())));
  check('atomic write preserves unknown fields and restores from copied snapshot', () => {
    const file = path.join(results, 'valid.json');
    const store = createJsonStore(file);
    const first = { ...blank(), extension: { kept: true } };
    store.write(first);
    const restored = path.join(results, 'restored.json');
    fs.copyFileSync(file, restored);
    store.write({ ...first, projects: [{ id: 'synthetic' }] });
    assert.equal(store.read().projects.length, 1);
    assert.deepEqual(createJsonStore(restored).read(), first);
    assert.deepEqual(store.read().extension, { kept: true });
  });
  for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync']) {
    check('failed ' + operation + ' preserves disk and stops further writes', () => {
      const file = path.join(results, 'fault-' + operation + '.json');
      fs.writeFileSync(file, JSON.stringify(blank()));
      const before = fs.readFileSync(file, 'utf8');
      const io = Object.create(fs);
      io[operation] = () => { throw new Error('synthetic storage failure'); };
      const store = createJsonStore(file, io);
      assert.throws(() => store.write({ ...blank(), projects: [{ id: 'not-committed' }] }), { code: 'YGX_STORAGE_UNAVAILABLE' });
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      assert.throws(() => store.write(blank()), { code: 'YGX_STORAGE_UNAVAILABLE' });
      assert.throws(() => store.assertAvailable(), { code: 'YGX_STORAGE_UNAVAILABLE' });
      assert.deepEqual(createJsonStore(file).read(), blank());
    });
  }

  check('application refuses null database without seeding or overwriting', () => {
    const invalidNamespace = namespace + '-invalid';
    const folder = path.join(__dirname, 'demo-data', invalidNamespace);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'db.json');
    fs.writeFileSync(file, 'null');
    const attempt = spawnSync(process.execPath, ['server.js'], { cwd: __dirname,
      env: { ...process.env, YGX_MODE: 'demo', YGX_DEMO_NAMESPACE: invalidNamespace }, encoding: 'utf8', timeout: 5000 });
    assert.notEqual(attempt.status, 0);
    assert.match(attempt.stderr, /数据库内容无效/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'null');
  });

  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  // Fault injection exists only in this test child, never in the application API.
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.on('message', message => {
      if (message === 'fail-storage') {
        fs.renameSync = () => { throw new Error('synthetic rename failure'); };
        process.send('fault-ready');
      }
    });
    require('./server');
  `], { cwd: __dirname, env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: namespace }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  let cookie = '';
  let restoreExpected;
  async function request(url, body) {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { code: response.status, body: await response.json() };
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    assert.equal((await request('/api/login', { username: 'demo_owner', password: '123456' })).code, 200);
    const projectData = { project_type: 'DZ', customer_name: 'Synthetic safety project', customer_phone: '00000000000', address: 'Synthetic address', customer_type: 'C端', source_channel: '其他渠道' };
    const projectField = await request('/api/fields/create', { scope: 'project', label: 'Safety project field', type: 'text', required: true });
    assert.equal(projectField.code, 200);
    const key = projectField.body.id;
    const dbFile = path.join(__dirname, 'demo-data', namespace, 'db.json');
    const beforeCreate = fs.readFileSync(dbFile, 'utf8');
    assert.equal((await request('/api/projects', projectData)).code, 400);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeCreate);
    checks.push('project required custom field rejects before counter or data changes');
    const created = await request('/api/projects', { ...projectData, custom: { [key]: 'preserved' } });
    assert.equal(created.code, 200);
    const projectId = created.body.id;
    let view = (await request('/api/projects/' + projectId)).body;
    assert.equal(view.project.custom[key], 'preserved');
    checks.push('project custom field saves and reloads');

    const field = await request('/api/fields/create', { scope: 'design', stage: view.design.status, label: 'Safety design field', type: 'text', required: true });
    assert.equal(field.code, 200);
    const designKey = field.body.id;
    const designData = { designer_id: 'demo-person-010', assign_date: '2026-09-25', intent_deposit_date: '2026-09-25' };
    let revision = () => ({ expected_status: view.design.status, expected_updated_at: view.design.updated_at });
    const beforeAdvance = fs.readFileSync(dbFile, 'utf8');
    assert.equal((await request('/api/design/' + view.design.id + '/advance', { ...revision(), data: designData })).code, 400);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeAdvance);
    checks.push('design required custom field cannot bypass through direct API');
    assert.equal((await request('/api/design/' + view.design.id + '/save', { ...revision(), data: { remark: 'partial save' } })).code, 200);
    view = (await request('/api/projects/' + projectId)).body;
    assert.equal(view.design.status, '设计师分配');
    checks.push('partial save remains allowed without completing required fields');
    assert.equal((await request('/api/design/' + view.design.id + '/save', { ...revision(), data: { custom: { [designKey]: 'saved first' } } })).code, 200);
    view = (await request('/api/projects/' + projectId)).body;
    assert.equal((await request('/api/design/' + view.design.id + '/advance', { ...revision(), data: designData })).code, 200);
    view = (await request('/api/projects/' + projectId)).body;
    assert.equal(view.design.status, '上门量尺');
    assert.equal(view.design.custom[designKey], 'saved first');
    checks.push('previously saved custom values satisfy completion and survive advancement');

    const fileField = await request('/api/fields/create', { scope: 'design', stage: '上门量尺', label: 'Safety required drawing', type: 'file', required: true });
    const numberField = await request('/api/fields/create', { scope: 'design', stage: '上门量尺', label: 'Safety zero number', type: 'number', required: true });
    assert.equal(fileField.code, 200);
    assert.equal(numberField.code, 200);
    const measureData = { measure_date: '2026-09-25', measure_person: 'demo-person-010' };
    const beforeFile = fs.readFileSync(dbFile, 'utf8');
    for (const invalid of [false, 0]) {
      const result = await request('/api/design/' + view.design.id + '/advance', { ...revision(), data: { ...measureData, custom: { [fileField.body.id]: invalid, [numberField.body.id]: 0 } } });
      assert.equal(result.code, 400, JSON.stringify(result.body));
      assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeFile);
    }
    checks.push('non-file values cannot satisfy required attachment field');
    const uploaded = await fetch(base + '/api/upload?name=safety.txt', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'Synthetic safety attachment' });
    assert.equal(uploaded.status, 200);
    const uploadId = (await uploaded.json()).id;
    assert.ok(uploadId);
    assert.equal((await request('/api/design/' + view.design.id + '/save', { ...revision(), data: { custom: { [fileField.body.id]: uploadId, [numberField.body.id]: 0 } } })).code, 200);
    view = (await request('/api/projects/' + projectId)).body;
    assert.equal((await request('/api/design/' + view.design.id + '/save', { ...revision(), data: { custom: { [fileField.body.id]: true } } })).code, 200);
    view = (await request('/api/projects/' + projectId)).body;
    assert.equal(view.design.custom[fileField.body.id], uploadId);
    checks.push('malformed draft attachment cannot overwrite existing file');
    assert.equal((await request('/api/design/' + view.design.id + '/advance', { ...revision(), data: { ...measureData, custom: { [fileField.body.id]: '' } } })).code, 200);
    view = (await request('/api/projects/' + projectId)).body;
    assert.equal(view.design.custom[fileField.body.id], uploadId);
    assert.equal(view.design.custom[numberField.body.id], 0);
    assert.equal(view.design.status, '初稿图纸制作');
    checks.push('blank attachment resubmission preserves stored file and numeric zero remains valid');

    const boot = (await request('/api/bootstrap')).body;
    let purchaseTask;
    let woodworkField;
    for (const [scope, task] of [['production', boot.production.find(t => !t.batch_flow && t.status === '木工制作')], ['install', boot.installations.find(t => t.status === '正在安装')]]) {
      assert.ok(task, scope);
      const newField = await request('/api/fields/create', { scope, stage: task.status, label: 'Safety ' + scope + ' field', type: 'text', required: true });
      assert.equal(newField.code, 200);
      const before = fs.readFileSync(dbFile, 'utf8');
      const result = await request('/api/' + scope + '/' + task.id + '/advance', { expected_status: task.status, expected_updated_at: task.updated_at, data: {} });
      assert.equal(result.code, 400, JSON.stringify(result));
      assert.match(JSON.stringify(result.body), /Safety/);
      assert.equal(fs.readFileSync(dbFile, 'utf8'), before);
      checks.push(scope + ' required custom validation precedes any state change');
      if (scope === 'production') { purchaseTask = task; woodworkField = newField.body.id; }
    }

    const woodworkDone = await request('/api/production/' + purchaseTask.id + '/advance', {
      expected_status: purchaseTask.status, expected_updated_at: purchaseTask.updated_at,
      data: { woodwork_complete_date: '2026-09-25', is_exception: '否', custom: { [woodworkField]: 'checked' } },
    });
    assert.equal(woodworkDone.code, 200, JSON.stringify(woodworkDone.body));
    let purchase = (await request('/api/projects/' + purchaseTask.project_id)).body.production;
    assert.equal(purchase.status, '原件打磨');
    const purchaseField = await request('/api/fields/create', { scope: 'production', stage: '外购入库', label: 'Safety purchase field', type: 'text', required: true });
    assert.equal(purchaseField.code, 200);
    const purchasePayload = () => ({ action: 'complete', expected_status: purchase.status, expected_updated_at: purchase.updated_at,
      data: { purchase_order_status: '不需要' } });
    const beforePurchase = fs.readFileSync(dbFile, 'utf8');
    assert.equal((await request('/api/production/' + purchase.id + '/purchase', purchasePayload())).code, 400);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforePurchase);
    assert.equal((await request('/api/production/' + purchase.id + '/purchase', { ...purchasePayload(), data: { purchase_order_status: '不需要', custom: { [purchaseField.body.id]: 'checked' } } })).code, 200);
    purchase = (await request('/api/projects/' + purchaseTask.project_id)).body.production;
    assert.equal(purchase.custom[purchaseField.body.id], 'checked');
    assert.ok(purchase.purchase_completed_at);
    checks.push('independent purchase completion validates and stores required custom field');

    const nonbatch = boot.approvals.find(a => a.status === '待发起' && !a.batch_id);
    assert.ok(nonbatch);
    const shipProject = boot.projects.find(p => p.id === nonbatch.project_id);
    assert.ok(shipProject);
    const submit = { ship_doc: uploadId, address_verified: true, phone_verified: true, name_verified: true, no_verified: true,
      is_multi_batch: '否', ship_customer_name: shipProject.customer_name, ship_customer_phone: shipProject.customer_phone || '00000000000',
      ship_address: shipProject.address, ship_project_no: shipProject.project_no };
    const submittedShip = await request('/api/ship/' + nonbatch.id + '/submit', { data: submit });
    assert.equal(submittedShip.code, 200, JSON.stringify(submittedShip.body));
    assert.equal((await request('/api/ship/' + nonbatch.id + '/approve', { data: { finance_paid: '已收齐', ship_condition_ok: '达到发货条件' } })).code, 200);
    assert.equal((await request('/api/ship/' + nonbatch.id + '/confirm', { data: { agreed_ship_date: '2026-12-01', dispatch_install: '否', customer_confirm_status: '已确认' } })).code, 200);
    const shipField = await request('/api/fields/create', { scope: 'production', stage: '准备出货', label: 'Safety shipment field', type: 'text', required: true });
    assert.equal(shipField.code, 200);
    const beforeShip = fs.readFileSync(dbFile, 'utf8');
    const prepare = { data: { actual_ship_date: '2026-12-01', ship_status: '已出货' } };
    assert.equal((await request('/api/ship/' + nonbatch.id + '/prepare', prepare)).code, 400);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeShip);
    assert.equal((await request('/api/ship/' + nonbatch.id + '/prepare', { data: { ...prepare.data, custom: { [shipField.body.id]: 'checked' } } })).code, 200);
    const shippedView = (await request('/api/projects/' + nonbatch.project_id)).body;
    assert.equal(shippedView.production.custom[shipField.body.id], 'checked');
    assert.equal(shippedView.approvals[0].status, '已完成');
    checks.push('actual nonbatch shipment validates and stores required custom field');

    const oldField = (await request('/api/fields')).body.fields.find(f => f.key === designKey);
    assert.equal((await request('/api/fields/update', { id: designKey, label: 'should not survive', type: 'select', options_raw: '' })).code, 400);
    assert.deepEqual((await request('/api/fields')).body.fields.find(f => f.key === designKey), oldField);
    assert.equal((await request('/api/fields/update', { id: designKey, scope: 'project' })).code, 400);
    assert.deepEqual((await request('/api/fields')).body.fields.find(f => f.key === designKey), oldField);
    checks.push('failed field definition update leaves memory unchanged');
    assert.equal((await request('/api/fields/update', { id: key, label: 'saved project field' })).code, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(dbFile, 'utf8')).field_defs.find(f => f.key === designKey), oldField);
    checks.push('later successful save does not persist rejected field changes');

    const beforeFault = fs.readFileSync(dbFile, 'utf8');
    restoreExpected = { projectId, designKey, projectField: key, fileKey: fileField.body.id, fileId: uploadId,
      stage: view.design.status, count: JSON.parse(beforeFault).projects.length };
    const acknowledgement = once(child, 'message');
    child.send('fail-storage');
    assert.equal((await acknowledgement)[0], 'fault-ready');
    assert.equal((await request('/api/fields/update', { id: key, label: 'not committed' })).code, 503);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeFault);
    assert.equal((await request('/api/bootstrap')).code, 503);
    assert.equal((await request('/api/fields/update', { id: key, label: 'retry blocked' })).code, 503);
    assert.equal((await fetch(base + '/healthz')).status, 503);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeFault);
    checks.push('HTTP storage failure reports 503 and blocks dirty state reads and further writes');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    fs.writeFileSync(path.join(results, 'server.log'), output);
  }

  const restoredNamespace = namespace + '-restored';
  const restoredDir = path.join(__dirname, 'demo-data', restoredNamespace);
  fs.mkdirSync(restoredDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'demo-data', namespace, 'db.json'), path.join(restoredDir, 'db.json'));
  const restoredPort = await freePort();
  const restored = spawn(process.execPath, ['server.js'], { cwd: __dirname,
    env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(restoredPort), YGX_DEMO_NAMESPACE: restoredNamespace },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let restoredOutput = '';
  restored.stdout.on('data', data => restoredOutput += data);
  restored.stderr.on('data', data => restoredOutput += data);
  try {
    const restoredBase = 'http://127.0.0.1:' + restoredPort;
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (restored.exitCode !== null) break;
      try { if ((await fetch(restoredBase + '/healthz', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, restoredOutput);
    const login = await fetch(restoredBase + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo_owner', password: '123456' }) });
    assert.equal(login.status, 200);
    const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
    const view = await (await fetch(restoredBase + '/api/projects/' + restoreExpected.projectId, { headers })).json();
    const boot = await (await fetch(restoredBase + '/api/bootstrap', { headers })).json();
    assert.equal(boot.projects.length, restoreExpected.count);
    assert.equal(view.project.custom[restoreExpected.projectField], 'preserved');
    assert.equal(view.design.custom[restoreExpected.designKey], 'saved first');
    assert.equal(view.design.custom[restoreExpected.fileKey], restoreExpected.fileId);
    assert.equal(view.design.status, restoreExpected.stage);
    checks.push('copied synthetic database restarts with project count, custom values and stage preserved');
  } finally {
    if (restored.exitCode === null && restored.signalCode === null) { const ended = once(restored, 'exit'); restored.kill(); await ended; }
    fs.writeFileSync(path.join(results, 'restore-server.log'), restoredOutput);
  }
  fs.writeFileSync(path.join(results, 'report.json'), JSON.stringify({ passed: checks.length, namespace, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, report: path.join(results, 'report.json'), checks }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
