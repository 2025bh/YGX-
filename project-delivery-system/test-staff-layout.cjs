'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('@playwright/test');

(async () => {
  const namespace = 'staff-layout-' + Date.now();
  const folder = path.join(__dirname, 'test-results', namespace);
  fs.mkdirSync(folder, { recursive: true });
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname,
    env: { ...process.env, YGX_MODE: 'demo', YGX_PORT: String(port), YGX_DEMO_NAMESPACE: namespace }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', browser;
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const results = [], errors = [];
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
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.locator('#lg-user').fill('demo_owner');
      await page.locator('#lg-pass').fill('123456');
      await page.locator('#lg-pass').press('Enter');
      await page.waitForFunction(() => S.me && S.me.username === 'demo_owner');
      await page.goto(base + '/#/staff');
      await page.locator('.staff-table tbody tr').first().waitFor();
      const measurement = await page.evaluate(() => {
        const table = document.querySelector('.staff-table');
        const wrap = table.closest('.staff-table-wrap');
        const row = table.tBodies[0].rows[0];
        const cells = [...row.cells];
        return {
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          tableScroll: wrap.scrollWidth > wrap.clientWidth,
          nameLines: cells[0].querySelector('b').getClientRects().length,
          nameWidth: Math.round(cells[0].getBoundingClientRect().width),
          pagesWidth: Math.round(cells[5].getBoundingClientRect().width),
          actionsWidth: Math.round(cells[6].getBoundingClientRect().width),
          operationVisible: cells[9].getBoundingClientRect().right <= wrap.getBoundingClientRect().right + 1,
        };
      });
      assert.equal(measurement.pageOverflow, false, '页面不应整体横向滚动：' + width);
      assert.equal(measurement.nameLines, 1, '姓名不应拆行：' + width);
      assert.ok(measurement.nameWidth >= 88 && measurement.pagesWidth >= 218 && measurement.actionsWidth >= 218, '列宽不足：' + width);
      if (width > 1000) assert.equal(measurement.operationVisible, true, '桌面操作列需保持可见：' + width);
      await page.locator('.staff-table').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(folder, 'staff-' + width + '.png') });
      if (width <= 1000) {
        const endVisible = await page.evaluate(() => {
          const wrap = document.querySelector('.staff-table-wrap');
          wrap.scrollLeft = wrap.scrollWidth;
          return wrap.querySelector('td:last-child').getBoundingClientRect().right <= wrap.getBoundingClientRect().right + 1;
        });
        assert.equal(endVisible, true, '横向滑到末尾应能看到操作列：' + width);
        await page.screenshot({ path: path.join(folder, 'staff-actions-' + width + '.png') });
      }
      results.push({ width, ...measurement });
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ folder, results, errors }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    fs.writeFileSync(path.join(folder, 'server.log'), output);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
