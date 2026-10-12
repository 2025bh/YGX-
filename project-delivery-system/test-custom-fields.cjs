'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('@playwright/test');
const CF = require('./custom-fields');

async function main() {
  const namespace = 'custom-fields-' + Date.now();
  const folder = path.join(__dirname, 'test-results', namespace);
  fs.mkdirSync(folder, { recursive: true });
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname,
    env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: namespace }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', cookie = '', browser;
  const checks = [], layouts = [], errors = [];
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  async function request(url, body) {
    const res = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, data: await res.json() };
  }
  async function post(url, body) {
    const res = await request(url, body);
    assert.equal(res.status, 200, url + ' ' + JSON.stringify(res.data));
    return res.data;
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch (_) {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    await post('/api/login', { username: 'demo_owner', password: '123456' });
    const boot = (await request('/api/bootstrap')).data;
    const observer = boot.users.find(u => u.username === 'demo_sales_5');
    assert.ok(observer);
    const projectField = await post('/api/fields/create', { scope: 'project', label: '协作联系人', type: 'user' });
    const makeProject = async label => post('/api/projects', { project_type: 'DZ', customer_name: label, customer_phone: '00000000000', address: '虚构测试地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004', custom: { [projectField.id]: observer.id } });
    const p = await makeProject('虚构字段验收');
    const fieldOnlyUser = (await post('/api/staff/create', { name: '虚构仅字段人员', username: 'field_only_' + Date.now(), roles: ['sales'] })).user;
    await post('/api/projects', { project_type: 'DZ', customer_name: '虚构人员引用检查', customer_phone: '00000000000', address: '虚构测试地址', customer_type: 'C端', source_channel: '其他渠道', sales_id: 'demo-person-004', custom: { [projectField.id]: fieldOnlyUser.id } });
    assert.equal((await request('/api/staff/delete', { id: fieldOnlyUser.id })).status, 400);
    checks.push('仅被附加人员字段引用的员工也不可删除');
    const defs = {};
    for (const [type, label] of [['users', '协同人员'], ['multiselect', '核对事项'], ['user', '复核联系人'], ['date', '约定复核日'], ['text', '现场补充']]) {
      defs[type] = await post('/api/fields/create', { scope: 'design', stage: '设计师分配', label, type, required: ['users', 'multiselect'].includes(type), options_raw: '尺寸复核\n颜色复核\n现场复核\n颜色复核' });
    }
    assert.equal((await request('/api/fields')).data.fields.find(f => f.key === defs.multiselect.id).options.length, 3);
    checks.push('人员、多人、多选类型可创建，选项去重');
    const view = async id => (await request('/api/projects/' + id)).data;
    let detail = await view(p.id);
    const payload = data => ({ expected_status: detail.design.status, expected_updated_at: detail.design.updated_at, data });
    const dbFile = path.join(__dirname, 'demo-data', namespace, 'db.json');
    for (const custom of [{ [defs.users.id]: ['unknown-user'] }, { [defs.multiselect.id]: ['不存在的选项'] }, { [defs.users.id]: 'demo-person-010' }]) {
      const before = fs.readFileSync(dbFile, 'utf8');
      assert.equal((await request('/api/design/' + detail.design.id + '/save', payload({ assign_date: '2030-01-01', custom }))).status, 400);
      assert.equal(fs.readFileSync(dbFile, 'utf8'), before);
      assert.equal((await view(p.id)).design.assign_date, detail.design.assign_date);
    }
    checks.push('无效人员、选项和类型在修改任何节点值前被拒绝');
    const advance = { designer_id: 'demo-person-010', assign_date: '2026-09-26', intent_deposit_date: '2026-09-26' };
    assert.equal((await request('/api/design/' + detail.design.id + '/advance', payload({ ...advance, custom: { [defs.users.id]: [], [defs.multiselect.id]: [] } }))).status, 400);
    checks.push('空多人和空多选不能绕过必填');
    const later = await post('/api/fields/create', { scope: 'design', stage: '上门量尺', label: '量尺协作人', type: 'user' });
    const beforeLater = fs.readFileSync(dbFile, 'utf8');
    assert.equal((await request('/api/design/' + detail.design.id + '/save', payload({ custom: { [later.id]: 'demo-person-010' } }))).status, 400);
    assert.equal((await request('/api/design/' + detail.design.id + '/fields', { custom: { [later.id]: 'demo-person-010' } })).status, 400);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), beforeLater);
    checks.push('不能越过当前节点改写未来节点的附加字段');
    const custom = { [defs.users.id]: ['demo-person-010', 'demo-person-004', 'demo-person-010'], [defs.multiselect.id]: ['尺寸复核', '颜色复核'], [defs.user.id]: 'demo-person-010' };
    await post('/api/design/' + detail.design.id + '/save', payload({ custom }));
    detail = await view(p.id);
    assert.deepEqual(detail.design.custom[defs.users.id], ['demo-person-010', 'demo-person-004']);
    await post('/api/design/' + detail.design.id + '/advance', payload(advance));
    detail = await view(p.id);
    assert.deepEqual(detail.design.custom[defs.multiselect.id], custom[defs.multiselect.id]);
    await post('/api/design/' + detail.design.id + '/rollback', { ...payload({}), target: '设计师分配', reason: '虚构字段保留检查' });
    detail = await view(p.id);
    assert.deepEqual(detail.design.custom[defs.users.id], ['demo-person-010', 'demo-person-004']);
    checks.push('多人去重，保存、推进、退回均保留附加字段');
    for (const change of [{ type: 'text' }, { stage: '上门量尺' }, { options_raw: '颜色复核\n现场复核' }]) {
      const id = change.options_raw ? defs.multiselect.id : defs.users.id;
      const before = fs.readFileSync(dbFile, 'utf8');
      assert.equal((await request('/api/fields/update', { id, ...change })).status, 409);
      assert.equal(fs.readFileSync(dbFile, 'utf8'), before);
    }
    await post('/api/fields/update', { id: defs.multiselect.id, label: '现场核对事项', options_raw: '尺寸复核\n颜色复核\n现场复核\n安装复核' });
    checks.push('已使用字段不能换类型、节点或移除已用选项，改名称和增选项仍可用');
    assert.equal((await request('/api/fields/delete', { id: defs.multiselect.id })).status, 409);
    await post('/api/fields/update', { id: defs.multiselect.id, active: false });
    assert.deepEqual((await view(p.id)).design.custom[defs.multiselect.id], ['尺寸复核', '颜色复核']);
    assert.equal((await request('/api/bootstrap')).data.field_defs.find(f => f.key === defs.multiselect.id).active, false);
    await post('/api/fields/update', { id: defs.multiselect.id, active: true });
    checks.push('已填写字段不可删除，停用后历史值仍留在记录');
    const f = { key: 'k', type: 'multiselect', scope: 'design', stage: '设计师分配', options: ['旧选项', '新选项'] };
    assert.ok(CF.updateError(f, { ...f, options: ['新选项'] }, [{ custom: {}, node_history: [{ snapshot: { custom: { k: ['旧选项'] } } }] }]));
    assert.equal(CF.updateError(f, { ...f, label: '新名称' }, [{ custom: { k: ['历史脏值'] } }]), '');
    const inactive = [{ id: 'old', active: false }];
    assert.deepEqual(CF.normalize({ k: ['old'] }, [{ key: 'k', label: '人员', type: 'users' }], inactive, { k: ['old'] }), { k: ['old'] });
    assert.throws(() => CF.normalize({ k: ['old'] }, [{ key: 'k', label: '人员', type: 'users' }], inactive));
    checks.push('历史快照参与字段保护，停用人员可保留原值但不能新增选入');
    await post('/api/login', { username: 'demo_sales_5', password: '123456' });
    assert.equal((await request('/api/projects/' + p.id)).status, 404);
    assert.equal((await request('/api/fields/create', { scope: 'design', label: '不允许', type: 'users' })).status, 403);
    checks.push('附加人员字段不授予项目访问权，普通员工不能建字段');
    await post('/api/login', { username: 'demo_owner', password: '123456' });
    const after = boot.aftersales.find(t => t.status === '执行中');
    const af = await post('/api/fields/create', { scope: 'aftersales', stage: '执行中', label: '售后核对', type: 'multiselect', required: true, options_raw: '已复核\n待复核' });
    assert.equal((await request('/api/aftersales/' + after.id + '/advance', { data: {} })).status, 400);
    await post('/api/aftersales/' + after.id + '/advance', { data: { custom: { [af.id]: ['已复核'] } } });
    assert.deepEqual((await view(after.project_id)).aftersales.find(t => t.id === after.id).custom[af.id], ['已复核']);
    checks.push('售后处理表单的附加字段也保存并执行必填校验');

    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [360, 390, 768, 1440]) {
      const project = await makeProject('虚构手机字段 ' + width);
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.locator('#lg-user').fill('demo_owner');
      await page.locator('#lg-pass').fill('123456');
      await page.locator('#lg-btn').click();
      await page.waitForFunction(() => typeof S !== 'undefined' && S.db);
      await page.goto(base + '/#/project/' + project.id + '/design');
      const people = page.locator('#design-action [data-cf="' + defs.users.id + '"]');
      await people.locator('summary').click();
      await people.locator('[data-cf-search]').fill('演示设计甲');
      await people.locator('[data-cf-choice][value="demo-person-010"]').check();
      await people.locator('[data-cf-search]').fill('演示销售甲');
      await people.locator('[data-cf-choice][value="demo-person-004"]').check();
      await page.locator('.topbar').click({ position: { x: 5, y: 5 } });
      assert.equal(await people.evaluate(el => el.open), false);
      assert.equal(await people.locator('[data-cf-choice]:checked').count(), 2);
      const choices = page.locator('#design-action [data-cf="' + defs.multiselect.id + '"]');
      await choices.locator('summary').click();
      await choices.getByLabel('尺寸复核', { exact: true }).check();
      await choices.getByLabel('颜色复核', { exact: true }).check();
      await page.locator('#design-action [data-cf="' + defs.user.id + '"]').focus();
      assert.equal(await choices.evaluate(el => el.open), false);
      assert.equal(await choices.locator('[data-cf-choice]:checked').count(), 2);
      await page.locator('#design-action .dp-input').first().click();
      assert.equal(await page.locator('.dp-pop').count(), 1);
      await page.locator('.topbar').click({ position: { x: 5, y: 5 } });
      assert.equal(await page.locator('.dp-pop').count(), 0);
      await page.locator('#design-action [data-cf="' + defs.user.id + '"]').selectOption('demo-person-010');
      await page.locator('#design-action [data-cf="' + defs.text.id + '"]').fill('虚构补充内容');
      await page.locator('[data-save]').click();
      await page.getByText('资料已保存，节点未推进', { exact: true }).waitFor();
      let saved = (await view(project.id)).design.custom;
      assert.deepEqual(saved[defs.users.id], ['demo-person-004', 'demo-person-010']);
      assert.deepEqual(saved[defs.multiselect.id], ['尺寸复核', '颜色复核']);
      assert.equal(saved[defs.text.id], '虚构补充内容');
      await page.reload();
      assert.match(await people.locator('summary').innerText(), /演示设计甲/);
      assert.equal(await page.locator('#design-action [data-cf="' + defs.user.id + '"]').inputValue(), 'demo-person-010');
      if (width === 360) {
        await context.setOffline(true);
        await choices.locator('summary').click();
        await choices.getByLabel('现场复核', { exact: true }).check();
        await choices.locator('summary').click();
        await page.locator('#design-action [data-cf="' + defs.text.id + '"]').fill('断网保留文本');
        await context.setOffline(false);
        await page.reload();
        await page.getByText('恢复未提交草稿', { exact: true }).click();
        await choices.locator('summary').click();
        assert.equal(await choices.getByLabel('现场复核', { exact: true }).isChecked(), true);
        assert.equal(await page.locator('#design-action [data-cf="' + defs.text.id + '"]').inputValue(), '断网保留文本');
        saved = (await view(project.id)).design.custom;
        assert.equal(saved[defs.multiselect.id].includes('现场复核'), false);
        await choices.locator('summary').click();
        await page.locator('[data-save]').click();
        await page.getByText('资料已保存，节点未推进', { exact: true }).waitFor();
        assert.equal((await view(project.id)).design.custom[defs.multiselect.id].includes('现场复核'), true);
        checks.push('手机断网附加字段草稿可恢复，联网后仍需手动保存');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(folder, 'fields-' + width + '.png'), fullPage: true });
      await page.goto(base + '/#/fields');
      await page.locator('[onclick="openFieldEditor()"]').click();
      await page.locator('[name=cf-label]').fill('模拟配置预览');
      await page.locator('[name=cf-type]').selectOption('multiselect');
      await page.locator('#cf-opt').fill('门板\n木饰面\n超长选项用于验证手机文字不会溢出容器');
      const preview = page.locator('#cf-preview-control');
      await preview.locator('summary').click();
      await preview.getByLabel('木饰面', { exact: true }).check();
      assert.match(await preview.locator('summary').innerText(), /木饰面/);
      await page.keyboard.press('Escape');
      assert.equal(await preview.locator('.cf-picker').evaluate(el => el.open), false);
      assert.equal(await page.locator('.modal-mask').count(), 1);
      assert.equal(await preview.getByLabel('木饰面', { exact: true }).isChecked(), true);
      await page.evaluate(() => {
        const fixture = document.createElement('div');
        fixture.id = 'person-picker-check';
        fixture.innerHTML = capUsersSel('test_people', '', ['demo-person-010']);
        document.querySelector('.modal .mbody').appendChild(fixture);
      });
      const builtInPeople = page.locator('#person-picker-check .person-picker');
      await builtInPeople.locator('summary').click();
      await builtInPeople.locator('input[type=checkbox]').first().check();
      await page.locator('[name=cf-label]').click();
      assert.equal(await builtInPeople.evaluate(el => el.open), false);
      assert.ok(await builtInPeople.locator('input:checked').count() >= 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(folder, 'editor-' + width + '.png'), fullPage: true });
      await page.getByRole('button', { name: '取消', exact: true }).click();
      layouts.push({ width, save: true, reload: true, preview: true, pickerDismiss: true, dateDismiss: true, noOverflow: true });
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ checks, layouts, errors }, null, 2));
    console.log(JSON.stringify({ folder, passed: checks.length, layouts, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    fs.writeFileSync(path.join(folder, 'server.log'), output);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
