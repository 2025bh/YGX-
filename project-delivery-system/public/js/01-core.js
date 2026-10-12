/* ============ 01 核心：状态 / 请求 / 路由 / 弹窗 ============ */
'use strict';

const S = {
  me: null,        // 当前用户
  db: null,        // bootstrap 数据
  detail: null,    // 当前项目详情
  notifOpen: false,
  backTo: null,    // 下钻页面的返回目标
  simpleMode: false,
};

/* ---------- 工具 ---------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(d) { if (!d) return '—'; return String(d).slice(0, 10); }
function fmtDT(d) { if (!d) return '—'; return String(d).replace('T', ' ').slice(0, 16); }
function money(n) { n = Number(n) || 0; return '¥' + n.toLocaleString('zh-CN'); }
function esc(s) { return encodeURIComponent(s); }

function starsHtml(r, picker) {
  r = Number(r) || 0;
  if (picker) {
    let out = '<div class="star-picker" data-star>';
    for (let i = 1; i <= 5; i++) out += '<span class="' + (i <= r ? 'on' : '') + '" data-v="' + i + '">★</span>';
    return out + '</div>';
  }
  let out = '<span class="stars">';
  for (let i = 1; i <= 5; i++) out += i <= r ? '★' : '<span class="off">★</span>';
  return out + '</span>';
}

/* ---------- 请求 ---------- */
async function api(path, opts) {
  opts = opts || {};
  const flow = path.match(/^\/api\/(design|production|install)\/([^/]+)\/(advance|save|rollback|resume)$/);
  if (flow && opts.body && S.detail) {
    const record = S.detail[flow[1]];
    if (record && record.id === flow[2]) opts.body = { ...opts.body, expected_status: record.status, expected_updated_at: record.updated_at };
  }
  const cfg = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { cfg.headers['Content-Type'] = 'application/json'; cfg.body = JSON.stringify(opts.body); }
  const res = await fetch(path, cfg);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) { S.me = null; render(); throw new Error(data.msg || '请先登录'); }
  if (!data.ok) throw new Error(data.msg || '请求失败');
  if (flow && ['save', 'advance'].includes(flow[3]) && S.me) {
    try { localStorage.removeItem('ygx-v22-draft:' + S.me.id + ':' + flow[1] + ':' + flow[2] + ':' + opts.body.expected_status); } catch (_) {}
  }
  return data;
}
async function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const btn = $('#uploading-ind');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?name=' + esc(file.name));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.onload = () => { try { const r = JSON.parse(xhr.responseText); r.ok ? resolve(r) : reject(new Error(r.msg)); } catch (e) { reject(new Error('上传失败')); } };
    xhr.onerror = () => reject(new Error('上传失败'));
    xhr.send(file);
  });
}

/* ---------- Toast ---------- */
function toast(msg, type) {
  let w = $('.toast-wrap');
  if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 2600);
}

