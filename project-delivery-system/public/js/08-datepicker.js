/* ============ 08 日期选择器：自绘中文日历（替代浏览器原生日历控件） ============
   用法：普通日期字段直接用 inp(name,'date',value)，02-components.js 会输出 .dp-input，
   点击任意 .dp-input 即弹出本文件实现的中文日历。全站 22 处日期字段自动生效。
*/
'use strict';

const DP_WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const DP = { el: null, input: null, y: 0, m: 0 };

function dpPad(n) { return (n < 10 ? '0' : '') + n; }
function dpFmt(y, m, d) { return y + '-' + dpPad(m) + '-' + dpPad(d); }
function dpNow() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }
function dpTodayStr() { const t = dpNow(); return dpFmt(t.y, t.m, t.d); }
/* 解析 YYYY-MM-DD；非法/空返回 null */
function dpParse(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const chk = new Date(y, mo - 1, d);
  if (chk.getFullYear() !== y || chk.getMonth() !== mo - 1 || chk.getDate() !== d) return null;
  return { y: y, m: mo, d: d };
}
/* 月历网格：周一为首列，固定 42 格（6 行），避免翻月时高度跳动 */
function dpCells(y, m) {
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一 = 0
  const days = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  const cells = [];
  for (let i = lead; i > 0; i--) cells.push({ d: prevDays - i + 1, out: true });
  for (let d = 1; d <= days; d++) cells.push({ d: d, out: false });
  let n = 1;
  while (cells.length < 42) cells.push({ d: n++, out: true });
  return cells;
}
function dpClose() {
  if (DP.el && DP.el.remove) DP.el.remove();
  DP.el = null; DP.input = null;
}
function dpRender() {
  if (!DP.el) return;
  const sel = dpParse(DP.input.value);
  const today = dpTodayStr();
  DP.el.querySelector('.dp-title').textContent = DP.y + '年' + DP.m + '月';
  DP.el.querySelector('.dp-grid').innerHTML = dpCells(DP.y, DP.m).map((c) => {
    const isOn = sel && !c.out && sel.y === DP.y && sel.m === DP.m && sel.d === c.d;
    const isToday = !c.out && dpFmt(DP.y, DP.m, c.d) === today;
    return '<div class="dp-day' + (c.out ? ' out' : '') + (isOn ? ' on' : '') + (isToday ? ' today' : '') +
      '" data-day="' + (c.out ? '' : c.d) + '">' + c.d + '</div>';
  }).join('');
}
function dpPlace(input, pop) {
  try {
    const r = input.getBoundingClientRect();
    const h = pop.offsetHeight || 330;
    const vh = window.innerHeight || 800;
    pop.style.left = Math.round(r.left) + 'px';
    pop.style.minWidth = Math.max(244, Math.round(r.width)) + 'px';
    pop.style.top = (r.bottom + 6 + h > vh ? Math.max(8, Math.round(r.top - h - 6)) : Math.round(r.bottom + 6)) + 'px';
  } catch (e) { /* 无布局信息的宿主环境：用 CSS 默认定位 */ }
}
function openDatePicker(input) {
  if (!input) return;
  dpClose();
  const pop = document.createElement('div');
  pop.className = 'dp-pop';
  pop.innerHTML =
    '<div class="dp-head">' +
    '<button type="button" class="dp-nav" data-nav="-1" title="上个月">' + ico('chevronLeft', 16) + '</button>' +
    '<div class="dp-title"></div>' +
    '<button type="button" class="dp-nav" data-nav="1" title="下个月">' + ico('chevronRight', 16) + '</button>' +
    '</div>' +
    '<div class="dp-week">' + DP_WEEK.map((w) => '<span>' + w + '</span>').join('') + '</div>' +
    '<div class="dp-grid"></div>' +
    '<div class="dp-foot"><button type="button" data-act="clear">清除</button><button type="button" data-act="today">今天</button></div>';
  document.body.appendChild(pop);
  DP.el = pop; DP.input = input;
  const cur = dpParse(input.value) || dpNow();
  DP.y = cur.y; DP.m = cur.m;
  dpRender(); dpPlace(input, pop);
}
function dpShift(delta) {
  DP.m += delta;
  if (DP.m < 1) { DP.m = 12; DP.y--; }
  if (DP.m > 12) { DP.m = 1; DP.y++; }
  dpRender();
}
function dpPick(day) {
  if (!DP.input) return;
  DP.input.value = dpFmt(DP.y, DP.m, day);
  try { DP.input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* 宿主环境不支持时忽略 */ }
  dpClose();
}
function dpClear() {
  if (DP.input) {
    DP.input.value = '';
    try { DP.input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* 忽略 */ }
  }
  dpClose();
}
function dpPickToday() { const t = dpNow(); DP.y = t.y; DP.m = t.m; dpPick(t.d); }
/* 事件委托：任意 .dp-input 点击即弹日历；弹窗内的翻月/选日/清除/今天在此处理 */
function dpClick(e) {
  const t = e && e.target;
  if (!t || !t.closest) return;
  const input = t.closest('input.dp-input');
  if (input) { if (e.preventDefault) e.preventDefault(); openDatePicker(input); return; }
  const pop = t.closest('.dp-pop');
  if (!pop || !DP.el) { if (DP.el && !pop) dpClose(); return; }
  const nav = t.closest('[data-nav]');
  if (nav) { dpShift(Number(nav.getAttribute('data-nav'))); return; }
  const day = t.closest('[data-day]');
  if (day && day.getAttribute('data-day')) { dpPick(Number(day.getAttribute('data-day'))); return; }
  const act = t.closest('[data-act]');
  if (act) { if (act.getAttribute('data-act') === 'today') dpPickToday(); else dpClear(); }
}
document.addEventListener('click', dpClick);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && DP.el) dpClose(); });
