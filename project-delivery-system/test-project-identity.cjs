'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('@playwright/test');

(async () => {
  const namespace = 'project-identity-' + Date.now();
  const folder = path.join(__dirname, 'test-results', namespace);
  fs.mkdirSync(folder, { recursive: true });
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname,
    env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: namespace },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', browser;
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const results = [];
  const address = '四川省成都市高新区天府大道中段测试路一百二十八号三栋二单元二十八楼二号';
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch (_) {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, output);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [360, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.locator('#lg-user').fill('demo_owner');
      await page.locator('#lg-pass').fill('123456');
      await page.locator('#lg-pass').press('Enter');
      await page.waitForFunction(() => S.me && S.db && S.db.projects.length);
      const projectNo = await page.evaluate(longAddress => {
        const p = S.db.projects[0];
        p.address = longAddress;
        S.db.stats.todos = [{ type: 'design', id: 'test-todo', project_id: p.id, text: p.project_no + ' ' + p.customer_name + '：上门量尺' }];
        S.db.stats.todoCount = 1;
        nav('#/todo');
        render();
        return p.project_no;
      }, address);
      await page.locator('.todo-item').waitFor();
      assert.equal(await page.locator('.todo-item .project-number').innerText(), projectNo);
      assert.equal(await page.locator('.todo-item .project-address').innerText(), address);
      assert.equal(await page.locator('.todo-item .todo-stage').innerText(), '上门量尺');
      const layout = await page.evaluate(() => {
        const btn = document.querySelector('.todo-action').getBoundingClientRect();
        const item = document.querySelector('.todo-item').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          buttonVisible: btn.left >= item.left && btn.right <= item.right + 1,
          buttonHeight: btn.height };
      });
      assert.equal(layout.overflow, false, '待办页横向溢出: ' + width);
      assert.equal(layout.buttonVisible, true, '待办按钮不可见: ' + width);
      assert.ok(layout.buttonHeight >= 40, '待办按钮过小: ' + width);
      await page.screenshot({ path: path.join(folder, 'todo-' + width + '.png'), fullPage: true });
      await page.evaluate(() => { nav('#/dashboard'); render(); });
      assert.equal(await page.locator('.dashboard-todo .project-address').first().innerText(), address);
      await page.evaluate(() => { nav('#/projects'); render(); renderProjTable(); });
      assert.equal(await page.locator('#proj-table .project-address').first().innerText(), address);
      await page.evaluate(() => { nav('#/design'); render(); });
      assert.equal(await page.locator('#design-board .project-address').first().innerText(), address);
      for (const route of ['production', 'ship', 'install', 'aftersales']) {
        await page.evaluate(({ name, longAddress }) => {
          S.db.projects.forEach(p => { p.address = longAddress; });
          nav('#/' + name);
          render();
        }, { name: route, longAddress: address });
        const addresses = await page.locator('.content .project-address').allInnerTexts();
        assert.ok(addresses.length > 0, route + ' 没有显示项目地址');
        assert.ok(addresses.some(value => value === address), route + ' 没有完整展示地址');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, route + ' 页面横向溢出: ' + width);
      }
      await page.evaluate(() => { nav('#/todo'); render(); });
      await page.locator('.todo-action').click();
      await page.waitForURL(/#\/project\/.*\/design/);
      assert.equal(await page.locator('.proj-head .no').innerText(), projectNo);
      assert.deepEqual(errors, [], '页面脚本错误: ' + width);
      results.push({ width, projectNo, layout });
      await context.close();
    }
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ ok: true, results }, null, 2));
    process.stdout.write(JSON.stringify({ ok: true, folder, results }, null, 2) + '\n');
  } catch (error) {
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ ok: false, error: error.stack, output }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