/* ---------- 弹窗 ---------- */
function openModal(html, wide) {
  closeModal();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '">' + html + '</div>';
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  document.body.appendChild(mask);
  const x = $('.modal .mhead .x', mask);
  if (x) x.onclick = closeModal;
  /* 弹窗内所有文本域自动挂上「语音输入 + AI 整理」（手机端厂长们用得上） */
  try { attachVoiceInputs(mask); } catch (e) { /* 环境不支持时静默跳过 */ }
  return mask;
}
function closeModal() { $$('.modal-mask').forEach((m) => m.remove()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- 路由 ---------- */
function nav(hash) { location.hash = hash; }
/* 带返回目标的跳转（下钻场景：从哪来回哪去） */
function navTo(hash, back) { S.backTo = back || '#/dashboard'; location.hash = hash; }
/* 返回：优先回到记录的来源，其次浏览器上一页，最后回总览 */
function goBack() {
  if (S.backTo) { const t = S.backTo; S.backTo = null; nav(t); return; }
  if (window.history && window.history.length > 1) { window.history.back(); return; }
  nav('#/dashboard');
}
function parseRoute() {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const seg = raw.split('/').filter(Boolean);
  return { name: seg[0] || 'dashboard', args: seg.slice(1) };
}

/* ---------- 权限辅助（前端展示层；服务端另有强制校验） ---------- */
const isA = () => !!S.me && S.me.roles.includes('admin');
/* 老的「语义角色名」→ 能力。让 hasRole('production')/hasRole('install') 这类判断也能命中，
   否则生产/安装人员因组 key 叫 woodwork/installer 而永远进不了自己的节点（前端判定的隐形 bug） */
const ROLE2CAP = { production: 'prod', install: 'install', installer: 'install', designer: 'designer', sales: 'sales', admin: 'admin', woodwork: 'prod', painting: 'prod', shipping: 'prod', hardware: 'prod' };
const hasRole = (r) => !!S.me && (S.me.roles.includes(r) || (ROLE2CAP[r] ? hasCap(ROLE2CAP[r]) : false));
const hasAnyRole = (rs) => !!S.me && rs.some((r) => hasRole(r));
function myPerms() { return (S.me && S.me.perms) || { pages: [], scope: 'self', actions: [] }; }
/* 能否访问某个页面 */
function canPage(p) { return myPerms().pages.indexOf(p) >= 0; }
/* 是否具备某个关键动作权限 */
function canAct(a) { return (myPerms().actions || []).indexOf(a) >= 0; }
/* 当前用户是否具备任一角色（管理层视为具备全部） */
function canSeeRole(roles) { return isA() || roles.some((r) => hasRole(r)); }
/* 能否新建项目：销售 / 外接负责人 / 管理层 */
function canNewProject() { return isA() || hasRole('sales') || canAct('new_external'); }
/* 能否管理员工 */
function canStaff() { return isA() || canAct('staff_manage'); }

/* ---------- 权限组（部门）与能力 ---------- */
/* 全部权限组（服务端下发，含成员数） */
function groupsMeta() { return (S.db && S.db.meta && S.db.meta.groups) || []; }
function groupByKey(k) { return groupsMeta().find((g) => g.key === k) || null; }
/* 我所属全部权限组的能力并集 */
function myCaps() {
  const out = [];
  ((S.me && S.me.roles) || []).forEach((k) => { const g = groupByKey(k); if (g) (g.caps || []).forEach((c) => { if (out.indexOf(c) < 0) out.push(c); }); });
  return out;
}
function hasCap(c) { return myCaps().indexOf(c) >= 0; }

/* 岗位名称（取服务端下发的角色字典） */
function roleLabel(r) {
  const m = (S.db && S.db.meta && S.db.meta.roles) || {};
  return (m[r] && m[r].name) || r;
}
function rolesLabel(arr) { return (arr || []).map(roleLabel).join(' / '); }
function scopeLabel(k) {
  const list = (S.db && S.db.meta && S.db.meta.scopes) || [];
  const hit = list.find((s) => s.key === k);
  return hit ? hit.name : (k || '—');
}
function pageLabel(k) {
  const list = (S.db && S.db.meta && S.db.meta.pages) || [];
  const hit = list.find((p) => p.key === k);
  return hit ? hit.name : k;
}
function actionLabel(k) {
  const list = (S.db && S.db.meta && S.db.meta.actions) || [];
  const hit = list.find((a) => a.key === k);
  return hit ? hit.name : k;
}
/* 能力标签名称 */
function capLabel(k) {
  const list = (S.db && S.db.meta && S.db.meta.caps) || [];
  const hit = list.find((c) => c.key === k);
  return hit ? hit.name : k;
}
/* 成品/清仓 的简化节点表（与后端一致）：设计只走「客户最终确认」，生产只走「组装打包→出货申请→准备出货（→出货完成）」 */
function designStageList(type) {
  const m = (S.db && S.db.consts && S.db.consts.DESIGN_STAGES_BY_TYPE) || {};
  return m[type] || (S.db && S.db.consts && S.db.consts.DESIGN_STAGES) || [];
}
function prodStageList(type) {
  const m = (S.db && S.db.consts && S.db.consts.PROD_STAGES_BY_TYPE) || {};
  return m[type] || (S.db && S.db.consts && S.db.consts.PROD_STAGES) || [];
}
function installStageList() { return (S.db && S.db.consts && S.db.consts.INSTALL_STAGES) || []; }

/* ---------- 流程规格（服务端 spec.js 下发，前后端共用同一份定义） ---------- */
function flowOfType(t) { const m = (S.db && S.db.consts && S.db.consts.FLOW) || {}; return m[t] || null; }
/* 某表单某节点的字段定义清单 */
function nodeFields(scope, stage) {
  const m = (S.db && S.db.consts && S.db.consts.NODE_FIELDS) || {};
  return ((m[scope] || {})[stage]) || [];
}
/* 某节点允许操作的能力标签（admin / sales / designer / prod / install） */
function nodeActors(scope, stage) {
  const m = (S.db && S.db.consts && S.db.consts.NODE_ACTORS) || {};
  return ((m[scope] || {})[stage]) || [];
}
function nodeActorsLabel(scope, stage) {
  const a = nodeActors(scope, stage);
  if (!a.length) return '系统自动';
  return a.map((c) => (c === 'sales' ? '负责销售' : capLabel(c))).join(' / ');
}
function canEditExternalProduction(project, task, stage) {
  return !!S.me && S.me.roles.includes('external') &&
    ['下单备料', '材料到场', '生产开料', '木工制作', '原件打磨'].includes(stage) &&
    ((project.project_type === 'WJ' && project.sales_id === S.me.id) ||
      [task?.production_manager_id, ...(task?.production_manager_ids || [])].includes(S.me.id));
}
/* 某节点是否由我操作 */
function canOperateNode(p, scope, stage) {
  if (isA()) return true;
  const caps = nodeActors(scope, stage);
  if (caps.includes('sales')) return hasCap('sales') && p.sales_id === S.me.id;
  if (caps.includes('designer')) {
    if (hasCap('designer')) {
      const d = S.detail && S.detail.design;
      if (!d || !d.designer_id) return true;
      if (d.designer_id === S.me.id) return true;
    }
    if (p.project_type === 'WJ') return true;   // 外接单：生产部可代录设计节点
    if (['CP', 'QC'].includes(p.project_type) && hasCap('sales') && p.sales_id === S.me.id) return true;
  }
  if (p.project_type === 'WJ' && (hasCap('prod') || p.sales_id === S.me.id)) return true;
  if (scope === 'production' && canEditExternalProduction(p, S.detail?.production, stage)) return true;
  if (caps.includes('prod') && hasCap('prod')) return true;
  if (caps.includes('install') && hasCap('install')) return true;
  return false;
}

/* 侧边栏导航：按「可见页面」权限生成 */
const NAV_DEFS = [
  { key: 'dashboard', ic: 'chart', label: '项目总览' },
  { key: 'projects', ic: 'folder', label: '项目列表' },
  { key: 'design', ic: 'pen', label: '设计任务' },
  { key: 'production', ic: 'factory', label: '生产看板' },
  { key: 'ship', ic: 'truck', label: '出货审批' },
  { key: 'install', ic: 'wrench', label: '安装管理' },
  { key: 'aftersales', ic: 'support', label: '售后服务' },
  { key: 'reports', ic: 'trend', label: '数据报表' },
  { key: 'staff', ic: 'userCheck', label: '员工管理' },
];
function navItems() {
  const items = NAV_DEFS.filter((d) => canPage(d.key)).map((d) => Object.assign({}, d, { show: true }));
  /* 「字段设置」不是普通业务页面，只有能管员工的人才看得到 */
  if (canStaff()) items.push({ key: 'fields', ic: 'sliders', label: '字段设置', show: true });
  items.push({ key: 'my', ic: 'user', label: '我的', show: true });
  return items;
}

/* ---------- 数据辅助 ---------- */
function projOf(id) { return S.db.projects.find((p) => p.id === id); }
function userNameById(id) { const u = S.db.users.find((x) => x.id === id); return u ? u.name : '—'; }
function typeName(t) { return (S.db.consts.PROJECT_TYPES[t] || t) + ' ' + t; }
function statusBadge(st) {
  const map = { '未启动': 'b-gray', '设计中': 'b-blue', '生产中': 'b-amber', '安装中': 'b-purple', '已完成': 'b-green', '异常': 'b-red', '已终止': 'b-gray' };
  return '<span class="badge ' + (map[st] || 'b-gray') + '">' + h(st) + '</span>';
}
function typeBadge(t) { return '<span class="tag-type t-' + h(t) + '">' + h(S.db.consts.PROJECT_TYPES[t] || t) + '</span>'; }
function fileLink(fid, name) {
  if (!fid) return '—';
  return '<a href="/api/files/' + esc(fid) + '" target="_blank">' + ico('file', 14) + ' ' + h(name || '附件') + '</a>';
}
function findApproval(pid) { return (S.db.approvals || []).find((a) => a.project_id === pid); }
