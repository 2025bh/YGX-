'use strict';
/* ============================================================
 * 忆古轩家居 · 项目全流程管理系统（本地独立部署版）
 * 零依赖 Node.js 服务：静态资源 + REST API + JSON 文件存储
 * 启动: node server.js  (默认端口 8199, 被占用时自动 +1)
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createJsonStore } = require('./json-store');
const CUSTOM_FIELDS = require('./custom-fields');

if (process.env.YGX_MODE !== 'demo') throw new Error('v2.2 当前仅限隔离演示，启动需设置 YGX_MODE=demo');
const PORT = parseInt(process.env.YGX_PORT || '8299', 10);
/* 正式部署（HTTPS）时置 1：Cookie 仅通过加密连接传输 */
const COOKIE_SECURE = process.env.YGX_COOKIE_SECURE === '1';
/* 会话 Cookie 统一属性：HttpOnly 防脚本读取，SameSite 防跨站携带 */
const COOKIE_ATTRS = '; HttpOnly; Path=/; SameSite=Lax' + (COOKIE_SECURE ? '; Secure' : '');
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const namespace = process.env.YGX_DEMO_NAMESPACE || 'preview';
if (!/^[a-zA-Z0-9-]+$/.test(namespace)) throw new Error('无效的演示数据命名空间');
const DATA_DIR = path.join(ROOT, 'demo-data', namespace);
const UPLOAD_DIR = path.join(ROOT, 'demo-uploads', namespace);
const DB_FILE = path.join(DATA_DIR, 'db.json');
const STORE = createJsonStore(DB_FILE);

for (const d of [DATA_DIR, UPLOAD_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

/* ---------------- 基础工具 ---------------- */
const uid = (p) => (p || 'id') + '_' + crypto.randomBytes(6).toString('hex');
let lastClock = 0;
const now = () => new Date(lastClock = Math.max(Date.now(), lastClock + 1)).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const pad3 = (n) => String(n).padStart(3, '0');
function ym() { const d = new Date(); return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0'); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

/* ---------------- 业务常量 ----------------
 * 流程规格（阶段表 / 节点字段 / 操作岗位）全部集中在 spec.js，
 * 后端校验与前端表单共用同一份定义 —— 改流程只改 spec.js。 */
const SPEC = require('./spec');
const FEISHU = require('./feishu');
const CONTROL = require('./workflow-control');
const PROJECT_TYPES = { CP: '成品', DZ: '定制', WJ: '外接', QC: '清仓', BS: '板式' };
const PROJECT_STATUS = ['未启动', '设计中', '生产中', '分批生产/出货中', '安装中', '已完成', '异常', '已终止'];
const FLOW = SPEC.FLOW;
const designStagesFor = SPEC.designStagesFor;
const prodStagesFor = SPEC.prodStagesFor;
const INSTALL_STAGES = SPEC.INSTALL_STAGES;
const AFTER_STAGES = SPEC.AFTER_STAGES;
const SHIP_STEPS = SPEC.SHIP_STEPS;
const APPROVAL_STATUS = SPEC.APPROVAL_STATUS;
const NODE_FIELDS = SPEC.NODE_FIELDS;
const NODE_ACTORS = SPEC.NODE_ACTORS;
const flowOf = SPEC.flowOf;

/* 兼容旧引用 */
const SIMPLE_TYPES = ['CP', 'QC'];
const DESIGN_STAGES = FLOW.DZ.design;
const PROD_STAGES = FLOW.DZ.prod;
const DESIGN_STAGES_BY_TYPE = { CP: FLOW.CP.design, QC: FLOW.QC.design, DZ: FLOW.DZ.design, BS: FLOW.BS.design, WJ: FLOW.WJ.design };
const PROD_STAGES_BY_TYPE = { CP: FLOW.CP.prod, QC: FLOW.QC.prod, DZ: FLOW.DZ.prod, BS: FLOW.BS.prod, WJ: FLOW.WJ.prod };
const SOURCE_CHANNELS = ['线上客资', '客户介绍', '自然到店', '合作商家', '其他渠道'];
/* 自定义字段：表单范围 + 字段类型（管理员可在「员工管理 → 表单字段设置」里增删改）
   注意：这里是「附加字段」，流程内置字段以 spec.js 的 NODE_FIELDS 为准。 */
const FIELD_SCOPES = { project: '项目总表', design: '设计任务', production: '生产任务', install: '安装任务', aftersales: '售后工单' };
const FIELD_TYPES = CUSTOM_FIELDS.types;
const STAGES_BY_SCOPE = { project: [''], design: DESIGN_STAGES, production: PROD_STAGES, install: INSTALL_STAGES, aftersales: AFTER_STAGES };

/* 管理员附加字段的预置：默认留空，全部流程字段由 spec.js 提供 */
const DEFAULT_FIELDS = [];
const CONSTS = {
  PROJECT_TYPES, PROJECT_STATUS, DESIGN_STAGES, PROD_STAGES, INSTALL_STAGES, AFTER_STAGES, SHIP_STEPS, SOURCE_CHANNELS,
  DESIGN_STAGES_BY_TYPE, PROD_STAGES_BY_TYPE, SIMPLE_TYPES, FIELD_SCOPES, FIELD_TYPES, STAGES_BY_SCOPE,
  /* 下发给前端：节点字段总表 + 操作岗位 + 出货审批状态机 */
  NODE_FIELDS, NODE_ACTORS, FLOW, APPROVAL_STATUS,
};

/* ---------------- 权限体系 ---------------- */
/* 可见页面 */
const PAGE_DEFS = [
  { key: 'dashboard', name: '项目总览' },
  { key: 'projects', name: '项目列表' },
  { key: 'design', name: '设计任务' },
  { key: 'production', name: '生产看板' },
  { key: 'ship', name: '出货审批' },
  { key: 'install', name: '安装管理' },
  { key: 'aftersales', name: '售后服务' },
  { key: 'reports', name: '数据报表' },
  { key: 'staff', name: '员工管理' },
];
const ALL_PAGES = PAGE_DEFS.map((p) => p.key);

/* 数据可见范围 */
const SCOPE_DEFS = [
  { key: 'all', name: '全部数据', desc: '可查看系统内所有项目' },
  { key: 'self', name: '仅自己创建的', desc: '只能看到自己创建/负责的项目' },
  { key: 'assigned', name: '仅分配给自己的', desc: '只能看到分配给自己任务的项目' },
  { key: 'prod', name: '全部生产项目', desc: '可看到所有进入生产的项目' },
  { key: 'install', name: '安装与售后项目', desc: '可看到安装任务与售后工单相关项目' },
];

/* 关键动作 */
const ACTION_DEFS = [
  { key: 'ship_approve', name: '出货审批' },
  { key: 'material_approve', name: '材料下单审批' },
  { key: 'material_purchase', name: '材料/五金采购负责' },
  { key: 'new_external', name: '创建外接项目' },
  { key: 'project_terminate', name: '项目终止' },
  { key: 'aftersales_dispatch', name: '售后派工' },
  { key: 'staff_manage', name: '员工管理' },
];
const ALL_ACTIONS = ACTION_DEFS.map((a) => a.key);

/* 能力标签：系统内部一律按「能力」判定业务能不能做；
   权限组则是把若干能力 + 页面 + 数据范围打包，发给一组人共用。
   新增权限组时勾上对应能力即可，代码不用改。 */
const CAP_DEFS = [
  { key: 'admin', name: '管理层（全局）', desc: '全部数据 + 全部审批' },
  { key: 'sales', name: '销售（自己项目）', desc: '自己名下项目的设计确认、出货申请、到货确认' },
  { key: 'designer', name: '设计师（设计节点）', desc: '操作分配给自己的设计任务' },
  { key: 'prod', name: '生产部（生产节点）', desc: '生产节点、确认发货时间、安排发货' },
  { key: 'install', name: '安装部（安装/售后）', desc: '安装派单、验收、售后派工' },
];
const ALL_CAPS = CAP_DEFS.map((c) => c.key);

/* 默认权限组（部门）：首次运行写入 db.groups，之后可在「员工管理 → 权限组」里任意增删改 */
const DEFAULT_GROUPS = [
  { key: 'admin', name: '管理层', desc: '全部权限', pages: ALL_PAGES.slice(), scope: 'all', actions: ALL_ACTIONS.slice(), caps: ['admin'], builtin: true },
  { key: 'sales', name: '销售部', desc: '只看自己创建的项目', pages: ['dashboard', 'projects', 'design', 'ship', 'aftersales'], scope: 'self', actions: [], caps: ['sales'], builtin: true },
  { key: 'designer', name: '设计部', desc: '只看分配给自己的设计任务', pages: ['dashboard', 'projects', 'design'], scope: 'assigned', actions: [], caps: ['designer'], builtin: true },
  { key: 'woodwork', name: '木工组', desc: '生产前期节点（下单备料→原件打磨）', pages: ['production'], scope: 'prod', actions: [], caps: ['prod'], builtin: true },
  { key: 'painting', name: '油漆组', desc: '油漆喷刷 / 组装打包 / 外购入库', pages: ['production'], scope: 'prod', actions: [], caps: ['prod'], builtin: true },
  { key: 'hardware', name: '五金采购', desc: '负责外购入库，可查看全部数据', pages: ['dashboard', 'projects', 'design', 'production', 'ship', 'install', 'aftersales', 'reports'], scope: 'all', actions: ['material_purchase'], caps: ['prod'], builtin: true },
  { key: 'shipping', name: '发货组', desc: '负责准备出货与发货', pages: ['production'], scope: 'prod', actions: [], caps: ['prod'], builtin: true },
  { key: 'external', name: '外接组', desc: '可看自己创建的项目及被分配负责的生产任务', pages: ['dashboard', 'projects', 'design', 'production', 'ship'], scope: 'self', actions: ['new_external'], caps: [], builtin: true },
  { key: 'installer', name: '安装组', desc: '负责安装派单、验收与售后', pages: ['dashboard', 'projects', 'install', 'aftersales'], scope: 'install', actions: ['aftersales_dispatch'], caps: ['install'], builtin: true },
  { key: 'finance', name: '财务', desc: '出货单收录 + 出货审批节点', pages: ['dashboard', 'ship'], scope: 'all', actions: ['ship_approve'], caps: [], builtin: true },
];

/* ---------------- 权限组（部门）工具 ---------------- */
/* 权限组存在 db.groups；万一还没初始化就回落到默认组，保证任何时刻都有可用定义 */
function groupsArr() { return (db && Array.isArray(db.groups) && db.groups.length) ? db.groups : DEFAULT_GROUPS; }
function groupMap() { const m = {}; for (const g of groupsArr()) m[g.key] = g; return m; }
const groupExists = (k) => !!groupMap()[k];
/* 一个人的能力 = 他所属全部权限组的能力并集 */
function capsOf(u) {
  if (!u) return [];
  const map = groupMap(); const out = new Set();
  for (const r of (u.roles || [])) { const g = map[r]; if (g) (g.caps || []).forEach((c) => out.add(c)); }
  return Array.from(out);
}
const hasCap = (u, c) => !!u && capsOf(u).includes(c);
/* 老数据兼容：旧角色名 → 新岗位名（须在 loadDB 之前定义，migrateUsers 会用到） */
const ROLE_ALIAS = { production: 'woodwork', install: 'shipping' };

/* ---------------- 数据库 ---------------- */
let db = null;
function loadDB() {
  const loaded = STORE.read();
  if (loaded !== undefined) { db = loaded; migrateUsers(); migrateProjectStages(); migrateProductionManagers(); migrateBatchChoice(); migrateFields(); return; }
  db = { users: [], sessions: {}, projects: [], design: [], production: [], batches: [], installations: [], aftersales: [], approvals: [], notifications: [], logs: [], files: {}, counters: {}, groups: [], field_defs: [], config: { feishu_app_id: '', feishu_app_secret: '', approval_code: '', llm_base_url: '', llm_api_key: '', llm_model: '', llm_enabled: false } };
  seed(db);
  db.projects.forEach((p, i) => { p.customer_name = '演示客户' + (i + 1); p.customer_phone = ''; p.address = '虚构测试地址' + (i + 1); p.process_version = '2.2-preview'; });
  saveDB();
}
function saveDB() { STORE.write(db); }

/* ---------------- 种子数据 ---------------- */
/* 由「所属权限组」实时汇总默认权限：改组即全组生效，不必逐人改 */
function permsFromRoles(roles) {
  const map = groupMap();
  const pages = new Set(); const actions = new Set(); let scope = 'self';
  for (const r of (roles || [])) {
    const d = map[r]; if (!d) continue;
    (d.pages || []).forEach((p) => pages.add(p));
    (d.actions || []).forEach((a) => actions.add(a));
    if (d.scope === 'all') scope = 'all';
    else if (scope !== 'all' && d.scope !== 'self') scope = d.scope;
  }
  return { pages: Array.from(pages), scope, actions: Array.from(actions) };
}
const ALL_PAGES_ARR = ALL_PAGES;
function seed(d) {
  const U = (id, name, username, phone, roles, title) => ({
    id, username, phone: phone || '', name, roles, title,
    pwd: sha('123456'), active: true, custom: false, perms: null,
  });
  /* 权限组（部门）先落库；人的权限由所属组实时派生，改组即全组生效 */
  d.groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));
  /* 名单来源：《员工名单》文档；手机号待厂里补录后可在「员工管理」里直接填 */
  d.users = [
    U('demo-person-001', '演示老板', 'demo_owner', '', ['admin'], '老板'),
    U('demo-person-002', '演示审批主管', 'demo_approver', '', ['admin'], '项目经理兼设计主管'),
    U('demo-person-003', '演示销售主管', 'demo_sales_lead', '', ['admin'], '销售主管'),
    U('demo-person-004', '演示销售甲', 'demo_sales_1', '', ['sales'], '销售'),
    U('demo-person-005', '演示销售乙', 'demo_sales_2', '', ['sales'], '销售'),
    U('demo-person-006', '演示销售丙', 'demo_sales_3', '', ['sales'], '销售'),
    U('demo-person-007', '演示销售丁', 'demo_sales_4', '', ['sales'], '销售'),
    U('demo-person-008', '演示销售戊', 'demo_sales_5', '', ['sales'], '销售'),
    U('demo-person-009', '演示售后客服', 'demo_service', '', ['sales'], '跟单负责人兼售后客服'),
    U('demo-person-010', '演示设计甲', 'demo_designer_1', '', ['designer'], '设计师'),
    U('demo-person-011', '演示设计乙', 'demo_designer_2', '', ['designer'], '设计师'),
    U('demo-person-012', '演示设计丙', 'demo_designer_3', '', ['designer'], '设计师'),
    U('demo-person-013', '演示设计丁', 'demo_designer_4', '', ['designer'], '设计师'),
    U('demo-person-014', '演示木工主管', 'demo_wood', '', ['woodwork'], '木工制作负责人'),
    U('demo-person-015', '演示油漆主管', 'demo_paint', '', ['painting'], '油漆制作负责人'),
    U('demo-person-016', '演示采购负责人', 'demo_purchase', '', ['hardware'], '五金采购负责人'),
    U('demo-person-017', '演示发货负责人', 'demo_shipping', '', ['shipping'], '发货负责人兼物料管理员'),
    U('demo-person-018', '演示外接负责人', 'demo_external', '', ['external'], '外接负责人'),
    { id: uid('u'), username: 'demo_cutting', phone: '', name: '演示开料负责人', roles: ['woodwork'],
      title: '开料负责人', pwd: sha(crypto.randomBytes(32).toString('hex')), active: true, custom: false, perms: null },
    { id: uid('u'), username: 'demo_finance', phone: '', name: '演示财务', roles: ['finance'],
      title: '财务', pwd: sha(crypto.randomBytes(32).toString('hex')), active: true, custom: false, perms: null },
    { id: uid('u'), username: 'demo_install', phone: '', name: '演示安装负责人', roles: ['installer'],
      title: '安装负责人', pwd: sha(crypto.randomBytes(32).toString('hex')), active: true, custom: false, perms: null },
    { id: uid('u'), username: 'demo_admin', phone: '', name: '演示管理员', roles: ['admin'],
      title: '系统管理员', pwd: sha(crypto.randomBytes(32).toString('hex')), active: true, custom: false, perms: null },
  ];
  const byName = (n) => d.users.find((u) => u.name === n);

  // 建项目辅助
  function mkProject(no, type, cust, phone, addr, custType, source, sales, designer, amount, deal, expect, status, extra) {
    const p = Object.assign({
      id: uid('p'), project_no: no, project_type: type, customer_name: cust, customer_phone: phone, address: addr,
      customer_type: custType, source_channel: source, sales_id: sales.id, designer_id: designer ? designer.id : '',
      production_manager_id: '', installer_id: '', after_sales_id: '',
      contract_amount: amount, deal_date: deal, expected_delivery_date: expect, actual_delivery_date: '',
      project_status: status, exception_status: '无异常', exception_desc: '', is_showroom: false, remark: '', skip_install: false, need_install: null,
      created_at: daysAgo(45), updated_at: now(),
    }, extra || {});
    d.projects.push(p);
    return p;
  }
  function log(p, by, text) { d.logs.push({ id: uid('l'), project_id: p.id, at: now(), by: by || '系统', text }); }
  function stageOf(list, idx, label) {
    if (idx < 0 || idx >= list.length) { console.warn('[seed] 阶段下标越界: ' + label + ' idx=' + idx + '，已取最后一个阶段'); return list[list.length - 1]; }
    return list[idx];
  }
  function pickStage(list, name, label) {
    if (!list.includes(name)) { console.warn('[seed] ' + label + ' 阶段「' + name + '」不在类型流程里，已取最后一个'); return list[list.length - 1]; }
    return name;
  }
  function mkDesign(p, designer, stageName, sales) {
    const t = {
      id: uid('dt'), project_id: p.id, task_no: p.project_no + '-SJ', designer_id: designer ? designer.id : '', sales_id: (sales || byName('演示销售甲')).id, splitter_id: '',
      status: pickStage(designStagesFor(p.project_type), stageName, 'DESIGN'), customer_confirm_status: '', customer_confirm_result: '', initial_quotation: '', drawing_version: '',
      assign_date: '', intent_deposit_date: '', design_owner: '演示审批主管', measure_date: '', measure_person: '', draft_complete_date: '',
      remeasure_date: '', drawing_version_remeasure: '', final_drawing_date: '', splitter_start_date: '', splitter_complete_date: '',
      splitter_transfer_date: '', hardware_transfer_date: '', hardware_start_date: '', prod_drawing_receiver: '',
      draft_drawings: '', final_drawings: '', split_drawings: '', quotation: '', contract: '', hardware_list: '', customer_feedback: '', remark: '',
      skipped_stages: [], created_at: p.created_at, updated_at: now(),
    };
    d.design.push(t); log(p, '系统', '项目创建，自动生成设计任务 ' + t.task_no);
    return t;
  }
  function mkProd(p, stageName, mgr, extra) {
    const t = Object.assign({
      id: uid('pt'), project_id: p.id, task_no: p.project_no + '-SC', production_manager_id: mgr ? mgr.id : '', production_manager_ids: mgr ? [mgr.id] : [],
      material_manager_id: '', sales_id: p.sales_id,
      status: pickStage(prodStagesFor(p.project_type), stageName, 'PROD'), material_order_status: '', purchase_order_status: '',
      is_exception: false, exception_logs: [], exception_date: '', exception_resolve_date: '',
      material_order_date: '', wood_arrival_date: '', board_arrival_date: '', material_arrival_status: '', is_batch: stageName === '材料到场' ? '' : '否', batch_flow: false,
      cutting_start_date: '', cutting_complete_date: '', cutting_owner: '',
      woodwork_complete_date: '', woodwork_status: '', polishing_complete_date: '', painting_complete_date: '',
      purchase_order_date: '', purchase_arrival_date: '', assembly_complete_date: '', packaging_complete_date: '',
      fastest_ship_date: '', actual_ship_date: '', agreed_ship_date: '', ship_status: '', ship_remark: '', dispatch_install: '',
      material_list: '', shipping_doc: '', prod_drawing_origin: '', drawing_receive_date: '', remark: '',
      skipped_stages: [], created_at: now(), updated_at: now(),
    }, extra || {});
    d.production.push(t); log(p, '系统', '设计转接生产，自动生成生产任务 ' + t.task_no);
    return t;
  }

  const ll = byName('演示销售甲'), hlm = byName('演示销售丙'), rg = byName('演示销售戊'), jcr = byName('演示销售乙'), lh = byName('演示外接负责人'), wj2 = byName('演示审批主管');
  const zss = byName('演示设计甲'), lx = byName('演示设计乙'), wjp = byName('演示设计丙'), hm = byName('演示设计丁'), qms = byName('演示木工主管'), pyz = byName('演示油漆主管'), zml = byName('演示发货负责人');

  // 1. 设计中：初稿图纸制作
  const p1 = mkProject('DZ' + ym() + '001', 'DZ', '演示客户1', '10000000001', '虚构演示地址1号', 'C端', '线上客资', ll, wj2, 186000, daysAgo(20), daysAgo(-40), '设计中');
  const t1 = mkDesign(p1, wj2, '初稿图纸制作', ll);
  t1.measure_date = daysAgo(16); t1.draft_complete_date = daysAgo(9);

  // 2. 生产中：木工制作 + 生产异常
  const p2 = mkProject('DZ' + ym() + '002', 'DZ', '演示客户2', '10000000002', '虚构演示地址2号', 'C端', '客户介绍', hlm, zss, 265000, daysAgo(38), daysAgo(-20), '生产中');
  const t2 = mkDesign(p2, zss, '设计完成', hlm);
  t2.measure_date = daysAgo(34); t2.draft_complete_date = daysAgo(30); t2.remeasure_date = daysAgo(26);
  t2.splitter_start_date = daysAgo(22); t2.splitter_transfer_date = daysAgo(20); t2.hardware_transfer_date = daysAgo(19); t2.final_drawing_date = daysAgo(19);
  const pr2 = mkProd(p2, '木工制作', byName('演示木工主管'), {
    material_order_status: '已下单', material_order_date: daysAgo(19), wood_arrival_date: daysAgo(15), board_arrival_date: daysAgo(15),
    cutting_start_date: daysAgo(14), cutting_complete_date: daysAgo(11),
  });
  pr2.is_exception = true; pr2.exception_date = daysAgo(3);
  pr2.exception_logs.push({ at: daysAgo(3), by: '演示木工主管', desc: '客户临时增加玄关柜，需补料，木工暂停等待板材到场' });
  p2.exception_status = '生产异常'; p2.exception_desc = '客户临时增加玄关柜，需补料，木工暂停等待板材到场'; p2.project_status = '异常';

  // 3. 板式：出货申请待发起
  const p3 = mkProject('BS' + ym() + '003', 'BS', '演示客户3', '10000000003', '虚构演示地址3号', 'C端', '自然到店', ll, lx, 98000, daysAgo(30), daysAgo(-5), '生产中');
  const t3 = mkDesign(p3, lx, '设计完成', ll);
  t3.measure_date = daysAgo(27); t3.draft_complete_date = daysAgo(24); t3.remeasure_date = daysAgo(20);
  t3.splitter_start_date = daysAgo(16); t3.splitter_complete_date = daysAgo(15); t3.splitter_transfer_date = daysAgo(15); t3.final_drawing_date = daysAgo(15);
  const pr3 = mkProd(p3, '出货申请', qms, {
    material_order_status: '已下单', material_order_date: daysAgo(14), wood_arrival_date: daysAgo(11), board_arrival_date: daysAgo(11),
    cutting_start_date: daysAgo(10), cutting_complete_date: daysAgo(8), woodwork_complete_date: daysAgo(5),
    assembly_complete_date: daysAgo(2), packaging_complete_date: daysAgo(1), skipped_stages: ['原件打磨', '油漆喷刷'],
  });
  d.approvals.push(newApproval(p3, pr3, ''));
  d.notifications.push({ id: uid('n'), user_id: ll.id, text: '【出货申请】项目 ' + p3.project_no + '（' + p3.customer_name + '）已完成生产打包，请发起出货申请', at: now(), read: false, link: '#/project/' + p3.id + '/ship' });

  // 4. 安装中：正在安装
  const p4 = mkProject('DZ' + ym() + '004', 'DZ', '演示客户4', '10000000004', '虚构演示地址4号', 'C端', '合作商家', rg, wjp, 152000, daysAgo(52), daysAgo(-2), '安装中');
  const t4 = mkDesign(p4, wjp, '设计完成', rg);
  t4.measure_date = daysAgo(48); t4.draft_complete_date = daysAgo(44); t4.remeasure_date = daysAgo(40);
  t4.splitter_start_date = daysAgo(35); t4.splitter_transfer_date = daysAgo(33); t4.hardware_transfer_date = daysAgo(32); t4.final_drawing_date = daysAgo(32);
  const pr4 = mkProd(p4, '准备出货', qms, {
    material_order_status: '已下单', material_order_date: daysAgo(31), wood_arrival_date: daysAgo(27), board_arrival_date: daysAgo(27),
    cutting_start_date: daysAgo(26), cutting_complete_date: daysAgo(23), woodwork_complete_date: daysAgo(20), polishing_complete_date: daysAgo(17),
    painting_complete_date: daysAgo(13), assembly_complete_date: daysAgo(9), packaging_complete_date: daysAgo(8),
    fastest_ship_date: daysAgo(6), actual_ship_date: daysAgo(4), agreed_ship_date: daysAgo(5), ship_status: '已出货', dispatch_install: '是',
  });
  d.approvals.push({
    id: uid('ap'), project_id: p4.id, production_task_id: pr4.id, status: '已完成', is_multi_batch: false, quotation: '', address_verified: true, phone_verified: true,
    fastest_ship_date: daysAgo(6), agreed_ship_date: daysAgo(5), actual_ship_date: daysAgo(4), reject_reason: '',
    steps: [
      { name: '销售提交出货申请', at: daysAgo(8), by: '演示销售戊', note: '' }, { name: '管理层审批', at: daysAgo(7), by: '演示老板', note: '财务尾款：已收齐 · 发货条件：达到发货条件' },
      { name: '填写出货信息', at: daysAgo(5), by: '演示销售戊', note: '与客户约定 ' + daysAgo(5) + ' · 分派安装：是' },
      { name: '准备出货 / 实际发货', at: daysAgo(4), by: '演示发货负责人', note: '实际发货 ' + daysAgo(4) },
    ], created_at: daysAgo(8),
  });
  d.installations.push({
    id: uid('it'), project_id: p4.id, task_no: p4.project_no + '-AZ', manager_id: wj2.id, installer_name: '演示安装工甲', sales_id: rg.id,
    status: '正在安装', is_exception: false, exception_desc: '', exception_date: '', exception_resolve_date: '',
    install_address: '虚构演示地址4号 主卧+衣帽间', dispatch_date: daysAgo(3), confirm_install_date: daysAgo(2), start_install_date: daysAgo(1), accept_date: '', accept_result: '', rectification_desc: '',
    customer_confirm_status: '', customer_rating: 0, actual_delivery_date: '', customer_confirm_file: '', remark: '', skipped_stages: [], created_at: daysAgo(4), updated_at: now(),
  });

  // 5. 成品已完成（不走安装）
  const p5 = mkProject('CP' + ym() + '005', 'CP', '演示客户5', '10000000005', '虚构演示地址5号', 'C端', '线上客资', jcr, hm, 36000, daysAgo(25), daysAgo(-3), '已完成', { skip_install: true, actual_delivery_date: daysAgo(4) });
  const t5 = mkDesign(p5, hm, '设计完成', jcr);
  t5.measure_date = daysAgo(24); t5.draft_complete_date = daysAgo(22); t5.remeasure_date = daysAgo(20);
  t5.splitter_start_date = daysAgo(12); t5.splitter_transfer_date = daysAgo(11); t5.final_drawing_date = daysAgo(11); t5.skipped_stages = ['五金单转交'];
  const pr5 = mkProd(p5, '准备出货', byName('演示油漆主管'), {
    purchase_order_status: '已入库', purchase_order_date: daysAgo(9), purchase_arrival_date: daysAgo(7), assembly_complete_date: daysAgo(6), packaging_complete_date: daysAgo(5),
    fastest_ship_date: daysAgo(4), actual_ship_date: daysAgo(4), agreed_ship_date: daysAgo(4), ship_status: '已出货', dispatch_install: '否', skipped_stages: [],
  });
  d.approvals.push({
    id: uid('ap'), project_id: p5.id, production_task_id: pr5.id, status: '已完成', is_multi_batch: false, quotation: '', address_verified: true, phone_verified: true,
    fastest_ship_date: daysAgo(4), agreed_ship_date: daysAgo(4), actual_ship_date: daysAgo(4), reject_reason: '',
    steps: [
      { name: '销售提交出货申请', at: daysAgo(5), by: '演示销售乙', note: '' }, { name: '管理层审批', at: daysAgo(5), by: '演示老板', note: '财务尾款：已收齐 · 发货条件：达到发货条件' },
      { name: '填写出货信息', at: daysAgo(4), by: '演示销售乙', note: '约定 ' + daysAgo(4) + ' · 分派安装：否' },
      { name: '准备出货 / 实际发货', at: daysAgo(4), by: '演示发货负责人', note: '成品直接配送' },
    ], created_at: daysAgo(5),
  });

  // 6. 已完成（含好评）
  const p6 = mkProject('DZ' + ym() + '006', 'DZ', '演示客户6', '10000000006', '虚构演示地址6号', 'C端', '客户介绍', ll, lx, 210000, daysAgo(70), daysAgo(-10), '已完成', { actual_delivery_date: daysAgo(12) });
  const t6 = mkDesign(p6, lx, '设计完成', ll);
  t6.measure_date = daysAgo(66); t6.draft_complete_date = daysAgo(60); t6.remeasure_date = daysAgo(55);
  t6.splitter_start_date = daysAgo(50); t6.splitter_transfer_date = daysAgo(48); t6.hardware_transfer_date = daysAgo(47); t6.final_drawing_date = daysAgo(47);
  const pr6 = mkProd(p6, '准备出货', qms, {
    material_order_status: '已下单', material_order_date: daysAgo(46), wood_arrival_date: daysAgo(42), board_arrival_date: daysAgo(42),
    cutting_start_date: daysAgo(41), cutting_complete_date: daysAgo(38), woodwork_complete_date: daysAgo(33), polishing_complete_date: daysAgo(30),
    painting_complete_date: daysAgo(26), assembly_complete_date: daysAgo(21), packaging_complete_date: daysAgo(20),
    fastest_ship_date: daysAgo(18), actual_ship_date: daysAgo(16), agreed_ship_date: daysAgo(17), ship_status: '已出货', dispatch_install: '是',
  });
  d.installations.push({
    id: uid('it'), project_id: p6.id, task_no: p6.project_no + '-AZ', manager_id: wj2.id, installer_name: '演示安装工乙', sales_id: ll.id,
    status: '安装完成', is_exception: false, exception_desc: '', exception_date: '', exception_resolve_date: '',
    install_address: '虚构演示地址6号 全屋', dispatch_date: daysAgo(15), confirm_install_date: daysAgo(14), start_install_date: daysAgo(14), accept_date: daysAgo(13), accept_result: '合格', rectification_desc: '', install_exception: '否', feedback: '安装师傅很专业，柜体严丝合缝',
    customer_confirm_status: '已确认', customer_rating: 5, actual_delivery_date: daysAgo(12), customer_confirm_file: '', remark: '', skipped_stages: [], created_at: daysAgo(16), updated_at: now(),
  });

  // 7. 外接单（重庆，不走安装）
  const p7 = mkProject('WJ' + ym() + '007', 'WJ', '演示客户7', '10000000007', '虚构演示地址7号', 'B端', '合作商家', lh, zss, 320000, daysAgo(18), daysAgo(-8), '生产中', { skip_install: true });
  const t7 = mkDesign(p7, zss, '设计完成', lh);
  t7.measure_date = daysAgo(15); t7.draft_complete_date = daysAgo(12); t7.remeasure_date = daysAgo(10);
  t7.splitter_start_date = daysAgo(8); t7.splitter_transfer_date = daysAgo(7); t7.final_drawing_date = daysAgo(7); t7.skipped_stages = ['五金单转交'];
  mkProd(p7, '木工制作', lh, {
    material_order_status: '已下单', material_order_date: daysAgo(6), wood_arrival_date: daysAgo(3), board_arrival_date: daysAgo(3),
    cutting_start_date: daysAgo(3), cutting_complete_date: daysAgo(2), woodwork_complete_date: daysAgo(1), skipped_stages: [],
  });

  // 8. 定制 · 分批生产 / 多批次出货（演示新流程：材料到场选了「分批次制作」）
  const p8 = mkProject('DZ' + ym() + '008', 'DZ', '演示客户8', '10000000008', '虚构演示地址8号', 'C端', '客户介绍', hlm, zss, 328000, daysAgo(44), daysAgo(-12), '分批生产/出货中');
  const t8 = mkDesign(p8, zss, '设计完成', hlm);
  t8.assign_date = daysAgo(42); t8.measure_date = daysAgo(40); t8.draft_complete_date = daysAgo(36);
  t8.customer_confirm_status = '已确认'; t8.remeasure_date = daysAgo(30); t8.final_drawing_date = daysAgo(28);
  t8.splitter_start_date = daysAgo(26); t8.splitter_complete_date = daysAgo(24); t8.splitter_transfer_date = daysAgo(23); t8.hardware_transfer_date = daysAgo(22);
  const pr8 = mkProd(p8, '材料到场', qms, {
    material_order_status: '已下单', material_order_date: daysAgo(22), wood_arrival_date: daysAgo(18), board_arrival_date: daysAgo(18),
    material_arrival_status: '部分材料到场', is_batch: '是', batch_flow: true,
  });
  log(p8, '系统', '材料到场：选择分批次制作，项目转入【分批生产 / 出货中】，系统已固定创建第1、第2生产批次');
  const b8a = {
    id: uid('b'), project_id: p8.id, production_task_id: pr8.id, batch_no: 1, batch_name: '第1生产批次',
    status: '已出货', step: '本批次已出货', progress: 100,
    material_arrival_date: daysAgo(18), cutting_complete_date: daysAgo(15), woodwork_complete_date: daysAgo(12), polishing_complete_date: daysAgo(10),
    painting_complete_date: daysAgo(8), packaging_complete_date: daysAgo(7), exception: '否', exception_desc: '',
    ship_no: 1, ship_content: '柜门 · 主卧衣柜', agreed_ship_date: daysAgo(4), actual_ship_date: daysAgo(3), ship_status: '已出货', ship_remark: '柜门先发', approval_id: '', remark: '', created_at: daysAgo(18), updated_at: now(),
  };
  const b8b = {
    id: uid('b'), project_id: p8.id, production_task_id: pr8.id, batch_no: 2, batch_name: '第2生产批次',
    status: '生产完成', step: '本批次出货申请', progress: 100,
    material_arrival_date: daysAgo(17), cutting_complete_date: daysAgo(13), woodwork_complete_date: daysAgo(9), polishing_complete_date: daysAgo(7),
    painting_complete_date: daysAgo(5), packaging_complete_date: daysAgo(3), exception: '是', exception_desc: '墙板有一块色差，已返工重做油漆',
    ship_no: 2, ship_content: '墙板 · 客厅背景墙', agreed_ship_date: '', actual_ship_date: '', ship_status: '待出货', ship_remark: '', approval_id: '', remark: '', created_at: daysAgo(17), updated_at: now(),
  };
  d.batches.push(b8a, b8b);
  d.approvals.push(Object.assign(newApproval(p8, pr8, b8a.id), {
    status: '已完成', is_multi_batch: true, batch_no: 1, ship_content: '柜门 · 主卧衣柜',
    agreed_ship_date: daysAgo(4), actual_ship_date: daysAgo(3), ship_status: '已出货', dispatch_install: '是', customer_confirm_status: '已确认',
    address_verified: true, phone_verified: true, name_verified: true, no_verified: true, finance_paid: '已收齐', ship_condition_ok: '达到发货条件',
    steps: [
      { name: '销售提交出货申请', at: daysAgo(6), by: '演示销售丙', note: '第1生产批次' },
      { name: '管理层审批', at: daysAgo(5), by: '演示老板', note: '财务尾款：已收齐 · 发货条件：达到发货条件' },
      { name: '填写出货信息', at: daysAgo(4), by: '演示销售丙', note: '与客户约定 ' + daysAgo(4) },
      { name: '准备出货 / 实际发货', at: daysAgo(3), by: '演示发货负责人', note: '实际发货 ' + daysAgo(3) },
    ],
  }));
  d.approvals.push(Object.assign(newApproval(p8, pr8, b8b.id), {
    status: '待发起', is_multi_batch: true, batch_no: 2, ship_content: '墙板 · 客厅背景墙',
  }));
  d.notifications.push({ id: uid('n'), user_id: hlm.id, text: '【本批次出货申请】项目 ' + p8.project_no + ' · 第2生产批次 已达可出货条件，请提交本次出货审批', at: now(), read: false, link: '#/project/' + p8.id + '/ship' });

  // 9. 售后工单：执行中
  d.aftersales.push({
    id: uid('as'), ticket_no: 'YGX' + ym() + '001-SH', project_id: p6.id, customer_name: '演示客户6', customer_phone: '10000000006',
    address: '虚构演示地址6号', problem_desc: '衣帽间抽屉滑轨异响，柜门合页松动，需要上门调整', problem_images: '',
    status: '执行中', assignee_id: wj2.id, assignee_name: '演示审批主管', apply_date: daysAgo(2), start_date: daysAgo(1),
    expected_finish_date: daysAgo(-1), actual_finish_date: '', customer_rating: 0, customer_feedback: '', after_sales_doc: '', photos: '', created_at: daysAgo(2), updated_at: now(),
  });

  d.notifications.push({ id: uid('n'), user_id: wj2.id, text: '【售后工单】YGX' + ym() + '001-SH 待处理：衣帽间抽屉滑轨异响', at: daysAgo(2), read: false, link: '#/aftersales' });
  d.notifications.push({ id: uid('n'), user_id: 'demo-person-001', text: '【异常提醒】项目 ' + p2.project_no + '（演示客户2）生产异常：客户临时增加玄关柜，需补料', at: daysAgo(3), read: false, link: '#/project/' + p2.id + '/production' });
  d.notifications.push({ id: uid('n'), user_id: 'demo-person-001', text: '【异常提醒】项目 ' + p2.project_no + ' 生产异常未解决，请关注', at: daysAgo(1), read: false, link: '#/project/' + p2.id + '/production' });
}

loadDB();
FEISHU.setDB(db);

/* ---------------- 会话与权限 ---------------- */
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid || !db.sessions[sid]) return null;
  const s = db.sessions[sid]; const u = db.users.find((x) => x.id === s.userId);
  return u && u.active !== false ? u : null;
}
const isA = (u) => hasCap(u, 'admin');

/* 附加字段表初始化；旧库里与流程内置字段重复的条目自动清理（内置字段统一由 spec.js 提供） */
function migrateFields() {
  let changed = false;
  if (!Array.isArray(db.field_defs)) { db.field_defs = []; changed = true; }
  const specKeys = new Set();
  for (const scope of Object.keys(NODE_FIELDS)) for (const st of Object.keys(NODE_FIELDS[scope])) for (const f of NODE_FIELDS[scope][st]) specKeys.add(scope + '|' + st + '|' + f.key);
  const kept = db.field_defs.filter((f) => {
    if (f.builtin === false) return true;                       // 管理员自建的一律保留
    const dup = specKeys.has(f.scope + '|' + (f.stage || '') + '|' + f.key);
    if (dup) changed = true;
    return !dup;
  });
  if (kept.length !== db.field_defs.length) db.field_defs = kept;
  if (changed) saveDB();
  return changed;
}

/* 阶段迁移：把老库里已经不存在的新阶段表之外的节点，对齐到新流程的第一个节点 */
function migrateProjectStages() {
  let changed = false;
  const remap = (rec, stages, doneLabel) => {
    if (!rec) return;
    if (rec.status === doneLabel || rec.terminated) return;
    if (stages.includes(rec.status)) return;
    rec.status = stages[0]; rec.skipped_stages = [];
  };
  for (const p of db.projects) {
    const dstages = designStagesFor(p.project_type);
    const pstages = prodStagesFor(p.project_type);
    const dt = db.design.find((x) => x.project_id === p.id);
    if (dt && !dstages.includes(dt.status)) { remap(dt, dstages, '设计完成'); changed = true; }
    let pt = db.production.find((x) => x.project_id === p.id);
    if (SIMPLE_TYPES.includes(p.project_type) && !pt) { pt = createProductionTask(p, '系统', { notify: false }); changed = true; }
    if (pt && !pstages.includes(pt.status)) {
      /* 老的「出货完成」→ 对齐到「准备出货」（新流程里它就是最后一个节点） */
      if (pt.status === '出货完成') { pt.status = '准备出货'; pt.ship_done_at = pt.actual_ship_date || today(); }
      else { remap(pt, pstages, '已终止'); }
      changed = true;
    }
    if (SIMPLE_TYPES.includes(p.project_type)) {
      if (pt && !pt.production_manager_id) { const o = paintingOwner(); if (o) { pt.production_manager_id = o.id; changed = true; } }
      if (pt && p.project_status === '设计中') { p.project_status = '生产中'; changed = true; }
      if (p.skip_install !== true) { p.skip_install = true; changed = true; }
      if (p.need_install === undefined) { p.need_install = null; changed = true; }
    }
    /* 安装阶段老节点「确认安装日期」已移除 */
    const it = db.installations.find((x) => x.project_id === p.id);
    if (it && !INSTALL_STAGES.includes(it.status)) {
      if (it.status === '确认安装日期') { it.status = '正在安装'; it.start_install_date = it.start_install_date || it.confirm_install_date || today(); }
      else { it.status = INSTALL_STAGES[0]; }
      changed = true;
    }
    if (it && it.install_address === undefined) { it.install_address = p.address || ''; changed = true; }
  }
  /* v2.1：批次表新增「有效性 / 本批生产内容」，老库批次一律补成有效批次 */
  for (const b of db.batches) {
    if (b.valid === undefined) { b.valid = true; changed = true; }
    if (b.batch_content === undefined) { b.batch_content = ''; changed = true; }
    if (b.void_reason === undefined) { b.void_reason = ''; changed = true; }
  }
  /* v2.1：项目级安装意向 need_install —— 缺失时按已有安装任务 / 出货信息回填 */
  for (const p of db.projects) {
    if (p.need_install !== undefined) continue;
    const aps = db.approvals.filter((a) => a.project_id === p.id);
    const it2 = db.installations.find((x) => x.project_id === p.id);
    if (it2) p.need_install = true;
    else if (aps.some((a) => a.dispatch_install === '是')) p.need_install = true;
    else if (SIMPLE_TYPES.includes(p.project_type) || p.skip_install === true) p.need_install = false;
    else p.need_install = null;
    changed = true;
  }
  if (changed) saveDB();
  return changed;
}

function migrateProductionManagers() {
  let changed = false;
  for (const task of db.production) {
    const design = db.design.find(item => item.project_id === task.project_id);
    const assigned = design?.production_manager_ids;
    if (!design?.splitter_transfer_date || design.status === '转接生产' || design.rollback_pending || task.paused_by ||
        !Array.isArray(assigned) || assigned.length < 2) continue;
    const current = task.production_manager_ids || [];
    if (task.production_manager_id !== assigned[0] || current.length > 1 ||
        (current.length === 1 && current[0] !== assigned[0])) continue;
    task.production_manager_ids = assigned.slice();
    changed = true;
  }
  if (changed) saveDB();
  return changed;
}

function migrateBatchChoice() {
  let changed = false;
  for (const task of db.production) {
    if (task.status !== '材料到场' || task.is_batch !== '否' ||
        Object.prototype.hasOwnProperty.call(task.node_values?.['材料到场'] || {}, 'is_batch')) continue;
    task.is_batch = '';
    changed = true;
  }
  if (changed) saveDB();
  return changed;
}

/* ---------------- 权限判定 ---------------- */
/* 权限组表初始化：老库没有 groups 就按默认组建表；内置组缺字段就补齐 */
function migrateGroups() {
  let changed = false;
  if (!Array.isArray(db.groups) || !db.groups.length) {
    db.groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS)); changed = true;
  } else {
    for (const def of DEFAULT_GROUPS) {
      const g = db.groups.find((x) => x.key === def.key);
      if (!g) continue;
      if (!g.name) { g.name = def.name; changed = true; }
      if (!Array.isArray(g.caps)) { g.caps = def.caps.slice(); changed = true; }
      if (!Array.isArray(g.pages)) { g.pages = def.pages.slice(); changed = true; }
      if (!Array.isArray(g.actions)) { g.actions = def.actions.slice(); changed = true; }
      if (!g.scope) { g.scope = def.scope; changed = true; }
      if (g.key === 'external' && g.desc === '只负责外接项目，只看得见自己创建的') {
        g.desc = def.desc; changed = true;
      }
    }
  }
  return changed;
}
/* 老数据兼容：角色改名 + 补齐 custom/active/phone；指向已删组的人回落到销售部 */
function migrateUsers() {
  let changed = migrateGroups();
  for (const person of [
    ['演示开料负责人', 'demo_cutting', 'woodwork', '开料负责人'],
    ['演示财务', 'demo_finance', 'finance', '财务'],
    ['演示安装负责人', 'demo_install', 'installer', '安装负责人'],
    ['演示管理员', 'demo_admin', 'admin', '系统管理员'],
  ]) {
    if (!db.users.some(u => u.name === person[0])) {
      db.users.push({ id: uid('u'), username: person[1], phone: '', name: person[0],
        roles: [person[2]], title: person[3], pwd: sha(crypto.randomBytes(32).toString('hex')),
        active: true, custom: false, perms: null });
      changed = true;
    }
  }
  const map = groupMap();
  for (const u of db.users) {
    if (Array.isArray(u.roles)) {
      const mapped = u.roles.map((r) => ROLE_ALIAS[r] || r).filter((r) => !!map[r]);
      if (mapped.join(',') !== u.roles.join(',')) { u.roles = mapped.length ? mapped : ['sales']; u.custom = false; changed = true; }
    }
    if (typeof u.phone !== 'string') { u.phone = ''; changed = true; }
    if (u.active === undefined) { u.active = true; changed = true; }
    /* 老库有权限快照但没 custom 标记的，一律归为「跟随权限组」，否则改了组不生效 */
    if (u.custom === undefined) { u.custom = false; changed = true; }
    if (!u.custom && u.perms !== null && u.perms !== undefined) { u.perms = null; changed = true; }
  }
  if (changed) saveDB();
}
/* 一个人最终生效的权限：默认实时跟随所属权限组；本人被单独调过（custom）才用自己的 */
function permsOf(u) {
  if (!u) return { pages: [], scope: 'self', actions: [] };
  if (u.custom && u.perms && Array.isArray(u.perms.pages)) return u.perms;
  return permsFromRoles(u.roles);
}
const scopeOf = (u) => (u ? (permsOf(u).scope || 'self') : 'self');
const canPage = (u, p) => !!u && permsOf(u).pages.includes(p);
const canAct = (u, a) => !!u && (permsOf(u).actions || []).includes(a);
const canConfirmShipFinance = (u) => !!u && u.id !== 'demo-person-002' && ((u.roles || []).includes('finance') || isA(u));
const canApproveShipConditions = (u) => isA(u) && !(u.roles || []).includes('finance');
/* 项目终止：管理层，或权限组里勾了「项目终止」动作权限的人 */
const canTerminate = (u) => isA(u) || canAct(u, 'project_terminate');
const isTerminated = (p) => !!p && p.project_status === '已终止';
/* 生产侧 / 安装侧一律按能力判定，新增权限组勾上能力即可自动纳入 */
const isProd = (u) => hasCap(u, 'prod');
const isInstall = (u) => hasCap(u, 'install');

function notify(userId, text, link) { db.notifications.push({ id: uid('n'), user_id: userId, text, at: now(), read: false, link: link || '' }); }
/* 通知所有具备某能力的人（如「生产部」「管理层」），扩组自动生效 */
function notifyCap(cap, text, link) { notifyCaps([cap], text, link); }
function notifyCaps(caps, text, link) {
  for (const u of db.users) {
    if (u.active === false) continue;
    if (caps.some((c) => hasCap(u, c))) notify(u.id, text, link);
  }
}
/* 通知所有具备某个动作权限的人（如出货审批） */
function notifyPerm(action, text, link) { for (const u of db.users) if (u.active !== false && canAct(u, action)) notify(u.id, text, link); }
/* 按姓名定点通知（流程里的固定责任人：演示采购负责人、演示发货负责人、演示木工主管、演示油漆主管…） */
function userByName(name) { return db.users.find((u) => u.active !== false && u.name === name) || null; }
function notifyByName(name, text, link) { const u = userByName(name); if (u) notify(u.id, text, link); return u; }
function plog(p, by, text) { if (p) db.logs.push({ id: uid('l'), project_id: p.id, at: now(), by: by, text }); }

/* 数据可见范围 */
function visibleProjectIds(u) {
  const scope = scopeOf(u);
  if (scope === 'all') return null; // null = 全部
  const ids = new Set();
  if (scope === 'self') for (const p of db.projects) if (p.sales_id === u.id) ids.add(p.id);
  if ((u.roles || []).includes('external')) {
    for (const task of db.production) {
      if ([task.production_manager_id, ...(task.production_manager_ids || [])].includes(u.id)) ids.add(task.project_id);
    }
  }
  if (scope === 'assigned') {
    for (const t of db.design) if (t.designer_id === u.id || t.splitter_id === u.id) ids.add(t.project_id);
    for (const t of db.production) if (t.production_manager_id === u.id) ids.add(t.project_id);
    for (const t of db.installations) if (t.manager_id === u.id) ids.add(t.project_id);
  }
  if (scope === 'prod') for (const t of db.production) ids.add(t.project_id);
  if (scope === 'install') { for (const t of db.installations) ids.add(t.project_id); for (const t of db.aftersales) ids.add(t.project_id); }
  if (hasCap(u, 'sales')) for (const p of db.projects) if (p.sales_id === u.id) ids.add(p.id);
  return ids;
}
function canSeeProject(u, p) { const ids = visibleProjectIds(u); return ids === null || ids.has(p.id); }
function canSeeFinalQuotation(u, p) { return isA(u) || !!p && p.sales_id === u.id; }
function finalQuotationCustomKeys() {
  return fieldDefs('design').filter(f => f.type === 'file' && f.label === '最终报价表').map(f => f.key);
}
function redactDesignQuotation(record, user, project) {
  if (!record || canSeeFinalQuotation(user, project)) return record;
  const copy = structuredClone(record);
  const customKeys = finalQuotationCustomKeys();
  const strip = value => {
    if (!value || typeof value !== 'object') return;
    delete value.quotation;
    if (value.custom) for (const key of customKeys) delete value.custom[key];
    if (value.node_values) for (const saved of Object.values(value.node_values)) {
      delete saved.quotation;
      for (const key of customKeys) delete saved[key];
    }
    if (Array.isArray(value.file_history)) value.file_history = value.file_history.filter(item => item.field !== '最终报价表');
    if (Array.isArray(value.node_history)) for (const entry of value.node_history) strip(entry.snapshot);
  };
  strip(copy);
  return copy;
}
function containsFileId(value, id) {
  if (value === id) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(part => containsFileId(part, id));
}
function isFinalQuotationFile(record, id) {
  if (!record) return false;
  const keys = finalQuotationCustomKeys();
  const match = value => {
    if (!value || typeof value !== 'object') return false;
    if (value.quotation === id || keys.some(key => value.custom?.[key] === id)) return true;
    if (value.node_values && Object.values(value.node_values).some(saved => saved.quotation === id || keys.some(key => saved[key] === id))) return true;
    if ((value.file_history || []).some(item => item.field === '最终报价表' && item.file_id === id)) return true;
    return (value.node_history || []).some(entry => match(entry.snapshot));
  };
  return match(record);
}
function canReadFile(user, id, file) {
  const linkedProjects = db.projects.filter(project =>
    [project, designOf(project.id), prodOf(project.id), installOf(project.id),
      ...db.batches.filter(item => item.project_id === project.id),
      ...db.approvals.filter(item => item.project_id === project.id),
      ...db.aftersales.filter(item => item.project_id === project.id)].some(record => containsFileId(record, id)));
  if (!linkedProjects.length) return file.by === user.id;
  return linkedProjects.every(project => canSeeProject(user, project) &&
    (!isFinalQuotationFile(designOf(project.id), id) || canSeeFinalQuotation(user, project)));
}
const pubUser = (u) => u && {
  id: u.id, name: u.name, username: u.username, phone: u.phone || '', roles: u.roles,
  groups: (u.roles || []).slice(), custom: !!u.custom,
  title: u.title || '', active: u.active !== false, allow_zoom: u.allow_zoom === true, perms: permsOf(u),
};

/* ---------------- HTTP 基础 ---------------- */
function send(res, code, data, headers) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
  res.end(body);
}
const ok = (res, data) => send(res, 200, Object.assign({ ok: true }, data || {}));
const fail = (res, code, msg) => send(res, code, { ok: false, msg: String(msg || '操作失败') });
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; const max = limit || 20 * 1024 * 1024;
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('文件过大')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  if (req.workflowBody) {
    if (req.workflowRecord) CONTROL.assertCurrent(req.workflowRecord, req.workflowBody);
    return req.workflowBody;
  }
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('请求体格式错误'); }
}
function need(d, k, label) { const v = d[k]; if (v === undefined || v === null || v === '') throw new Error('请填写' + label); }

/* ---------------- 业务辅助 ---------------- */
function nextNo(prefix) {
  const key = prefix + ym();
  db.counters[key] = (db.counters[key] || 0) + 1;
  return key + pad3(db.counters[key]);
}
/* ---------- 自定义字段 ---------- */
const fieldDefs = (scope) => (db.field_defs || []).filter((f) => f.active !== false && (!scope || f.scope === scope));
/* 命中节点：stage 为空 = 全流程字段；否则只在对应节点填写 */
const defsFor = (scope, stage) => fieldDefs(scope).filter((f) => !f.stage || !stage || f.stage === stage).sort((a, b) => (a.order || 0) - (b.order || 0));
function normalizeNodeCustom(data, scope, stage, record) {
  if (data?.custom === undefined) return undefined;
  const custom = data.custom;
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new Error('附加字段格式无效');
  const definitions = defsFor(scope, stage);
  const allowed = new Set(definitions.map(f => f.key));
  if (Object.keys(custom).some(key => !allowed.has(key))) throw new Error('只能填写当前节点的附加字段');
  return CUSTOM_FIELDS.normalize(custom, definitions, db.users, record?.custom);
}
function needCustom(data, scope, stage, record) {
  const submitted = normalizeNodeCustom(data, scope, stage, record);
  if (submitted !== undefined) data.custom = submitted;
  if (submitted !== undefined && (!submitted || typeof submitted !== 'object' || Array.isArray(submitted))) throw new Error('附加字段格式无效');
  const custom = { ...record?.custom, ...submitted };
  for (const f of defsFor(scope, stage)) {
    if (f.type === 'file') {
      const incoming = submitted?.[f.key];
      if (incoming !== undefined && incoming !== null && typeof incoming !== 'string') throw new Error('「' + f.label + '」附件格式无效');
      if (!incoming) custom[f.key] = record?.custom?.[f.key];
      if (custom[f.key] !== undefined && custom[f.key] !== null && typeof custom[f.key] !== 'string') throw new Error('「' + f.label + '」附件格式无效');
    }
    if (!f.required) continue;
    const v = custom[f.key];
    if (!String(v == null ? '' : v).trim()) throw new Error('请填写「' + f.label + '」');
  }
}
/* 白名单落库：只接受已定义字段，防止前端塞入未定义键 */
function mergeCustom(rec, scope, custom, stage) {
  if (!custom || typeof custom !== 'object') return [];
  const defs = new Map((stage === undefined ? fieldDefs(scope) : defsFor(scope, stage)).map((f) => [f.key, f]));
  const saved = [];
  rec.custom = rec.custom || {};
  for (const k of Object.keys(custom)) {
    const definition = defs.get(k);
    if (!definition) continue;
    const v = custom[k];
    if (definition.type === 'file') {
      if (typeof v !== 'string' || !v.trim()) continue;
      if (rec.custom[k] && rec.custom[k] !== v) {
        rec.file_history = rec.file_history || [];
        rec.file_history.push({ stage: rec.status || '', field: definition.label, file_id: rec.custom[k], at: now() });
      }
    }
    rec.custom[k] = typeof v === 'string' ? v.trim() : v;
    saved.push(k);
  }
  return saved;
}

/* ---------------- 流程节点字段（spec 驱动） ----------------
 * NODE_FIELDS[scope][stage] 是唯一事实源：
 *   · 有 col 的字段 → 写记录原生列（业务逻辑继续读原生列）
 *   · 无 col 的字段 → 写 rec.custom[key]
 * 校验与落库都走这里，避免前后端字段对不上。 */
const nodeFieldDefs = (scope, stage) => SPEC.fieldsFor(scope, stage);
const fieldValueOf = (rec, f) => (f.col ? rec[f.col] : (rec.custom || {})[f.key]);
function nodeRequiredFields(scope, stage, d, rec) {
  /* rec 参与条件判断：条件字段的值可能来自记录里已有的内容（如异常报备） */
  const probe = Object.assign({}, (rec && rec.custom) || {}, rec || {}, d || {});
  return nodeFieldDefs(scope, stage).filter((f) => {
    if (!f.required && !f.when) return false;
    if (f.when) return String(probe[f.when.key] == null ? '' : probe[f.when.key]) === String(f.when.eq);
    return true;
  });
}
/* 校验：必填 + 条件必填 */
function needNode(scope, stage, d, rec) {
  for (const f of nodeRequiredFields(scope, stage, d, rec)) {
    const v = d[f.key];
    if (v === undefined || v === null || String(v).trim() === '' || (f.type === 'checkbox' && v !== true)) {
      const cond = f.when ? '（' + (nodeFieldDefs(scope, stage).find((x) => x.key === f.when.key) || {}).label + '为「' + f.when.eq + '」时必填）' : '';
      throw new Error('请填写「' + f.label + '」' + cond);
    }
  }
}
function nodeUserCandidates(f) {
  return db.users.filter(u => u.active !== false &&
    !(f.excludeNames || []).includes(u.name) &&
    (!f.allowedNames || f.allowedNames.includes(u.name)) &&
    (!f.cap || hasCap(u, f.cap)));
}
/* 落库：按 spec 把 data 里的节点字段写进记录（原生列 / custom） */
function applyNodeFields(rec, scope, stage, d) {
  const saved = [];
  for (const f of nodeFieldDefs(scope, stage)) {
    const v = d[f.key];
    if (v === undefined || v === '' || f.readonly) continue;
    if (f.type === 'select' && !(f.options || []).includes(v)) throw new Error('「' + f.label + '」选项无效');
    if (['number', 'money', 'stars'].includes(f.type) && (!Number.isFinite(Number(v)) || Number(v) < 0)) throw new Error('「' + f.label + '」必须为有效数字');
    if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)))) throw new Error('「' + f.label + '」日期无效');
    if (['text', 'textarea', 'file', 'date', 'user'].includes(f.type) && typeof v !== 'string') throw new Error('「' + f.label + '」格式无效');
    if (f.type === 'user' || f.type === 'users') {
      const ids = f.type === 'users' ? (Array.isArray(v) ? v : String(v).split(',')).map(x => String(x).trim()).filter(Boolean) : [v];
      const candidates = new Set(nodeUserCandidates(f).map(u => u.id));
      if (new Set(ids).size !== ids.length || ids.some(id => !candidates.has(id))) throw new Error('「' + f.label + '」含无效或不可选人员');
    }
  }
  rec.custom = rec.custom || {};
  const keepByStage = ['design', 'production', 'install'].includes(scope) && !!stage;
  if (keepByStage) {
    rec.node_values = rec.node_values || {};
    rec.node_values[stage] = rec.node_values[stage] || {};
  }
  for (const f of nodeFieldDefs(scope, stage)) {
    if (f.readonly) continue;
    if (!(f.key in d)) continue;
    let v = d[f.key];
    if ((v === '' || v === undefined || v === null) && f.type !== 'checkbox') continue;
    if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'users') v = (Array.isArray(v) ? v : String(v).split(',')).map(x => String(x).trim()).filter(Boolean);
    else if (f.type === 'stars') v = Number(v) || 0;
    else if (f.type === 'number' || f.type === 'money') v = String(v).trim() === '' ? '' : (Number(v) || 0);
    else if (typeof v === 'string') v = v.trim();
    if (keepByStage && f.type === 'file' && v) {
      const previous = rec.node_values[stage][f.key] || fieldValueOf(rec, f);
      if (previous && previous !== v) {
        rec.file_history = rec.file_history || [];
        rec.file_history.push({ stage, field: f.label, file_id: previous, at: now() });
      }
    }
    if (f.col) rec[f.col] = v; else rec.custom[f.key] = v;
    if (keepByStage) rec.node_values[stage][f.key] = v;
    saved.push(f.key);
  }
  return saved;
}
/* 「生产是否异常」是全生产阶段唯一的报备字段：值为「是」时记录异常并追加历史，值为「否」时自动视为已解决 */
function syncProductionException(rec, d, by) {
  if (!('is_exception' in d)) return false;
  const yes = String(d.is_exception) === '是';
  const desc = String(d.exception_desc == null ? '' : d.exception_desc).trim();
  const changed = yes !== !!rec.is_exception;
  rec.is_exception = yes;
  if (yes) {
    rec.exception_date = rec.exception_date || today();
    rec.exception_resolve_date = '';
    if (desc) {
      rec.exception_logs = rec.exception_logs || [];
      const last = rec.exception_logs[rec.exception_logs.length - 1];
      if (!last || last.desc !== desc) rec.exception_logs.push({ at: now().slice(0, 16).replace('T', ' '), by: by || '生产部', desc });
    }
  } else {
    rec.exception_resolve_date = rec.exception_resolve_date || today();
  }
  return changed;
}
/* 与「生产是否异常」配套：同步项目级的异常状态 */
function syncProjectException(p, rec) {
  if (rec.is_exception) {
    const last = (rec.exception_logs || [])[rec.exception_logs.length - 1];
    p.exception_status = '生产异常';
    p.exception_desc = last ? last.desc : (p.exception_desc || '');
    if (p.project_status !== '已完成' && p.project_status !== '分批生产/出货中') p.project_status = '异常';
  } else if (p.exception_status === '生产异常') {
    p.exception_status = '无异常'; p.exception_desc = '';
    if (p.project_status === '异常') p.project_status = '生产中';
  }
}
const designOf = (pid) => db.design.find((t) => t.project_id === pid);
const prodOf = (pid) => db.production.find((t) => t.project_id === pid);
const installOf = (pid) => db.installations.find((t) => t.project_id === pid);
const userName = (id) => { const u = db.users.find((x) => x.id === id); return u ? u.name : ''; };

/* 默认生产负责人：优先 演示木工主管（流程文档指定的木工负责人），否则取第一个生产部人员 */
function defaultProdManager() {
  const qms = db.users.find((u) => u.active !== false && u.name === '演示木工主管');
  if (qms) return qms;
  const map = groupMap();
  return db.users.find((u) => u.active !== false && (u.roles || []).some((r) => ((map[r] || {}).caps || []).includes('prod'))) || null;
}
/* 成品/清仓的生产直接派给「油漆负责人」（油漆组在用的第一个人；没有就派给任一生产部人员） */
function paintingOwner() {
  const byGroup = db.users.find((u) => u.active !== false && (u.roles || []).includes('painting'));
  if (byGroup) return byGroup;
  const map = groupMap();
  return db.users.find((u) => u.active !== false && (u.roles || []).some((r) => ((map[r] || {}).caps || []).includes('prod')));
}
function createDesignTask(p, actorName) {
  const t = {
    id: uid('dt'), project_id: p.id, task_no: p.project_no + '-SJ', designer_id: '', sales_id: p.sales_id, splitter_id: '',
    status: designStagesFor(p.project_type)[0], customer_confirm_status: '', customer_confirm_result: '', initial_quotation: '', drawing_version: '',
    assign_date: '', intent_deposit_date: '', design_owner: '演示审批主管', measure_date: '', measure_person: '', draft_complete_date: '',
    remeasure_date: '', drawing_version_remeasure: '', final_drawing_date: '', splitter_start_date: '', splitter_complete_date: '',
    splitter_transfer_date: '', hardware_transfer_date: '', hardware_start_date: '', prod_drawing_receiver: '',
    draft_drawings: '', final_drawings: '', split_drawings: '', quotation: '', contract: '', hardware_list: '', customer_feedback: '', remark: '',
    skipped_stages: [], created_at: now(), updated_at: now(),
  };
  db.design.push(t);
  plog(p, actorName, '项目创建成功，自动生成设计任务 ' + t.task_no);
  return t;
}
function createProductionTask(p, actorName, opts) {
  const o = opts || {};
  /* 生产负责人：优先用「转接生产」节点选定的负责人；成品/清仓直接指派油漆负责人 */
  const byId = o.managerId ? db.users.find((u) => u.id === o.managerId) : null;
  const owner = byId || (SIMPLE_TYPES.includes(p.project_type) ? (paintingOwner() || null) : defaultProdManager());
  const managers = Array.isArray(o.managerIds) && o.managerIds.length ?
    Array.from(new Set(o.managerIds.filter(id => db.users.some(user => user.id === id && user.active !== false)))) :
    owner ? [owner.id] : [];
  const first = prodStagesFor(p.project_type)[0];
  const t = {
    id: uid('pt'), project_id: p.id, task_no: p.project_no + '-SC', production_manager_id: managers[0] || '', production_manager_ids: managers,
    material_manager_id: '', sales_id: p.sales_id,
    status: first, material_order_status: '', purchase_order_status: '', is_exception: false, exception_logs: [], exception_date: '', exception_resolve_date: '',
    material_order_date: '', wood_arrival_date: '', board_arrival_date: '', material_arrival_status: '', is_batch: '', batch_flow: false,
    cutting_start_date: '', cutting_complete_date: '', cutting_owner: '',
    woodwork_complete_date: '', woodwork_status: '', polishing_complete_date: '', painting_complete_date: '', purchase_order_date: '', purchase_arrival_date: '',
    assembly_complete_date: '', packaging_complete_date: '', fastest_ship_date: '', actual_ship_date: '', agreed_ship_date: '',
    ship_status: '', ship_remark: '', dispatch_install: '', material_list: '', shipping_doc: '', prod_drawing_origin: '', drawing_receive_date: '',
    remark: '', skipped_stages: [], created_at: now(), updated_at: now(),
  };
  db.production.push(t);
  plog(p, actorName, '生成生产任务 ' + t.task_no + (managers.length ? '，生产负责人：' + managers.map(userName).join('、') : ''));
  if (o.notify !== false) {
    notifyCap('prod', '【新生产任务】项目 ' + p.project_no + '（' + p.customer_name + '）已进入生产，请安排【' + first + '】', '#/project/' + p.id + '/production');
    for (const id of managers) notify(id, '【新生产任务】项目 ' + p.project_no + '（' + p.customer_name + '）已指派给你，请从【' + first + '】开始跟进', '#/project/' + p.id + '/production');
  }
  return t;
}
function createInstallTask(p, actorName) {
  const t = {
    id: uid('it'), project_id: p.id, task_no: p.project_no + '-AZ', manager_id: '', installer_name: '', sales_id: p.sales_id,
    status: INSTALL_STAGES[0], is_exception: false, exception_desc: '', exception_date: '', exception_resolve_date: '',
    install_address: p.address || '', dispatch_date: '', confirm_install_date: '', start_install_date: '', accept_date: '', accept_result: '', rectification_desc: '',
    customer_confirm_status: '', customer_rating: 0, actual_delivery_date: '', customer_confirm_file: '', feedback: '', exception_file: '', remark: '',
    skipped_stages: [], created_at: now(), updated_at: now(),
  };
  db.installations.push(t);
  plog(p, actorName, '项目需要安装且已实际发货，建立唯一安装档案 ' + t.task_no + '；齐货后才可派单');
  notifyCaps(['install', 'admin'], '【新安装任务】项目 ' + p.project_no + '（' + p.customer_name + '）已生成安装任务，请安排【安装确认】', '#/project/' + p.id + '/install');
  notify(p.sales_id, '【安装安排】项目 ' + p.project_no + ' 需要安装，安装任务 ' + t.task_no + ' 已创建', '#/project/' + p.id + '/install');
  return t;
}

/* ---------- 生产批次（分批生产 / 多批次出货） ---------- */
/* 主项目进入分批生产后固定创建第 1、2 生产批次；此后由木工负责人点「新增下一生产批次」递增 */
const BATCH_STEPS = ['开料/木工/打磨', '油漆/包装', '本批次出货申请', '本批次已出货'];
function batchList(pid) { return db.batches.filter((b) => b.project_id === pid); }
function nextBatchNo(pid) {
  const list = batchList(pid);
  return list.reduce((m, b) => Math.max(m, Number(b.batch_no) || 0), 0) + 1;
}
function createBatch(p, t, actorName) {
  const no = nextBatchNo(p.id);
  const b = {
    id: uid('b'), project_id: p.id, production_task_id: t.id, batch_no: no, batch_name: '第' + no + '生产批次',
    /* v2.1-B 批次有效性 + 本批生产内容 */
    valid: true, batch_content: '', void_reason: '', void_by: '', void_at: '',
    status: '生产中', step: BATCH_STEPS[0], progress: 0,
    material_arrival_date: '', cutting_complete_date: '', woodwork_complete_date: '', polishing_complete_date: '',
    painting_complete_date: '', packaging_complete_date: '', exception: '否', exception_desc: '',
    ship_no: 0, ship_content: '', agreed_ship_date: '', actual_ship_date: '', ship_status: '待出货', ship_remark: '', approval_id: '',
    remark: '', created_at: now(), updated_at: now(),
  };
  db.batches.push(b);
  plog(p, actorName || '系统', '创建生产批次：' + b.batch_name);
  return b;
}
/* 主项目汇总（v2.1-F）：只统计【有效】批次 —— 作废批次不参与任何进度与闭环判断
 * 展示口径：总有效生产批次数 / 生产完成批次数 / 已出货生产批次数 / 实际出货次数 / 生产进度 / 出货覆盖进度 / 项目风险状态 */
function batchSummary(p) {
  const all = batchList(p.id);
  const list = all.filter((b) => b.valid !== false);
  const total = list.length;
  const prodDone = list.filter((b) => b.status === '生产完成' || b.status === '已出货').length;
  const shipped = list.filter((b) => b.status === '已出货').length;
  const shipCount = db.approvals.filter((a) => a.project_id === p.id && a.status === '已完成').length;
  const openExc = list.some((b) => b.exception === '是') || !!(prodOf(p.id) && prodOf(p.id).is_exception);
  return {
    total, prodDone, shipped, ship_count: shipCount, void_count: all.length - list.length,
    open_exception: openExc,
    prod_progress: total ? Math.round((prodDone / total) * 100) : 0,
    ship_progress: total ? Math.round((shipped / total) * 100) : 0,
  };
}
/* 分批生产结束判定（v2.1-F）：所有有效批次生产完成 + 均被「已完成」出货记录覆盖 + 无未关闭异常 */
function batchFlowDone(p) {
  if (!prodOf(p.id)?.batches_finalized) return false;
  const list = batchList(p.id).filter((b) => b.valid !== false);
  if (!list.length) return false;
  if (list.some((b) => b.status !== '已出货')) return false;
  if (batchSummary(p).open_exception) return false;
  return true;
}

/* ---------- 出货审批单 ---------- */
/* batch_id 为空 = 单批次出货（生产任务本身）；否则为本生产批次的出货申请 */
function newApproval(p, t, batchId) {
  return {
    id: uid('ap'), project_id: p.id, production_task_id: t ? t.id : '', batch_id: batchId || '',
    status: '待发起', is_multi_batch: false,
    ship_doc: '', address_verified: false, phone_verified: false, name_verified: false, no_verified: false,
    finance_paid: '', ship_condition_ok: '', quotation: '', fastest_ship_date: '', agreed_ship_date: '', actual_ship_date: '',
    ship_status: '', ship_remark: '', dispatch_install: '', customer_confirm_status: '', reject_reason: '',
    feishu_instance_id: '', feishu_status: '', feishu_synced_at: '',
    steps: [{ name: '销售提交出货申请', at: now(), by: '系统', note: '生产完成，等待销售提交出货申请' }], created_at: now(),
  };
}
/* 按批次取审批单 */
function approvalOfBatch(batchId) { return db.approvals.find((a) => a.batch_id === batchId) || null; }

/* ---------- 设计阶段操作权限（spec.NODE_ACTORS 驱动） ---------- */
function designAllowed(u, p, stage) {
  if (isA(u)) return true;
  const assigned = designOf(p.id);
  if (['开始拆单', '转接生产', '五金单转交'].includes(stage) && assigned?.splitter_id) return hasCap(u, 'designer') && assigned.splitter_id === u.id;
  const base = (NODE_ACTORS.design || {})[stage] || [];
  if (base.includes('sales') && hasCap(u, 'sales') && p.sales_id === u.id) return true;
  if (base.includes('designer')) {
    const t = designOf(p.id);
    /* 成品/清仓只有 1 个设计节点，销售自己走完即可 */
    if (SIMPLE_TYPES.includes(p.project_type) && hasCap(u, 'sales') && p.sales_id === u.id) return true;
    if (!t || !t.designer_id) return hasCap(u, 'designer');   // 还没分配设计师前，设计部谁都能先接手
    if (t.designer_id === u.id) return true;
  }
  /* 外接单：生产部可代录设计节点，项目负责人（外接负责人）自己也能走完 */
  if (p.project_type === 'WJ' && (isProd(u) || p.sales_id === u.id)) return true;
  return false;
}
function designReminderInfo(user, project, task, stage) {
  if (!['DZ', 'BS'].includes(project.project_type)) return null;
  const info = { allowed: false, recipient_name: '', reason: '', retry_after_seconds: 0 };
  if (!isA(user) && !(hasCap(user, 'sales') && project.sales_id === user.id)) return info;
  if (isTerminated(project) || task.terminated) info.reason = '项目已终止';
  else if (task.paused_by) info.reason = '上游退回，设计任务暂停';
  else if (!designStagesFor(project.project_type).includes(stage)) info.reason = '此项目没有该节点';
  else if (!(NODE_ACTORS.design[stage] || []).includes('designer')) info.reason = '此节点由销售或系统办理';
  else if (task.status !== stage) info.reason = '只能催促当前待填写的节点';
  else {
    const id = ['开始拆单', '转接生产', '五金单转交'].includes(stage) && task.splitter_id ? task.splitter_id : task.designer_id;
    const recipient = db.users.find(u => u.id === id && u.active !== false && designAllowed(u, project, stage) && canSeeProject(u, project));
    if (!recipient) info.reason = '请先分配在用且有此节点权限的设计人员';
    else {
      info.allowed = true; info.recipient_id = recipient.id; info.recipient_name = recipient.name;
      const recent = db.notifications.slice().reverse().find(n => n.kind === 'design_reminder' && n.sender_id === user.id && n.task_id === task.id && n.stage === stage && n.user_id === id);
      if (recent) info.retry_after_seconds = Math.max(0, Math.ceil((Date.parse(recent.at) + 60000 - Date.now()) / 1000));
    }
  }
  return info;
}
/* 生产节点操作权限：统一按「生产部能力」判定，具体执行人由节点字段记录 */
function prodAllowed(u, p, stage) {
  if (isA(u)) return true;
  const task = prodOf(p.id);
  const node = stage || task?.status;
  const role = ['油漆喷刷', '组装打包'].includes(node) ? 'painting' : node === '外购入库' ? 'hardware' : ['出货申请', '准备出货'].includes(node) ? 'shipping' : 'woodwork';
  if (role === 'woodwork' && (u.roles || []).includes('external') &&
      ((p.project_type === 'WJ' && p.sales_id === u.id) ||
        [task?.production_manager_id, ...(task?.production_manager_ids || [])].includes(u.id))) return true;
  if (!(u.roles || []).includes(role)) return false;
  if (role === 'woodwork' && task?.production_manager_id) {
    return [task.production_manager_id, ...(task.production_manager_ids || [])].includes(u.id);
  }
  return isProd(u);
}
/* 安装节点操作权限（spec.NODE_ACTORS 驱动） */
function installAllowed(u, p, stage) {
  if (isA(u)) return true;
  const base = (NODE_ACTORS.install || {})[stage] || [];
  if (base.includes('sales') && hasCap(u, 'sales') && p.sales_id === u.id) return true;
  if (base.includes('install') && hasCap(u, 'install')) {
    const task = installOf(p.id);
    return !task?.manager_id || task.manager_id === u.id;
  }
  return false;
}
/* 生产/设计节点字段与必填，全部由 spec.js 的 NODE_FIELDS 提供（见 needNode / applyNodeFields） */

/* 跳过节点后的下一节点 */
function nextStage(stages, cur, skipped) {
  let idx = stages.indexOf(cur);
  let next = stages[idx + 1];
  while (next && (skipped || []).includes(next)) next = stages[stages.indexOf(next) + 1];
  return next;
}
function purchaseReady(task) {
  return ['不需要', '已入库'].includes(task.purchase_order_status) &&
    (!task.parallel_purchase || !!task.purchase_completed_at);
}
function finishPackaging(p, task) {
  if (!db.approvals.find(a => a.project_id === p.id && !['已完成', '已终止'].includes(a.status))) {
    db.approvals.push(newApproval(p, task, ''));
  }
  plog(p, '系统', '组装打包与外购已核对，进入【出货申请】，已通知销售');
  notify(p.sales_id, '【出货申请】项目 ' + p.project_no + '（' + p.customer_name + '）已完成生产与外购，请到【出货审批】提交申请', '#/project/' + p.id + '/ship');
}
function rollbackIssue(u, p, scope, record, target) {
  if (!record || record.terminated || isTerminated(p)) return '当前任务不能退回';
  if (!isA(u) && (record.paused_by || record.rollback_pending)) return '当前退回尚未处理完成，请先补正';
  if (p.project_status === '已完成' && !isA(u)) return '已完成项目需由管理员重开';
  if (scope === 'production' && record.batch_flow && !isA(u)) return '分批生产已启动，主任务需由管理员核对批次与出货记录';
  if (scope === 'production' && record.parallel_purchase && target === '外购入库') return '外购入库已独立并行，请在外购区修改';
  const stages = scope === 'design' ? designStagesFor(p.project_type) : scope === 'production' ? prodStagesFor(p.project_type) : INSTALL_STAGES;
  const from = stages.indexOf(record.status), to = stages.indexOf(target);
  if (to < 0 || from < 0 || to >= from || (record.skipped_stages || []).includes(target)) return '只能退回已走过且未跳过的节点';
  const allowed = stage => scope === 'design' ? designAllowed(u, p, stage) : scope === 'install' ? installAllowed(u, p, stage) : prodAllowed(u, p, stage);
  if (!allowed(target)) return '您没有目标节点的编辑权限';
  if (!isA(u)) {
    for (const stage of stages.slice(to + 1, from)) {
      if ((record.skipped_stages || []).includes(stage) || (flowOf(p.project_type).autoStages || []).includes(stage)) continue;
      if (scope === 'production' && record.parallel_purchase && stage === '外购入库') continue;
      if (!allowed(stage)) return '【' + stage + '】已由其他岗位完成，不能跨过该交接节点退回';
    }
  }
  return '';
}
function rollbackTargets(u, p, scope, record) {
  if (!record) return [];
  const stages = scope === 'design' ? designStagesFor(p.project_type) : scope === 'production' ? prodStagesFor(p.project_type) : INSTALL_STAGES;
  return stages.slice(0, stages.indexOf(record.status)).filter(stage => !rollbackIssue(u, p, scope, record, stage));
}
function markRollbackProgress(record, completed, stages, autoOrExternal = []) {
  const recover = record.rollback_recover_stage;
  if (!recover) { record.rollback_pending = false; return; }
  const recovered = completed === recover || stages.indexOf(record.status) > stages.indexOf(recover) ||
    (record.status === recover && autoOrExternal.includes(recover));
  if (recovered) { record.rollback_pending = false; delete record.rollback_recover_stage; }
}

/* ---------------- API 路由 ---------------- */
async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]
  if (pathname.startsWith('/api/auth/feishu/') || pathname.startsWith('/api/llm/')) return fail(res, 403, '当前为隔离试用版，不调用外部服务');

  /* --- 登录态查询：前端据此决定展示「飞书登录」还是「账号密码」 --- */
  if (pathname === '/api/auth/mode' && method === 'GET') {
    /* 回调地址要给出完整 URL 供管理员在飞书后台登记；
       优先用配置值，其次 YGX_BASE_URL，最后按本次请求的 Host 推导（便于本地调试） */
    let redirect = FEISHU.redirectUri();
    if (!/^https?:\/\//i.test(redirect)) {
      const proto = req.headers['x-forwarded-proto'] || (COOKIE_SECURE ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers.host || ('127.0.0.1:' + PORT);
      redirect = proto + '://' + host + '/api/auth/feishu/callback';
    }
    return ok(res, {
      mode: FEISHU.authMode(),                  // feishu | local
      feishu_ready: FEISHU.loginEnabled(),      // 是否已配好飞书凭据
      redirect_uri: redirect,                   // 供管理员在飞书后台登记时对照
    });
  }

  /* --- 飞书登录：发起授权（浏览器跳转） --- */
  if (pathname === '/api/auth/feishu/start' && method === 'GET') {
    if (!FEISHU.loginEnabled()) return fail(res, 400, '飞书登录尚未配置，请先在系统设置中填写应用凭据');
    /* state 用于防跨站请求伪造：写临时会话，回调时比对 */
    const state = uid('st');
    db.auth_states = db.auth_states || {};
    db.auth_states[state] = { at: now() };
    /* 清理 10 分钟前的过期 state */
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const k of Object.keys(db.auth_states)) if (new Date(db.auth_states[k].at).getTime() < cutoff) delete db.auth_states[k];
    saveDB();
    return send(res, 302, '', { Location: FEISHU.buildAuthUrl(state) });
  }

  /* --- 飞书登录：回调处理 --- */
  if (pathname === '/api/auth/feishu/callback' && method === 'GET') {
    const code = query.get('code') || '';
    const state = query.get('state') || '';
    db.auth_states = db.auth_states || {};
    if (!state || !db.auth_states[state]) return fail(res, 400, '授权状态已失效，请重新登录');
    delete db.auth_states[state]; saveDB();
    if (!code) return fail(res, 400, '未取得授权码，请重新登录');

    const ex = await FEISHU.exchangeCode(code);
    if (!ex.ok) return fail(res, 401, ex.err || '飞书身份验证失败');
    const m = FEISHU.matchUser(db.users, ex.user);
    if (!m.ok) return fail(res, 403, m.err || '未找到对应账号');
    if (m.user.active === false) return fail(res, 403, '该账号已停用，请联系管理员');

    const sid = uid('s');
    db.sessions[sid] = { userId: m.user.id, at: now(), via: 'feishu' };
    saveDB();
    /* 登录成功回首页：用 302 跳转而不是返回 JSON，因为是浏览器整页跳转场景 */
    return send(res, 302, '', {
      'Set-Cookie': 'sid=' + sid + COOKIE_ATTRS + '; Max-Age=' + 30 * 24 * 3600,
      Location: '/?login=ok',
    });
  }

  /* --- 本地账号密码登录（开发 / 离线演示模式） --- */
  if (pathname === '/api/login' && method === 'POST') {
    /* 正式模式下默认关闭本地密码登录，避免绕过飞书身份；可用 YGX_ALLOW_LOCAL_LOGIN=1 强制开启 */
    if (FEISHU.authMode() === 'feishu' && process.env.YGX_ALLOW_LOCAL_LOGIN !== '1') {
      return fail(res, 403, '本系统已启用飞书登录，请通过飞书登录');
    }
    const b = await readJSON(req);
    need(b, 'username', '账号'); need(b, 'password', '密码');
    const u = db.users.find((x) => x.username === b.username || x.name === b.username || (x.phone && x.phone === b.username));
    if (!u || u.pwd !== sha(b.password)) return fail(res, 401, '账号或密码错误');
    if (u.active === false) return fail(res, 403, '该账号已停用，请联系管理员');
    const sid = uid('s'); db.sessions[sid] = { userId: u.id, at: now(), via: 'local' }; saveDB();
    return send(res, 200, { ok: true, me: pubUser(u) }, { 'Set-Cookie': 'sid=' + sid + COOKIE_ATTRS + '; Max-Age=' + 30 * 24 * 3600 });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const sid = parseCookies(req).sid; if (sid) { delete db.sessions[sid]; saveDB(); }
    /* 退出时同时清除浏览器 Cookie */
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' + (COOKIE_SECURE ? '; Secure' : '') });
  }

  const me = currentUser(req);
  if (!me) return fail(res, 401, '请先登录');
  /* 「能不能管员工/改表单字段」是全流程多处要用到的判定，必须在所有路由之前定义好 */
  const canStaff = () => isA(me) || canAct(me, 'staff_manage');
  if (method === 'POST' && ['batches', 'production', 'install', 'design'].includes(seg[1]) && !['resume', 'rollback', 'correct'].includes(seg[3])) {
    const collection = seg[1] === 'batches' ? db.batches : seg[1] === 'install' ? db.installations : db[seg[1]];
    const record = collection.find(x => x.id === seg[2]);
    if (record?.paused_by) return fail(res, 409, '上游退回，任务暂停');
  }

  // All progression routes enforce the same optimistic concurrency and pause gate.
  const workflowCollections = { design: db.design, production: db.production, install: db.installations };
  if (method === 'POST' && workflowCollections[seg[1]] && ['save', 'rollback', 'resume', 'advance'].includes(seg[3])) {
    const scope = seg[1], action = seg[3];
    const t = workflowCollections[scope].find(x => x.id === seg[2]);
    if (!t) return fail(res, 404, '任务不存在');
    const p = db.projects.find(x => x.id === t.project_id);
    if (!p || !canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止');
    const allowed = stage => scope === 'design' ? designAllowed(me, p, stage) : scope === 'install' ? installAllowed(me, p, stage) : prodAllowed(me, p, stage);
    const b = await readJSON(req);
    req.workflowBody = b;
    req.workflowRecord = t;
    if (action !== 'rollback' && action !== 'resume' && !allowed(t.status)) return fail(res, 403, '没有该节点操作权限');
    if (action === 'resume') {
      if (!isA(me)) return fail(res, 403, '下游恢复需管理员核对确认');
      if (!t.paused_by) return fail(res, 400, '任务没有暂停');
      if (!String(b.reason || '').trim()) return fail(res, 400, '请填写重新确认依据');
      const upstream = Object.values(workflowCollections).flat().find(x => x.id === t.paused_by);
      if (upstream && upstream.rollback_pending) return fail(res, 409, '上游退回节点尚未重新完成');
      if (b.expected_updated_at !== t.updated_at) return fail(res, 409, '任务已变化，请刷新');
      delete t.paused_by;
      plog(p, me.name, '重新确认并恢复【' + t.status + '】：' + b.reason);
    } else {
      try { CONTROL.assertCurrent(t, b); } catch (e) { return fail(res, 409, e.message); }
      if (action === 'rollback') {
        if (t.rollback_pending && !isA(me)) return fail(res, 409, '当前退回尚未处理完成，请先补正');
        if (p.project_status === '已完成' && (!isA(me) || b.reopen !== true)) return fail(res, 409, '已完成项目需要管理员明确确认重开');
        if (!String(b.reason || '').trim()) return fail(res, 400, '请填写退回原因');
        const target = String(b.target || '');
        const issue = rollbackIssue(me, p, scope, t, target);
        if (issue) return fail(res, 403, issue);
        const from = t.status;
        t.node_history = t.node_history || [];
        t.node_history.push({ action: 'rollback', from, to: target, reason: b.reason, by: me.id, at: now(), snapshot: structuredClone({ ...t, node_history: undefined }) });
        const stages = scope === 'design' ? designStagesFor(p.project_type) : scope === 'production' ? prodStagesFor(p.project_type) : INSTALL_STAGES;
        const previousRecovery = t.rollback_recover_stage;
        t.status = target; t.rollback_pending = true;
        t.rollback_recover_stage = previousRecovery && stages.indexOf(previousRecovery) > stages.indexOf(from) ? previousRecovery : from;
        if (scope === 'production' && t.batch_flow) {
          t.batch_flow = false;
          if (p.project_status !== '已完成') p.project_status = '生产中';
        }
        if (p.project_status === '已完成') { p.reopened_at = now(); p.project_status = scope === 'design' ? '设计中' : scope === 'production' ? '生产中' : '安装中'; }
        const downstream = scope === 'design' ? [prodOf(p.id), ...batchList(p.id), installOf(p.id)] : scope === 'production' ? [...batchList(p.id), installOf(p.id)] : [];
        for (const dependent of downstream.filter(Boolean)) { dependent.paused_by = t.id; dependent.updated_at = now(); }
        if (scope !== 'install') for (const approval of db.approvals.filter(a => a.project_id === p.id && !['已完成', '已终止'].includes(a.status))) approval.paused_by = t.id;
        plog(p, me.name, '【' + from + '】退回【' + target + '】，下游暂停：' + b.reason);
      } else if (action === 'save') {
        try { if (b.data?.custom !== undefined) b.data.custom = normalizeNodeCustom(b.data, scope, t.status, t); }
        catch (e) { return fail(res, 400, e.message); }
        try { applyNodeFields(t, scope, t.status, b.data || {}); } catch(e) { return fail(res, 400, e.message); }
        mergeCustom(t, scope, b.data?.custom, t.status);
        plog(p, me.name, '保存【' + t.status + '】资料，未完成节点');
      } else {
        try { needCustom(b.data || {}, scope, t.status, t); } catch (e) { return fail(res, 400, e.message); }
        const error = CONTROL.completionError(scope, t.status, b.data || {});
        if (error) return fail(res, 400, error);
        if (scope === 'install' && ['安装派单', '正在安装', '验收确认', '客户确认'].includes(t.status) && !CONTROL.readyForInstallation(prodOf(p.id), batchList(p.id))) return fail(res, 409, '尚未齐货，需批次建齐且全部实际出货后才能派单或继续安装');
      }
    }
    if (action !== 'advance') {
      t.updated_at = now(); p.updated_at = now(); saveDB();
      return ok(res, { status: t.status });
    }
  }

  /* 外购入库自打磨起与油漆、组装并行，不改变主生产当前节点。 */
  if (method === 'POST' && seg[1] === 'production' && seg[3] === 'purchase-correct') {
    const t = db.production.find(x => x.id === seg[2]);
    if (!t) return fail(res, 404, '生产任务不存在');
    const p = db.projects.find(x => x.id === t.project_id);
    if (!p || !isA(me) || !canSeeProject(me, p)) return fail(res, 403, '仅管理员可补正外购资料');
    if (isTerminated(p) || t.paused_by || t.batch_flow || !['DZ', 'WJ'].includes(p.project_type)) return fail(res, 409, '当前生产任务不能补正外购');
    const stages = prodStagesFor(p.project_type);
    if (stages.indexOf(t.status) < stages.indexOf('原件打磨')) return fail(res, 409, '尚未进入外购入库阶段');
    const b = await readJSON(req);
    try { CONTROL.assertCurrent(t, b); } catch (e) { return fail(res, 409, e.message); }
    const reason = String(b.reason || '').trim();
    if (reason.length < 2) return fail(res, 400, '请填写至少 2 个字的补正原因');
    const data = b.data || {};
    if (t.purchase_completed_at && !['不需要', '已入库'].includes(data.purchase_order_status)) return fail(res, 409, '外购已完成，补正后仍须保持完成状态');
    try {
      needNode('production', '外购入库', data, t);
      const issue = CONTROL.completionError('production', '外购入库', data);
      if (issue) return fail(res, 400, issue);
    } catch (e) { return fail(res, 400, e.message); }
    const fields = nodeFieldDefs('production', '外购入库');
    const before = Object.fromEntries(fields.map(f => [f.key, fieldValueOf(t, f)]));
    const planned = fields.some(f => data[f.key] !== undefined && data[f.key] !== '' &&
      String(data[f.key]).trim() !== String(before[f.key] ?? '')) ||
      (data.purchase_order_status === '不需要' && !!t.purchase_arrival_date);
    if (!planned) return fail(res, 400, '资料没有变化，无需补正');
    try { applyNodeFields(t, 'production', '外购入库', data); }
    catch (e) { return fail(res, 400, e.message); }
    if (t.purchase_order_status === '不需要') {
      t.purchase_arrival_date = '';
      if (t.node_values?.['外购入库']) t.node_values['外购入库'].purchase_arrival_date = '';
    }
    const changes = fields.filter(f => String(before[f.key] ?? '') !== String(fieldValueOf(t, f) ?? ''))
      .map(f => ({ field: f.label, old: before[f.key] ?? '', value: fieldValueOf(t, f) ?? '' }));
    t.purchase_corrections = t.purchase_corrections || [];
    t.purchase_corrections.push({ reason, by: me.id, at: now(), changes });
    t.updated_at = now(); p.updated_at = now();
    plog(p, me.name, '外购入库资料补正：' + reason + '（' + changes.length + ' 项，原审批与出货事实保留）');
    saveDB(); return ok(res, { status: t.status, changed: changes.length });
  }

  if (method === 'POST' && seg[1] === 'production' && seg[3] === 'purchase') {
    const t = db.production.find(x => x.id === seg[2]);
    if (!t) return fail(res, 404, '生产任务不存在');
    const p = db.projects.find(x => x.id === t.project_id);
    if (!p || !canSeeProject(me, p) || !prodAllowed(me, p, '外购入库')) return fail(res, 403, '仅五金采购可填写外购入库');
    if (isTerminated(p) || t.paused_by || t.batch_flow) return fail(res, 409, '当前生产任务不能修改外购');
    if (!['DZ', 'WJ'].includes(p.project_type)) return fail(res, 400, '该项目类型不走外购入库');
    if (db.approvals.some(a => a.project_id === p.id && !['待发起', '已驳回', '已终止'].includes(a.status))) return fail(res, 409, '出货审批已进入处理，外购变更需先处理审批');
    const stages = prodStagesFor(p.project_type);
    if (stages.indexOf(t.status) < stages.indexOf('原件打磨')) return fail(res, 409, '尚未进入打磨阶段');
    const b = await readJSON(req);
    try { CONTROL.assertCurrent(t, b); } catch (e) { return fail(res, 409, e.message); }
    if (!['save', 'complete'].includes(b.action)) return fail(res, 400, '操作类型无效');
    try { if (b.data?.custom !== undefined) b.data.custom = CUSTOM_FIELDS.normalize(b.data.custom, defsFor('production', '外购入库'), db.users, t.custom); }
    catch (e) { return fail(res, 400, e.message); }
    if (t.purchase_completed_at && b.action === 'complete') return fail(res, 409, '外购入库已完成，请勿重复提交');
    if (t.purchase_completed_at && b.action === 'save' && !['不需要', '已入库'].includes(b.data?.purchase_order_status)) return fail(res, 409, '外购已完成；若需重新下单，请先由管理员核对出货状态');
    if (b.action === 'complete') {
      try { needNode('production', '外购入库', b.data || {}, t); needCustom(b.data || {}, 'production', '外购入库', t); } catch (e) { return fail(res, 400, e.message); }
      const issue = CONTROL.completionError('production', '外购入库', b.data || {});
      if (issue) return fail(res, 400, issue);
    }
    try { applyNodeFields(t, 'production', '外购入库', b.data || {}); }
    catch (e) { return fail(res, 400, e.message); }
    mergeCustom(t, 'production', b.data?.custom, '外购入库');
    t.parallel_purchase = true;
    if (t.purchase_order_status === '不需要') {
      t.purchase_arrival_date = '';
      if (t.node_values?.['外购入库']) t.node_values['外购入库'].purchase_arrival_date = '';
    }
    if (b.action === 'complete') {
      t.purchase_completed_at = now();
      plog(p, me.name, '外购入库独立完成：' + t.purchase_order_status);
      if (t.status === '外购入库') t.status = '组装打包';
      else if (t.status === '组装打包' && t.packaging_done_at) {
        t.status = '出货申请'; finishPackaging(p, t);
        markRollbackProgress(t, '组装打包', stages, ['出货申请']);
      }
    } else plog(p, me.name, '外购入库资料已保存，未完成');
    t.updated_at = now(); p.updated_at = now(); saveDB();
    return ok(res, { status: t.status, purchase_completed: purchaseReady(t) });
  }

  if (method === 'POST' && seg[1] === 'projects' && seg[3] === 'resume-downstream') {
    const p = db.projects.find(x => x.id === seg[2]);
    if (!p || !isA(me)) return fail(res, 403, '需管理员核对恢复');
    if (isTerminated(p)) return fail(res, 400, '项目已终止');
    const b = await readJSON(req);
    if (!String(b.reason || '').trim()) return fail(res, 400, '请填写核对依据');
    const records = [...db.design, ...db.production, ...db.installations, ...db.batches];
    const paused = records.filter(x => x.project_id === p.id && x.paused_by);
    const approvals = db.approvals.filter(x => x.project_id === p.id && x.paused_by);
    if ([...paused, ...approvals].some(x => records.find(r => r.id === x.paused_by)?.rollback_pending)) return fail(res, 409, '上游退回节点尚未重新完成');
    for (const rec of paused) { delete rec.paused_by; rec.updated_at = now(); }
    for (const a of approvals) {
      delete a.paused_by;
      a.steps.push({ name: '上游变更重新确认', by: me.name, at: now(), note: '原审批保留历史，需重新发起：' + b.reason });
      a.previous_instances = [...(a.previous_instances || []), a.feishu_instance_id].filter(Boolean);
      a.feishu_instance_id = ''; a.status = '待发起';
    }
    plog(p, me.name, '核对后恢复下游；未完成审批重新发起：' + b.reason); saveDB(); return ok(res);
  }

  if (method === 'POST' && seg[1] === 'production' && seg[3] === 'finalize-batches') {
    const t = db.production.find(x => x.id === seg[2]);
    const p = t && db.projects.find(x => x.id === t.project_id);
    if (!p || !canSeeProject(me, p) || !prodAllowed(me, p)) return fail(res, 403, '无权确认批次');
    if (isTerminated(p) || t.paused_by || t.rollback_pending || !t.batch_flow) return fail(res, 409, '当前不能确认批次建齐');
    if (!batchList(p.id).some(b => b.valid !== false)) return fail(res, 400, '至少需要一个有效批次');
    t.batches_finalized = true; t.updated_at = now();
    plog(p, me.name, '确认本项目生产批次已建齐'); saveDB(); return ok(res);
  }

  /* --- 个人 --- */
  if (pathname === '/api/me/password' && method === 'POST') {
    const b = await readJSON(req);
    if (me.pwd !== sha(b.old)) return fail(res, 400, '原密码错误');
    if (!b.newP || String(b.newP).length < 6) return fail(res, 400, '新密码至少 6 位');
    me.pwd = sha(b.newP); saveDB(); return ok(res);
  }

  /* --- 全量数据（按权限过滤） --- */
  if (pathname === '/api/bootstrap' && method === 'GET') {
    const ids = visibleProjectIds(me);
    const vis = (pid) => ids === null || ids.has(pid);
    const data = {
      me: pubUser(me), users: db.users.map(pubUser), consts: CONSTS,
      /* 自定义字段定义（前端表单与字段设置页共用） */
      field_defs: db.field_defs || [],
      /* 敏感配置只对管理层返回 */
      config: isA(me) ? db.config : { approval_code: db.config.approval_code || '' },
      /* 让所有人都知道大模型有没有开（不含任何密钥） */
      llmEnabled: !!(db.config && db.config.llm_enabled),
      meta: {
        /* 权限组（部门）：带成员数，前端权限组管理页直接用 */
        groups: db.groups.map((g) => Object.assign({}, g, {
          members: db.users.filter((u) => (u.roles || []).includes(g.key)).length,
        })),
        /* 兼容旧前端：key → 组定义 的映射 */
        roles: (function () { const m = {}; for (const g of db.groups) m[g.key] = { name: g.name, desc: g.desc, pages: g.pages, scope: g.scope, actions: g.actions }; return m; })(),
        caps: CAP_DEFS,
        pages: PAGE_DEFS, scopes: SCOPE_DEFS, actions: ACTION_DEFS,
      },
      projects: db.projects.filter((p) => vis(p.id)),
      design: db.design.filter((t) => vis(t.project_id)).map(t => redactDesignQuotation(t, me, db.projects.find(p => p.id === t.project_id))),
      production: db.production.filter((t) => vis(t.project_id)),
      installations: db.installations.filter((t) => vis(t.project_id)),
      aftersales: db.aftersales.filter((t) => vis(t.project_id)),
      approvals: db.approvals.filter((a) => vis(a.project_id)),
      logs: db.logs.filter((l) => vis(l.project_id)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 800),
      notifications: db.notifications.filter((n) => n.user_id === me.id).slice(-80).reverse(),
      stats: computeStats(me),
    };
    return ok(res, data);
  }
  if (pathname === '/api/notifications/read' && method === 'POST') {
    for (const n of db.notifications) if (n.user_id === me.id) n.read = true;
    saveDB(); return ok(res);
  }
  if (pathname === '/api/notifications' && method === 'GET') {
    return ok(res, { notifications: db.notifications.filter(n => n.user_id === me.id).slice(-80).reverse() });
  }
  if (seg[1] === 'design' && seg[3] === 'remind' && method === 'POST') {
    const task = db.design.find(t => t.id === seg[2]);
    const project = task && db.projects.find(p => p.id === task.project_id);
    if (!project || !canSeeProject(me, project)) return fail(res, 404, '项目不存在或无权查看');
    const body = await readJSON(req);
    const info = designReminderInfo(me, project, task, body.stage);
    if (!info || (!isA(me) && !(hasCap(me, 'sales') && project.sales_id === me.id))) return fail(res, 403, '仅定制、板式项目的负责销售或管理员可催促设计人员');
    if (!info.allowed) return fail(res, 409, info.reason);
    try { CONTROL.assertCurrent(task, body); } catch (error) { return fail(res, 409, error.message); }
    if (typeof body.request_id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.request_id)) return fail(res, 400, '催促请求编号无效');
    const duplicate = db.notifications.find(n => n.kind === 'design_reminder' && n.sender_id === me.id && n.request_id === body.request_id);
    if (duplicate && (duplicate.task_id !== task.id || duplicate.stage !== body.stage || duplicate.user_id !== info.recipient_id)) return fail(res, 409, '催促请求已用于其他节点');
    const recent = info.retry_after_seconds ? db.notifications.slice().reverse().find(n => n.kind === 'design_reminder' && n.sender_id === me.id && n.task_id === task.id && n.stage === body.stage && n.user_id === info.recipient_id) : null;
    if (duplicate || recent) return ok(res, { recipient_name: info.recipient_name, duplicate: true, retry_after_seconds: info.retry_after_seconds, feishu_status: (duplicate || recent).feishu_status });
    const text = '【设计催促】' + me.name + ' 请' + info.recipient_name + '尽快填写【' + body.stage + '】。项目编号：' + project.project_no + '；详细地址：' + (project.address || '未填写');
    const notification = { id: uid('n'), kind: 'design_reminder', user_id: info.recipient_id, sender_id: me.id, project_id: project.id, task_id: task.id, stage: body.stage, request_id: body.request_id, text, at: now(), read: false, link: '#/project/' + project.id + '/todo/design/' + task.id };
    const adapter = FEISHU.notifyDesignReminder({ notification, project, sender: me, recipient: db.users.find(u => u.id === info.recipient_id) });
    notification.feishu_status = adapter.status;
    db.notifications.push(notification);
    plog(project, me.name, '催促' + info.recipient_name + '填写【' + body.stage + '】；系统通知已发送');
    saveDB();
    return ok(res, { recipient_name: info.recipient_name, retry_after_seconds: 60, feishu_status: adapter.status });
  }

  /* --- 项目详情 --- */
  if (seg[1] === 'projects' && seg[2] && method === 'GET' && !seg[3]) {
    const p = db.projects.find((x) => x.id === seg[2]);
    if (!p || !canSeeProject(me, p)) return fail(res, 404, '项目不存在或无权查看');
    return ok(res, {
      project: p,
      design: redactDesignQuotation(designOf(p.id) || null, me, p), production: prodOf(p.id) || null,
      batches: db.batches.filter((b) => b.project_id === p.id),
      approvals: db.approvals.filter((a) => a.project_id === p.id),
      approval: db.approvals.filter((a) => a.project_id === p.id).sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''))[0] || null,
      install: installOf(p.id) || null,
      rollback_targets: {
        design: rollbackTargets(me, p, 'design', designOf(p.id)),
        production: rollbackTargets(me, p, 'production', prodOf(p.id)),
        install: rollbackTargets(me, p, 'install', installOf(p.id)),
      },
      can_view_final_quotation: canSeeFinalQuotation(me, p),
      design_reminders: designOf(p.id) && ['DZ', 'BS'].includes(p.project_type) && (isA(me) || (hasCap(me, 'sales') && p.sales_id === me.id))
        ? Object.fromEntries(designStagesFor(p.project_type).map(stage => [stage, designReminderInfo(me, p, designOf(p.id), stage)])) : null,
      aftersales: db.aftersales.filter((a) => a.project_id === p.id),
      logs: db.logs.filter((l) => l.project_id === p.id).sort((a, b) => b.at.localeCompare(a.at)),
    });
  }

  /* --- 新建项目（销售 / 外接负责人 / 管理层） --- */
  /* 字段口径严格按流程图：必填 项目类型/客户姓名/联系电话/楼盘地址/来源渠道；选填 是否样板间/备注 */
  if (pathname === '/api/projects' && method === 'POST') {
    if (!isA(me) && !hasCap(me, 'sales') && !canAct(me, 'new_external')) return fail(res, 403, '只有销售、外接负责人和管理层可以新建项目');
    const b = await readJSON(req);
    try { needNode('project', '', b, null); needCustom(b, 'project', '', null); } catch (e) { return fail(res, 400, e.message); }
    const type = PROJECT_TYPES[b.project_type] ? b.project_type : 'CP';
    /* 外接项目只能由外接负责人（或管理层）创建 */
    if (type === 'WJ' && !isA(me) && !canAct(me, 'new_external')) return fail(res, 403, '外接项目只能由外接负责人创建');
    const flow = flowOf(type);
    const p = {
      id: uid('p'), project_no: nextNo(type), project_type: type, customer_name: b.customer_name, customer_phone: b.customer_phone,
      address: b.address, customer_type: String(b.customer_type).trim(), source_channel: b.source_channel,
      sales_id: (canAct(me, 'new_external') && !hasCap(me, 'sales')) || (isA(me) && b.sales_id) ? (b.sales_id || me.id) : me.id,
      designer_id: '', production_manager_id: '', installer_id: '', after_sales_id: '',
      contract_amount: 0, deal_date: today(), expected_delivery_date: '', actual_delivery_date: '',
      project_status: '设计中', exception_status: '无异常', exception_desc: '', is_showroom: !!b.is_showroom, remark: b.remark || '',
      /* 只有「定制」会走安装；其余类型一律免安装 */
      skip_install: type !== 'DZ',
      /* v2.1-C 项目级安装意向：分批项目只记意向，全部有效批次完成后才创建唯一主安装任务 */
      need_install: null,
      created_at: now(), updated_at: now(),
    };
    applyNodeFields(p, 'project', '', b);
    mergeCustom(p, 'project', b.custom);
    db.projects.push(p);
    createDesignTask(p, me.name);
    /* 成品/清仓：新建即自动生成生产任务并指派油漆负责人（不走「转接生产」，也不建安装任务） */
    if (flow.autoProd) {
      createProductionTask(p, me.name);
      p.project_status = '生产中';
      plog(p, me.name, flow.name + '项目：自动创建生产任务并进入生产（设计仅「客户最终确认」1 个节点）');
    }
    if (p.sales_id !== me.id) notify(p.sales_id, '【新项目】管理层为你分配了项目 ' + p.project_no + '（' + p.customer_name + '）', '#/project/' + p.id);
    saveDB(); return ok(res, { id: p.id, project_no: p.project_no });
  }

  /* --- 上传附件 --- */
  if (pathname === '/api/upload' && method === 'POST') {
    const buf = await readBody(req, 60 * 1024 * 1024);
    if (!buf.length) return fail(res, 400, '文件为空');
    const rawName = query.get('name') || 'file';
    const safe = String(rawName).replace(/[\\/:*?"<>|]/g, '_').slice(-80);
    const ext = (path.extname(safe) || '').toLowerCase();
    const id = uid('f');
    fs.writeFileSync(path.join(UPLOAD_DIR, id + ext), buf);
    db.files[id] = { name: safe, mime: req.headers['content-type'] || 'application/octet-stream', size: buf.length, by: me.id, at: now(), ext };
    saveDB(); return ok(res, { id, name: safe, size: buf.length });
  }
  if (seg[1] === 'files' && seg[2] && method === 'GET') {
    const f = db.files[seg[2]]; if (!f) return fail(res, 404, '文件不存在');
    if (!canReadFile(me, seg[2], f)) return fail(res, 403, '无权查看该附件');
    const fp = path.join(UPLOAD_DIR, seg[2] + f.ext);
    if (!fs.existsSync(fp)) return fail(res, 404, '文件已丢失');
    res.writeHead(200, { 'Content-Type': f.mime, 'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(f.name) });
    return res.end(fs.readFileSync(fp));
  }

  /* --- 设计任务推进（节点字段与必填由 spec.js 驱动） --- */
  if (seg[1] === 'design' && seg[3] === 'advance' && method === 'POST') {
    const t = db.design.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '设计任务不存在');
    const p = db.projects.find((x) => x.id === t.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!designAllowed(me, p, t.status)) return fail(res, 403, '当前节点【' + t.status + '】您没有操作权限');
    const b = await readJSON(req); const d = b.data || {};
    const stage = t.status;
    const flow = flowOf(p.project_type);
    const dstages = designStagesFor(p.project_type);
    try { needNode('design', stage, d, t); } catch (e) { return fail(res, 400, e.message); }
    const saved = applyNodeFields(t, 'design', stage, d);
    mergeCustom(t, 'design', d.custom);
    /* 生产负责人可多选：记录第一责任人，供生产任务与统计使用 */
    if (stage === '转接生产') {
      const raw = d.production_manager_ids;
      const ids = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) { t.production_manager_ids = ids; t.production_manager_id = ids[0]; }
      else if (t.production_manager_id) { t.production_manager_ids = [t.production_manager_id]; }
    }

    /* ---- 节点副作用 ---- */
    if (stage === '设计师分配') {
      p.designer_id = t.designer_id;
      notify(t.designer_id, '【量尺提醒】新设计任务：项目 ' + p.project_no + '（' + p.customer_name + '），请尽快安排上门量尺', '#/project/' + p.id + '/design');
      plog(p, me.name, '分配设计师：' + (userName(t.designer_id) || t.designer_id));
    } else if (stage === '初稿图纸制作') {
      notify(p.sales_id, '【初稿确认】项目 ' + p.project_no + ' 初稿图纸已完成，请与客户确认', '#/project/' + p.id + '/design');
      plog(p, me.name, '初稿图纸已上传（' + (t.drawing_version || '—') + '）');
    } else if (stage === '客户最终确认') {
      p.contract_amount = Number(t.contract_amount) || p.contract_amount || 0;
      p.expected_delivery_date = t.expected_delivery_date || p.expected_delivery_date;
      if (!t.final_drawings && t.draft_drawings) t.final_drawings = t.draft_drawings;
      plog(p, me.name, '客户最终确认，合同金额 ¥' + Number(p.contract_amount || 0).toLocaleString() + '，预计交付 ' + (p.expected_delivery_date || '—'));
    } else if (stage === '开始拆单') {
      t.splitter_id = t.splitter_id || me.id;
      plog(p, me.name, '开始拆单');
    } else {
      plog(p, me.name, '设计节点【' + stage + '】完成' + (saved.length ? '（' + saved.length + ' 项字段）' : ''));
    }

    /* ---- 条件退回：客户确认状态 = 修改图纸 → 自动退回上一节点 ----
       只看本次提交的值，且只在「客户确认」类节点生效（避免退回后再次误触发） */
    const isConfirmNode = stage === '初稿客户确认' || stage === '客户最终确认';
    if (isConfirmNode && String(d.customer_confirm_status) === '修改图纸') {
      const prev = dstages[dstages.indexOf(stage) - 1] || dstages[0];
      t.status = prev; t.customer_confirm_status = ''; t.updated_at = now(); p.updated_at = now();
      t.rollback_pending = true; t.rollback_recover_stage = stage;
      for (const dependent of [prodOf(p.id), ...batchList(p.id), installOf(p.id)].filter(Boolean)) { dependent.paused_by = t.id; dependent.updated_at = now(); }
      for (const approval of db.approvals.filter(a => a.project_id === p.id && !['已完成', '已终止'].includes(a.status))) approval.paused_by = t.id;
      plog(p, me.name, '客户要求【修改图纸】，自动退回上一节点【' + prev + '】');
      if (t.designer_id) notify(t.designer_id, '【修改图纸】项目 ' + p.project_no + ' 客户要求修改图纸，请回到【' + prev + '】处理', '#/project/' + p.id + '/design');
      saveDB(); return ok(res, { status: t.status, returned: true, prev });
    }

    /* ---- 转接生产：生成生产任务 ---- */
    if (stage === '转接生产') {
      const exist = prodOf(p.id);
      if (!exist) createProductionTask(p, me.name, { managerId: t.production_manager_id, managerIds: t.production_manager_ids });
      else if (t.production_manager_id) { exist.production_manager_id = t.production_manager_id; exist.production_manager_ids = t.production_manager_ids || []; }
      p.project_manager_id = t.production_manager_id;
      p.project_status = '生产中';
      plog(p, me.name, '已转接生产，项目转「生产中」，生产负责人：' + ((t.production_manager_ids || []).map(userName).filter(Boolean).join('、') || userName(t.production_manager_id) || '—'));
    }

    /* ---- 推进到下一节点：自动节点（如「设计完成」、外接的「转接生产」）由系统连续完成 ---- */
    let next = nextStage(dstages, stage, t.skipped_stages || []);
    const auto = flow.autoStages || [];
    let guard = 0;
    while (next && auto.includes(next) && guard++ < 6) {
      const cur = next;
      if (cur === '转接生产') {
        if (!prodOf(p.id)) createProductionTask(p, '系统');
        if (p.contract_amount === undefined || p.contract_amount === 0) p.contract_amount = Number((designOf(p.id) || {}).contract_amount) || 0;
        p.project_status = '生产中';
        plog(p, '系统', '【' + p.project_type + '】项目：系统自动转接生产，已生成生产任务');
      }
      if (cur === '设计完成') {
        t.final_drawing_date = t.final_drawing_date || today();
        plog(p, '系统', '设计阶段全部节点完成 ✓');
      }
      next = nextStage(dstages, cur, t.skipped_stages || []);
    }
    t.status = next || '设计完成';
    markRollbackProgress(t, stage, dstages, flow.autoStages || []);
    t.updated_at = now(); p.updated_at = now();
    if (t.status === '设计完成' && p.project_status === '设计中') p.project_status = prodOf(p.id) ? '生产中' : '设计中';
    saveDB(); return ok(res, { status: t.status });
  }

  /* --- 生产任务推进（节点字段与必填由 spec.js 驱动） --- */
  if (seg[1] === 'production' && seg[3] === 'advance' && method === 'POST') {
    const t = db.production.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '生产任务不存在');
    const p = db.projects.find((x) => x.id === t.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!prodAllowed(me, p)) return fail(res, 403, '只有生产部和管理层可以操作生产节点');
    const stage = t.status;
    if (['出货申请', '准备出货', '已终止'].includes(stage)) return fail(res, 400, '当前节点由出货审批流程驱动，请到【出货审批】模块操作');
    if (t.batch_flow) return fail(res, 400, '项目已进入【分批生产 / 出货中】，请在【生产批次】里逐批推进');
    if (stage === '材料到场' && batchList(p.id).length && String((req.workflowBody?.data || {}).is_batch) !== '是') return fail(res, 409, '已有生产批次，补正后仍须选择分批制作，原批次与出货记录会保留');
    if (stage === '组装打包' && t.packaging_done_at) return fail(res, 409, '组装打包已完成，等待外购入库完成');
    const b = await readJSON(req); const d = b.data || {};
    try { needNode('production', stage, d, t); } catch (e) { return fail(res, 400, e.message); }
    const saved = applyNodeFields(t, 'production', stage, d);
    mergeCustom(t, 'production', d.custom);
    const excChanged = syncProductionException(t, d, me.name);
    syncProjectException(p, t);
    const flow = flowOf(p.project_type);
    if (stage === '下单备料') {
      t.production_manager_id = t.production_manager_id || me.id;
      p.production_manager_id = p.production_manager_id || me.id;
      const dt = designOf(p.id);
      if (dt) {
        if (!t.prod_drawing_origin && dt.final_drawings) t.prod_drawing_origin = dt.final_drawings;
        if (!t.custom.design_feedback) t.custom.design_feedback = [dt.customer_feedback, dt.remark].filter(Boolean).join('；');
      }
      plog(p, me.name, '生产节点【下单备料】完成');
    } else {
      plog(p, me.name, '生产节点【' + stage + '】完成' + (saved.length ? '（' + saved.length + ' 项字段）' : '') + (excChanged && t.is_exception ? ' · 已报备异常' : ''));
    }
    /* ---- 通知联动 ---- */
    if (stage === '木工制作') {
      notifyByName('演示采购负责人', '【外购下单】项目 ' + p.project_no + ' 木工制作已完成，请安排五金外购', '#/project/' + p.id + '/production');
      notifyByName('演示发货负责人', '【物料准备】项目 ' + p.project_no + ' 木工制作已完成，请准备玻璃等其他物料', '#/project/' + p.id + '/production');
    }
    if (stage === '油漆喷刷') {
      notifyByName('演示采购负责人', '【外购入库】项目 ' + p.project_no + ' 油漆喷刷已完成，请填写【外购入库】节点', '#/project/' + p.id + '/production');
    }

    /* ---- 材料到场：是否分批次制作 = 是 → 转入分批生产 / 出货中 ---- */
    if (stage === '材料到场' && String(t.is_batch) === '是') {
      t.batch_flow = true;
      p.project_status = '分批生产/出货中';
      if (!batchList(p.id).length) { createBatch(p, t, '系统'); createBatch(p, t, '系统'); }
      plog(p, '系统', '材料到场：选择分批次制作，项目转入【分批生产 / 出货中】，系统已固定创建第1、第2生产批次');
      notifyCap('prod', '【分批生产】项目 ' + p.project_no + '（' + p.customer_name + '）已进入【分批生产 / 出货中】，请到【生产批次】逐批推进', '#/project/' + p.id + '/production');
      notifyCap('admin', '【分批生产】项目 ' + p.project_no + '（' + p.customer_name + '）转入分批生产 / 出货中', '#/project/' + p.id + '/production');
      markRollbackProgress(t, stage, prodStagesFor(p.project_type));
      saveDB(); return ok(res, { status: t.status, batch: true });
    }

    /* ---- 板式：木工制作完成自动跳过 原件打磨 / 油漆喷刷 ---- */
    if (flow.prodSkip && flow.prodSkip[stage]) {
      t.skipped_stages = Array.from(new Set((t.skipped_stages || []).concat(flow.prodSkip[stage])));
      plog(p, '系统', '板式项目：自动跳过【' + flow.prodSkip[stage].join('】【') + '】');
    }

    if (stage === '组装打包' && ['DZ', 'WJ'].includes(p.project_type) && !purchaseReady(t)) {
      t.packaging_done_at = now(); t.parallel_purchase = true;
      t.updated_at = now(); p.updated_at = now();
      plog(p, me.name, '组装打包完成，等待并行的外购入库完成后发起出货申请');
      saveDB(); return ok(res, { status: t.status, waiting_purchase: true });
    }
    let next = nextStage(prodStagesFor(p.project_type), stage, t.skipped_stages || []);
    if (stage === '油漆喷刷' && ['DZ', 'WJ'].includes(p.project_type)) {
      t.parallel_purchase = true;
      next = '组装打包';
    }
    if (next === '已终止') next = null;
    t.status = next || t.status; t.updated_at = now(); p.updated_at = now();
    markRollbackProgress(t, stage, prodStagesFor(p.project_type), ['出货申请', '准备出货']);

    /* ---- 组装打包完成 → 生成出货审批单，通知销售去发起 ---- */
    if (t.status === '出货申请') finishPackaging(p, t);
    saveDB(); return ok(res, { status: t.status });
  }

  /* --- 生产异常（只允许追加，不能覆盖） --- */
  if (seg[1] === 'production' && seg[3] === 'exception' && method === 'POST') {
    const t = db.production.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '生产任务不存在');
    const p = db.projects.find((x) => x.id === t.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!prodAllowed(me, p)) return fail(res, 403, '没有当前生产节点的异常处理权限');
    const b = await readJSON(req);
    if (b.resolve) {
      t.is_exception = false; t.exception_resolve_date = today();
      plog(p, me.name, '生产异常已解决');
      if (p.exception_status === '生产异常') { p.exception_status = '无异常'; p.exception_desc = ''; if (p.project_status === '异常') p.project_status = '生产中'; }
    } else {
      need(b, 'desc', '异常说明');
      if (!t.is_exception) { t.is_exception = true; t.exception_date = today(); }
      t.exception_logs.push({ at: now().slice(0, 16).replace('T', ' '), by: me.name, desc: b.desc });
      p.exception_status = '生产异常'; p.exception_desc = b.desc;
      if (p.project_status !== '已完成') p.project_status = '异常';
      plog(p, me.name, '生产异常报备：' + b.desc);
      notifyCap('admin', '【异常提醒】项目 ' + p.project_no + '（' + p.customer_name + '）生产异常：' + b.desc, '#/project/' + p.id + '/production');
      notify(p.sales_id, '【异常提醒】您的项目 ' + p.project_no + ' 生产异常：' + b.desc, '#/project/' + p.id + '/production');
    }
    saveDB(); return ok(res);
  }

  /* --- 生产批次：木工负责人点「新增下一生产批次」，系统自动按现有最大批次号 +1 创建 --- */
  if (seg[1] === 'production' && seg[3] === 'batches' && method === 'POST') {
    const t = db.production.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '生产任务不存在');
    const p = db.projects.find((x) => x.id === t.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    /* 只有木工负责人（生产部）可以新增批次；不允许手动输入批次编号 */
    if (!prodAllowed(me, p, '材料到场')) return fail(res, 403, '只有木工负责人可以新增生产批次');
    if (installOf(p.id) && !['安装确认', '安装派单'].includes(installOf(p.id).status)) return fail(res, 409, '安装已开始，新增批次需要先处理项目变更');
    if (!t.batch_flow) {
      t.batch_flow = true;
      if (p.project_status !== '已完成') p.project_status = '分批生产/出货中';
      if (!batchList(p.id).length) { createBatch(p, t, '系统'); createBatch(p, t, '系统'); }
      plog(p, '系统', '项目转入【分批生产 / 出货中】，系统固定创建第1、第2生产批次');
      saveDB();
      return ok(res, { batches: batchList(p.id).map((b) => b.batch_no), created: 2 });
    }
    const b = createBatch(p, t, me.name);
    t.batches_finalized = false;
    notifyCap('prod', '【新增生产批次】项目 ' + p.project_no + ' 已新增 ' + b.batch_name, '#/project/' + p.id + '/production');
    saveDB(); return ok(res, { batch_no: b.batch_no, batch_name: b.batch_name });
  }
  /* --- 生产批次作废 / 恢复（v2.1-A：误建批次可标记「作废」，仅有效批次参与汇总与闭环） --- */
  if (seg[1] === 'batches' && (seg[3] === 'void' || seg[3] === 'restore') && method === 'POST') {
    const bt = db.batches.find((x) => x.id === seg[2]); if (!bt) return fail(res, 404, '生产批次不存在');
    const p = db.projects.find((x) => x.id === bt.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!prodAllowed(me, p)) return fail(res, 403, '只有生产部和管理层可以操作生产批次');
    const b = await readJSON(req);
    if (seg[3] === 'void') {
      if (bt.status === '已出货') return fail(res, 400, '该批次已出货，不能作废');
      const ap = approvalOfBatch(bt.id);
      if (ap && ['待出货', '已完成'].includes(ap.status)) return fail(res, 400, '该批次已有在途出货审批，请先在【出货审批】终止后再作废');
      /* v2.1 修复：need() 抛错必须就地转成 400，否则会被外层兜底成 500「服务器内部错误」 */
      try { need(b, 'reason', '作废原因'); } catch (e) { return fail(res, 400, e.message); }
      if (String(b.reason).trim().length < 2) return fail(res, 400, '作废原因至少 2 个字');
      bt.valid = false; bt.void_reason = b.reason; bt.void_by = me.name; bt.void_at = now();
      if (ap && !['已完成', '已终止'].includes(ap.status)) ap.status = '已终止';
      plog(p, me.name, '生产批次【' + bt.batch_name + '】已作废：' + b.reason);
      notifyCap('prod', '【批次作废】项目 ' + p.project_no + ' · ' + bt.batch_name + ' 已作废：' + b.reason, '#/project/' + p.id + '/production');
    } else {
      bt.valid = true; bt.void_reason = ''; bt.void_by = ''; bt.void_at = '';
      plog(p, me.name, '生产批次【' + bt.batch_name + '】已恢复为有效批次');
    }
    /* 作废后有效批次可能已全部完成 → 立即重跑闭环判定 */
    const pt0 = prodOf(p.id);
    if (pt0 && pt0.batch_flow && batchFlowDone(p)) {
      if (p.need_install === true) {
        if (!installOf(p.id)) createInstallTask(p, '系统');
        p.project_status = '安装中';
        plog(p, '系统', '有效批次全部完成且项目需要安装，已创建唯一主安装任务');
      } else {
        pt0.batch_flow = false; p.need_install = false;
        p.project_status = '已完成'; p.actual_delivery_date = today();
        plog(p, '系统', '有效批次全部完成且无需安装，项目总状态 = 已完成 ✓');
      }
      notifyCap('admin', '【项目状态变更】项目 ' + p.project_no + ' 批次闭环判定通过 → ' + p.project_status, '#/project/' + p.id);
    }
    saveDB(); return ok(res, { valid: bt.valid, batch: bt.batch_name });
  }
  /* 已发货批次只补正生产资料，保留实际发货与审批事实。 */
  if (seg[1] === 'batches' && seg[3] === 'correct' && method === 'POST') {
    const bt = db.batches.find(x => x.id === seg[2]);
    const p = bt && db.projects.find(x => x.id === bt.project_id);
    if (!p || !canSeeProject(me, p) || !isA(me)) return fail(res, 403, '仅管理员可补正批次历史资料');
    if (isTerminated(p) || bt.status === '已终止') return fail(res, 409, '已终止批次不能补正');
    const body = await readJSON(req);
    if (body.expected_step !== bt.step || body.expected_updated_at !== bt.updated_at) return fail(res, 409, '批次资料已变化，请刷新后重试');
    const stage = String(body.stage || '');
    const fields = stage === '开料/木工/打磨'
      ? { batch_content: 'batch_content', material_arrival_date: 'material_arrival_date', cutting_complete_date: 'cutting_complete_date',
          woodwork_complete_date: 'woodwork_complete_date', woodwork_polish_date: 'polishing_complete_date',
          batch_exception: 'exception', batch_exception_desc: 'exception_desc' }
      : stage === '油漆/包装' ? { painting_complete_date: 'painting_complete_date', packaging_complete_date: 'packaging_complete_date' } : null;
    if (!fields) return fail(res, 400, '只能补正已存在的生产批次节点');
    if (stage === '油漆/包装' && !bt.painting_complete_date && !['生产完成', '已出货'].includes(bt.status)) return fail(res, 409, '该批次尚未走到油漆/包装节点');
    const reason = String(body.reason || '').trim();
    if (reason.length < 2) return fail(res, 400, '请填写至少 2 个字的补正原因');
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    const changes = [];
    for (const [key, column] of Object.entries(fields)) {
      if (!(key in data) || data[key] === '' || data[key] == null) continue;
      const value = String(data[key]).trim();
      if (!value) continue;
      if (key.endsWith('_date') && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) return fail(res, 400, '日期格式无效');
      if (key === 'batch_exception' && !['是', '否'].includes(value)) return fail(res, 400, '生产是否异常选项无效');
      if (String(bt[column] || '') !== value) changes.push({ field: key, column, old: bt[column] || '', value });
    }
    const nextException = changes.find(c => c.column === 'exception')?.value || bt.exception;
    const nextDesc = changes.find(c => c.column === 'exception_desc')?.value || bt.exception_desc;
    if (nextException === '是' && !String(nextDesc || '').trim()) return fail(res, 400, '生产异常时请填写异常说明');
    if (!changes.length) return fail(res, 400, '资料没有变化，无需补正');
    bt.correction_history = bt.correction_history || [];
    bt.correction_history.push({ stage, reason, by: me.id, at: now(), changes: changes.map(({ field, old, value }) => ({ field, old, value })) });
    for (const change of changes) bt[change.column] = change.value;
    if (changes.some(c => c.column === 'exception')) {
      const active = batchList(p.id).find(x => x.valid !== false && x.exception === '是');
      const main = prodOf(p.id);
      if (active || main?.is_exception) {
        p.exception_status = '生产异常'; p.exception_desc = active?.exception_desc || main?.exception_desc || '';
      } else if (p.exception_status === '生产异常') { p.exception_status = '无异常'; p.exception_desc = ''; }
    }
    if (bt.status !== '已出货') {
      for (const approval of db.approvals.filter(a => a.batch_id === bt.id && !['已完成', '已终止'].includes(a.status))) approval.paused_by = bt.id;
    }
    bt.updated_at = now(); p.updated_at = now();
    plog(p, me.name, '批次【' + bt.batch_name + '】' + stage + '资料补正：' + reason + '（' + changes.length + ' 项，出货事实保留）');
    saveDB(); return ok(res, { batch: bt.batch_name, status: bt.status, step: bt.step, changed: changes.length });
  }
  /* 单个生产批次推进：开料/木工/打磨 → 油漆/包装 → 生产完成 */
  if (seg[1] === 'batches' && seg[3] === 'advance' && method === 'POST') {
    const bt = db.batches.find((x) => x.id === seg[2]); if (!bt) return fail(res, 404, '生产批次不存在');
    if (bt.paused_by) return fail(res, 409, '上游退回，批次暂停，请先重新确认上游');
    const p = db.projects.find((x) => x.id === bt.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!prodAllowed(me, p, bt.step === '油漆/包装' ? '油漆喷刷' : '木工制作')) return fail(res, 403, '没有本批次当前节点操作权限');
    if (bt.status === '已出货') return fail(res, 400, '该批次已出货，不能继续推进');
    if (bt.valid === false) return fail(res, 400, '该批次已作废，不能推进（如需继续请先恢复为有效批次）');
    const b = await readJSON(req); const d = b.data || {};
    try {
      if (bt.step === '开料/木工/打磨') {
        need(d, 'material_arrival_date', '材料到场时间'); need(d, 'cutting_complete_date', '开料完成时间');
        need(d, 'woodwork_complete_date', '木工制作完成时间'); need(d, 'woodwork_polish_date', '木工打磨完成时间');
        need(d, 'batch_exception', '生产是否异常');
        need(d, 'batch_content', '本批生产内容');   /* v2.1-B */
        Object.assign(bt, {
          material_arrival_date: d.material_arrival_date, cutting_complete_date: d.cutting_complete_date,
          woodwork_complete_date: d.woodwork_complete_date, polishing_complete_date: d.woodwork_polish_date,
          batch_content: d.batch_content,
          exception: d.batch_exception, exception_desc: d.batch_exception_desc || bt.exception_desc,
        });
        bt.step = '油漆/包装';
        /* v2.1-E：本批木工制作完成 → 通知五金采购演示采购负责人该下单了 */
        notifyByName('演示采购负责人', '【外购下单】项目 ' + p.project_no + ' · ' + bt.batch_name + ' 木工制作已完成，请安排五金外购', '#/project/' + p.id + '/production');
      } else if (bt.step === '油漆/包装') {
        need(d, 'painting_complete_date', '油漆完成时间'); need(d, 'packaging_complete_date', '包装完成时间');
        bt.painting_complete_date = d.painting_complete_date; bt.packaging_complete_date = d.packaging_complete_date;
        bt.step = '本批次出货申请'; bt.status = '生产完成'; bt.progress = 100;
        /* 进入本批次出货申请：为本批次单独生成一张出货审批单 */
        if (!approvalOfBatch(bt.id)) {
          const ap = newApproval(p, db.production.find((x) => x.id === bt.production_task_id), bt.id);
          ap.is_multi_batch = true; ap.batch_no = bt.batch_no;
          db.approvals.push(ap);
        }
        plog(p, me.name, '生产批次【' + bt.batch_name + '】生产完成，可发起本批次出货申请');
        notify(p.sales_id, '【本批次出货申请】项目 ' + p.project_no + ' · ' + bt.batch_name + ' 已达可出货条件，请提交本次出货审批', '#/project/' + p.id + '/ship');
      } else {
        return fail(res, 400, '当前批次状态不可推进，请到【出货审批】处理本批次出货');
      }
    } catch (e) { return fail(res, 400, e.message); }
    bt.updated_at = now(); p.updated_at = now();
    if (bt.exception === '是') { p.exception_status = '生产异常'; p.exception_desc = bt.exception_desc || p.exception_desc; }
    saveDB(); return ok(res, { batch: bt.batch_name, step: bt.step });
  }

  /* ============ 出货审批 ============
   * 本地走通完整状态机；飞书审批通过 feishuAdapter 适配层接入（见 feishu.js）。
   * 状态：待发起 → 管理层审批 →（驳回：已驳回）→ 待填出货信息 → 待出货 → 已完成 */
  if (seg[1] === 'ship' && seg[3] && method === 'POST') {
    const a = db.approvals.find((x) => x.id === seg[2]); if (!a) return fail(res, 404, '审批单不存在');
    const p = db.projects.find((x) => x.id === a.project_id);
    const t = db.production.find((x) => x.id === a.production_task_id);
    const bt = a.batch_id ? db.batches.find((x) => x.id === a.batch_id) : null;
    if (!canSeeProject(me, p)) return fail(res, 403, '无权查看该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (a.paused_by || t?.paused_by || t?.rollback_pending) return fail(res, 409, '上游退回，审批暂停，不能接受旧审批回写');
    const act = seg[3]; const b = await readJSON(req); const d = b.data || {};
    const pushStep = (name, note) => a.steps.push({ name, at: now(), by: me.name, note: note || '' });
    const scopeTag = bt ? ' · ' + bt.batch_name : '';
    try {
      /* ---- 20. 销售一键提交出货申请（系统自动创建飞书《出货审批》） ---- */
      if (act === 'submit') {
        if (!isA(me) && !(hasCap(me, 'sales') && p.sales_id === me.id)) return fail(res, 403, '只有负责销售可以提交出货申请');
        if (!['待发起', '已驳回'].includes(a.status)) return fail(res, 400, '当前状态不可提交');
        needNode('ship', 'submit', d, a);
        Object.assign(a, {
          ship_doc: d.ship_doc, address_verified: !!d.address_verified, phone_verified: !!d.phone_verified,
          name_verified: !!d.name_verified, no_verified: !!d.no_verified,
          ship_customer_name: String(d.ship_customer_name).trim(), ship_customer_phone: String(d.ship_customer_phone).trim(),
          ship_address: String(d.ship_address).trim(), ship_project_no: String(d.ship_project_no).trim(),
          is_multi_batch: String(d.is_multi_batch) === '是', remark: d.remark || a.remark || '',
        });
        a.status = '管理层审批'; a.reject_reason = ''; a.finance_paid = ''; a.ship_condition_ok = '';
        pushStep('销售提交出货申请', '已上传出货单，客户姓名/电话/地址/项目编号已核对' + (a.is_multi_batch ? '（多批次出货）' : ''));
        /* 调用飞书适配层创建《出货审批》实例（未配置时返回本地模拟实例，系统照常可跑） */
        const fs1 = FEISHU.createShipApproval(p, a, bt ? bt.batch_name : '');
        a.feishu_instance_id = fs1.instance_id; a.feishu_status = fs1.status;
        a.feishu_synced_at = fs1.mock ? '' : now();
        plog(p, me.name, '提交出货申请' + scopeTag + (fs1.mock ? '（本地模式未接入飞书，已生成模拟审批实例 ' + fs1.instance_id + '）' : '，已创建飞书出货审批 ' + fs1.instance_id));
        /* 财务先确认尾款，再由演示审批主管确认发货条件 —— 两级都通知到 */
        for (const reviewer of db.users.filter((u) => u.active !== false && canConfirmShipFinance(u))) {
          notify(reviewer.id, '【出货审批】项目 ' + p.project_no + '（' + p.customer_name + '）' + scopeTag + ' 待财务确认尾款', '#/project/' + p.id + '/ship');
        }
      /* ---- 21. 管理层（财务 + 演示审批主管）审批 ---- */
      } else if (act === 'finance_confirm') {
        if (!canConfirmShipFinance(me)) return fail(res, 403, '只有财务或非演示审批主管管理员可以确认尾款');
        if (a.status !== '管理层审批') return fail(res, 400, '当前状态不可确认尾款');
        needNode('ship', 'finance_confirm', d, a);
        a.finance_paid = d.finance_paid;
        pushStep('财务确认尾款', d.finance_paid + (d.note ? ' · ' + d.note : ''));
        plog(p, me.name, '财务确认尾款：' + d.finance_paid + scopeTag);
        if (d.finance_paid === '已收齐') notifyByName('演示审批主管', '【出货审批】项目 ' + p.project_no + '（' + p.customer_name + '）' + scopeTag + ' 待确认发货条件', '#/project/' + p.id + '/ship');
      } else if (act === 'approve') {
        if (!canApproveShipConditions(me)) return fail(res, 403, '只有演示审批主管或其他管理层可以确认发货条件');
        if (a.status !== '管理层审批') return fail(res, 400, '当前状态不可审批');
        if (a.finance_paid !== '已收齐') return fail(res, 409, '请先由财务确认尾款已收齐');
        needNode('ship', 'approve', d, a);
        if (d.ship_condition_ok !== '达到发货条件') return fail(res, 409, '未达到发货条件，请驳回并填写原因');
        a.ship_condition_ok = d.ship_condition_ok;
        a.status = '待填出货信息';
        pushStep('管理层审批', '发货条件：' + d.ship_condition_ok + (d.note ? ' · ' + d.note : ''));
        plog(p, me.name, '出货审批通过' + scopeTag + '（发货条件：' + d.ship_condition_ok + '）');
        notify(p.sales_id, '【出货申请】项目 ' + p.project_no + scopeTag + ' 审批已通过，请填写约定发货时间、是否分派安装、客户确认状态', '#/project/' + p.id + '/ship');
      } else if (act === 'reject') {
        if (!canConfirmShipFinance(me) && !canApproveShipConditions(me)) return fail(res, 403, '只有财务或管理层可以驳回');
        if (a.status !== '管理层审批') return fail(res, 400, '当前状态不可驳回');
        need(d, 'reason', '驳回原因');
        a.status = '已驳回'; a.reject_reason = d.reason; pushStep('管理层审批', '驳回：' + d.reason);
        plog(p, me.name, '出货审批驳回' + scopeTag + '：' + d.reason);
        notify(p.sales_id, '【出货审批】项目 ' + p.project_no + scopeTag + ' 审批被驳回：' + d.reason + '，请修改后重新提交', '#/project/' + p.id + '/ship');
      /* ---- 22. 出货申请（审批通过后销售填写） ---- */
      } else if (act === 'confirm') {
        if (!isA(me) && !(hasCap(me, 'sales') && p.sales_id === me.id)) return fail(res, 403, '只有负责销售可以填写出货信息');
        if (a.status !== '待填出货信息') return fail(res, 400, '审批通过后才可填写出货信息');
        needNode('ship', 'confirm', d, a);
        /* v2.1-D 强校验：约定发货时间 ≥ 工厂最快发货时间 */
        const fastestShip = (bt && bt.material_arrival_date) || (t && t.material_arrival_date) || a.fastest_ship_date || '';
        if (fastestShip) {
          const fT = new Date(String(fastestShip).slice(0, 10) + 'T00:00:00').getTime();
          const aT = new Date(String(d.agreed_ship_date).slice(0, 10) + 'T00:00:00').getTime();
          if (!isNaN(fT) && !isNaN(aT) && aT < fT) {
            return fail(res, 400, '约定发货时间不得早于工厂最快发货时间（' + String(fastestShip).slice(0, 10) + '），请先与工厂确认最快发货时间');
          }
        }
        a.agreed_ship_date = d.agreed_ship_date;
        a.dispatch_install = d.dispatch_install;
        a.customer_confirm_status = d.customer_confirm_status;
        a.remark = d.remark || a.remark || '';
        if (bt) { bt.agreed_ship_date = d.agreed_ship_date; bt.ship_content = d.ship_content || bt.ship_content; bt.ship_remark = a.remark; }
        else if (t) { t.agreed_ship_date = d.agreed_ship_date; t.dispatch_install = d.dispatch_install; }
        /* v2.1-C：分批项目只维护「项目级安装意向」，各批次不重复创建安装任务 */
        const isBatchProject = !!(t && t.batch_flow) || !!bt;
        if (String(d.dispatch_install) === '是') p.need_install = true;
        else if (String(d.dispatch_install) === '否') p.need_install = false;
        /* 自动化：客户确认状态=已确认 且 约定发货时间已填写 */
        if (a.customer_confirm_status === '已确认' && a.agreed_ship_date) {
          a.status = '待出货';
          pushStep('填写出货信息', '约定发货 ' + a.agreed_ship_date + ' · 分派安装：' + a.dispatch_install);
          if (t && !bt) { t.status = '准备出货'; t.updated_at = now(); }
          if (bt) { bt.ship_status = '待出货'; bt.ship_no = bt.batch_no; }
          plog(p, '系统', '客户确认状态=已确认且约定发货时间已填写，系统自动：更新发货安排 / 发送飞书群通知 / 出货负责人生成待办 / 进入「待出货」' +
            (a.dispatch_install === '是' ? ' / 自动创建安装任务' : ''));
          notifyCap('prod', '【发货安排】项目 ' + p.project_no + '（' + p.customer_name + '）' + scopeTag + ' 约定 ' + a.agreed_ship_date + ' 发货，请按时安排', '#/project/' + p.id + '/ship');
          notifyByName('演示发货负责人', '【本次出货待办】项目 ' + p.project_no + '（' + p.customer_name + '）' + scopeTag + ' 约定 ' + a.agreed_ship_date + ' 发货，请安排出货', '#/project/' + p.id + '/ship');
          notifyCap('admin', '【发货通知】项目 ' + p.project_no + '（' + p.customer_name + '）' + scopeTag + ' 约定 ' + a.agreed_ship_date + ' 发货', '#/project/' + p.id + '/ship');
          /* 飞书群通知（本地模式下仅记录到日志，接入后由适配层真实发送） */
          FEISHU.notifyShipGroup({ project: p, approval: a, batchName: bt ? bt.batch_name : '' });
          /* v2.1-C：单批次项目此时创建安装任务；分批项目只记意向，待全部有效批次完成后统一创建唯一主安装任务 */
          if (a.dispatch_install === '是') plog(p, '系统', '已记录安装意向，首次实际发货后建立唯一安装档案');
        } else {
          pushStep('填写出货信息', '约定发货 ' + (a.agreed_ship_date || '—') + ' · 客户确认：' + a.customer_confirm_status);
          plog(p, me.name, '填写出货信息' + scopeTag + '（客户确认状态：' + a.customer_confirm_status + '，尚未满足自动进入待出货的条件）');
        }
      /* ---- 23. 准备出货（发货负责人） ---- */
      } else if (act === 'prepare') {
        if (!prodAllowed(me, p, '准备出货')) return fail(res, 403, '只有发货负责人可以操作准备出货');
        if (a.status !== '待出货') return fail(res, 400, '当前状态不可操作准备出货');
        if (!bt && t && d.custom !== undefined) d.custom = CUSTOM_FIELDS.normalize(d.custom, defsFor('production', '准备出货'), db.users, t.custom);
        needNode('ship', 'prepare', d, a);
        if (!bt && t && d.ship_status === '已出货') needCustom(d, 'production', '准备出货', t);
        if (!bt && t) mergeCustom(t, 'production', d.custom, '准备出货');
        a.actual_ship_date = d.actual_ship_date;
        a.ship_status = d.ship_status;
        a.ship_remark = d.ship_remark || '';
        if (bt) { bt.actual_ship_date = d.actual_ship_date; bt.ship_status = d.ship_status; bt.remark = a.ship_remark; }
        else if (t) { t.actual_ship_date = d.actual_ship_date; t.ship_status = d.ship_status; t.ship_remark = a.ship_remark; }
        if (a.ship_status === '已出货') {
          a.status = '已完成';
          pushStep('准备出货 / 实际发货', '实际发货 ' + a.actual_ship_date + ' · 状态：已出货');
          if (bt) { bt.status = '已出货'; bt.step = '本批次已出货'; }
          else if (t) { t.status = '准备出货'; t.ship_done_at = d.actual_ship_date; t.updated_at = now(); }
          plog(p, me.name, '【' + (bt ? bt.batch_name : '单批次') + '】实际出货完成：' + d.actual_ship_date);
          if ((p.need_install === true || a.dispatch_install === '是') && !installOf(p.id)) createInstallTask(p, '系统');
          notify(p.sales_id, '【已出货】项目 ' + p.project_no + scopeTag + ' 已于 ' + d.actual_ship_date + ' 实际发货', '#/project/' + p.id);
          notifyCap('admin', '【已出货】项目 ' + p.project_no + '（' + p.customer_name + '）' + scopeTag + ' 已发货', '#/project/' + p.id);
          /* 项目闭环判定 */
          const allDone = bt ? batchFlowDone(p) : true;
          if (allDone) {
            /* v2.1-C：分批项目以「项目级安装意向」为准，单批次以本次出货的 dispatch_install 为准 */
            const needInstall = bt ? (p.need_install === true) : (a.dispatch_install === '是' || p.need_install === true);
            if (needInstall) {
              if (!installOf(p.id)) createInstallTask(p, '系统');
              p.project_status = '安装中';
              plog(p, '系统', '所有有效生产批次均已生产并出货完成，项目进入【安装确认】（唯一主安装任务）');
            } else {
              const pt = prodOf(p.id);
              if (pt) pt.batch_flow = false;   // 批次全部结束，主生产任务退出分批模式
              p.need_install = false;
              p.project_status = '已完成'; p.actual_delivery_date = today();
              plog(p, '系统', '无需安装，所有有效批次出货完成，项目总状态 = 已完成 ✓');
              notifyCap('admin', '【项目交付】项目 ' + p.project_no + '（' + p.customer_name + '）已完成交付', '#/project/' + p.id);
            }
          } else {
            p.project_status = '分批生产/出货中';
            plog(p, '系统', '本批次已出货，仍有批次未完成，主项目继续保持【分批生产 / 出货中】');
          }
        } else {
          pushStep('准备出货 / 实际发货', '出货状态：' + a.ship_status);
          plog(p, me.name, '更新出货状态' + scopeTag + '：' + a.ship_status);
        }
      /* ---- 预留：飞书审批结果回写（由适配层/回调调用） ---- */
      } else if (act === 'feishu_sync') {
        if (!isA(me)) return fail(res, 403, '只有管理员可以手动同步飞书审批结果');
        need(d, 'status', '飞书审批状态');
        a.feishu_status = d.status;
        if (d.instance_id) a.feishu_instance_id = d.instance_id;
        a.feishu_synced_at = now();
        if (String(d.approved) === 'true' || d.status === '已通过') {
          if (a.status === '管理层审批') {
            a.status = '待填出货信息';
            pushStep('管理层审批', '飞书审批结果回写：通过' + (d.comment ? ' · ' + d.comment : ''));
            notify(p.sales_id, '【出货申请】项目 ' + p.project_no + scopeTag + ' 飞书审批已通过，请填写约定发货时间与是否分派安装', '#/project/' + p.id + '/ship');
          }
        } else if (d.status === '已驳回' && a.status === '管理层审批') {
          a.status = '已驳回'; a.reject_reason = d.comment || '飞书审批驳回';
          pushStep('管理层审批', '飞书审批结果回写：驳回 · ' + a.reject_reason);
          notify(p.sales_id, '【出货审批】项目 ' + p.project_no + scopeTag + ' 飞书审批被驳回：' + a.reject_reason, '#/project/' + p.id + '/ship');
        }
        plog(p, me.name, '同步飞书审批结果：' + d.status);
      } else return fail(res, 404, '未知操作');
    } catch (e) { return fail(res, 400, e.message); }
    saveDB(); return ok(res, { status: a.status });
  }

  /* --- 自定义字段设置（管理员 / 具备「员工管理」权限） --- */
  if (pathname === '/api/fields' && method === 'GET') {
    if (!canStaff(me)) return fail(res, 403, '只有管理员可以查看字段设置');
    return ok(res, { fields: db.field_defs || [] });
  }
  if (pathname === '/api/fields/create' && method === 'POST') {
    if (!canStaff(me)) return fail(res, 403, '只有管理员可以新增字段');
    const b = await readJSON(req);
    try { need(b, 'label', '字段名称'); } catch (e) { return fail(res, 400, e.message); }
    if (!FIELD_SCOPES[b.scope]) return fail(res, 400, '请选择所属表单（项目/设计/生产/安装/售后）');
    if (!FIELD_TYPES[b.type]) return fail(res, 400, '请选择字段类型');
    const stage = String(b.stage || '');
    if (stage && !(STAGES_BY_SCOPE[b.scope] || []).includes(stage)) return fail(res, 400, '节点「' + stage + '」不属于该表单');
    const options = CUSTOM_FIELDS.choices(b.type) ? CUSTOM_FIELDS.optionsOf(b.options_raw || b.options) : [];
    if (CUSTOM_FIELDS.choices(b.type) && !options.length) return fail(res, 400, '单选或多选字段必须填写可选值');
    const key = 'cf' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
    const maxOrder = (db.field_defs || []).reduce((m, f) => Math.max(m, f.order || 0), 0);
    db.field_defs.push({ id: uid('fd'), scope: b.scope, stage: stage, key: key, label: String(b.label).trim(), type: b.type, required: !!b.required, options: options, order: maxOrder + 1, builtin: false, active: true, created_at: now(), created_by: me.name });
    saveDB(); return ok(res, { id: key });
  }
  if (pathname === '/api/fields/update' && method === 'POST') {
    if (!canStaff(me)) return fail(res, 403, '只有管理员可以修改字段');
    const b = await readJSON(req);
    const stored = (db.field_defs || []).find((x) => x.id === b.id || x.key === b.id);
    if (!stored) return fail(res, 404, '字段不存在');
    const f = { ...stored };
    if (b.label !== undefined) { if (!String(b.label).trim()) return fail(res, 400, '字段名称不能为空'); f.label = String(b.label).trim(); }
    if (b.type !== undefined) { if (!FIELD_TYPES[b.type]) return fail(res, 400, '字段类型非法'); f.type = b.type; }
    if (b.scope !== undefined) { if (!FIELD_SCOPES[b.scope]) return fail(res, 400, '所属表单非法'); f.scope = b.scope; }
    if (b.stage !== undefined) {
      const st = String(b.stage || '');
      if (st && !(STAGES_BY_SCOPE[f.scope] || []).includes(st)) return fail(res, 400, '节点「' + st + '」不属于该表单');
      f.stage = st;
    }
    if (b.options_raw !== undefined) f.options = CUSTOM_FIELDS.optionsOf(b.options_raw);
    if (f.stage && !(STAGES_BY_SCOPE[f.scope] || []).includes(f.stage)) return fail(res, 400, '节点「' + f.stage + '」不属于该表单');
    if (CUSTOM_FIELDS.choices(f.type) && !(f.options || []).length) return fail(res, 400, '单选或多选字段必须填写可选值');
    if (b.required !== undefined) f.required = !!b.required;
    if (b.active !== undefined) f.active = !!b.active;
    const collections = { project: db.projects, design: db.design, production: db.production, install: db.installations, aftersales: db.aftersales };
    const updateIssue = CUSTOM_FIELDS.updateError(stored, f, collections[stored.scope] || []);
    if (updateIssue) return fail(res, 409, updateIssue);
    Object.assign(stored, f);
    saveDB(); return ok(res, { id: f.key });
  }
  if (pathname === '/api/fields/delete' && method === 'POST') {
    if (!canStaff(me)) return fail(res, 403, '只有管理员可以删除字段');
    const b = await readJSON(req);
    const f = (db.field_defs || []).find((x) => x.id === b.id || x.key === b.id);
    if (!f) return fail(res, 404, '字段不存在');
    const collections = { project: db.projects, design: db.design, production: db.production, install: db.installations, aftersales: db.aftersales };
    if (CUSTOM_FIELDS.storedValues(collections[f.scope] || [], f.key).length) return fail(res, 409, '字段已有填写记录，不能删除；可停用并保留历史内容');
    db.field_defs = db.field_defs.filter((x) => x !== f);
    saveDB(); return ok(res, { deleted: f.label });
  }

  /* --- 自定义字段：单独保存（不推进节点） ---
     管理员给某个节点加了字段后，这个节点可能本来没有内置表单（例如生产的「出货申请/准备出货/出货完成」由出货流程驱动），
     所以提供一个「只存字段、不动状态」的入口，任何节点都能把附加字段填上。 */
  if (['projects', 'design', 'production', 'install'].includes(seg[1]) && seg[3] === 'fields' && method === 'POST') {
    const CF_MAP = {
      projects: { scope: 'project', list: db.projects, cap: '' },
      design: { scope: 'design', list: db.design, cap: 'designer' },
      production: { scope: 'production', list: db.production, cap: 'prod' },
      install: { scope: 'install', list: db.installations, cap: 'install' },
    };
    const cfg = CF_MAP[seg[1]];
    const t = cfg.list.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '任务不存在');
    const p = seg[1] === 'projects' ? t : db.projects.find((x) => x.id === t.project_id);
    if (!p) return fail(res, 404, '项目不存在');
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    const asSales = hasCap(me, 'sales') && p.sales_id === me.id;
    const allowCf = cfg.scope === 'project' ? (isA(me) || asSales || canAct(me, 'new_external')) :
      cfg.scope === 'design' ? designAllowed(me, p, t.status) :
      cfg.scope === 'production' ? prodAllowed(me, p, t.status) : installAllowed(me, p, t.status);
    if (!allowCf) return fail(res, 403, '您没有权限填写该表单的附加字段');
    const b = await readJSON(req);
    let custom;
    try { custom = normalizeNodeCustom(b, cfg.scope, cfg.scope === 'project' ? '' : t.status, t); }
    catch (e) { return fail(res, 400, e.message); }
    const saved = mergeCustom(t, cfg.scope, custom, cfg.scope === 'project' ? '' : t.status);
    if (!saved.length) return fail(res, 400, '没有可保存的字段');
    t.updated_at = now(); p.updated_at = now();
    plog(p, me.name, '填写附加字段 ' + saved.length + ' 项');
    saveDB(); return ok(res, { saved: saved.length });
  }

  /* --- 项目终止（方案 §2.2 第 12 节点「已终止」· 管理层） --- */
  if (seg[1] === 'projects' && seg[3] === 'terminate' && method === 'POST') {
    const p = db.projects.find((x) => x.id === seg[2]); if (!p) return fail(res, 404, '项目不存在');
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (!canTerminate(me)) return fail(res, 403, '只有管理层或具备「项目终止」权限的人可以终止项目');
    if (p.project_status === '已终止') return fail(res, 400, '项目已终止，请勿重复操作');
    if (p.project_status === '已完成') return fail(res, 400, '项目已完成交付，不能终止');
    const b = await readJSON(req);
    try { need(b, 'reason', '终止原因'); } catch (e) { return fail(res, 400, e.message); }
    const reason = String(b.reason).trim();
    if (reason.length < 2) return fail(res, 400, '请填写具体的终止原因');
    const prev = p.project_status;
    p.project_status = '已终止'; p.terminate_from = prev; p.terminate_reason = reason; p.terminated_by = me.name; p.terminated_at = now();
    if (p.exception_status && p.exception_status !== '无异常') { p.exception_status = '无异常'; p.exception_desc = ''; }
    const d = designOf(p.id);
    if (d && d.status !== '设计完成') { d.terminated = true; d.terminated_at = now(); d.terminated_reason = reason; }
    const t = prodOf(p.id);
    if (t && t.status !== '已终止' && !t.ship_done_at) { t.status = '已终止'; t.terminated_at = now(); t.terminated_reason = reason; t.terminated_by = me.name; }
    for (const b of batchList(p.id)) { if (b.status !== '已出货') { b.status = '已终止'; b.terminated_at = now(); } }
    const it = installOf(p.id);
    if (it && it.status !== '安装完成') { it.terminated = true; it.terminated_at = now(); it.terminated_reason = reason; }
    for (const a of db.approvals.filter((x) => x.project_id === p.id && !['已完成', '已终止'].includes(x.status))) {
      a.status = '已终止'; a.steps.push({ name: '项目终止', at: now(), by: me.name, note: '项目终止：' + reason });
    }
    plog(p, me.name, '项目终止（原状态：' + prev + '）：' + reason);
    notify(p.sales_id, '【项目终止】项目 ' + p.project_no + '（' + p.customer_name + '）已由 ' + me.name + ' 终止：' + reason, '#/project/' + p.id);
    notifyCaps(['designer', 'prod', 'install'], '【项目终止】项目 ' + p.project_no + '（' + p.customer_name + '）已终止，相关任务停止：' + reason, '#/project/' + p.id);
    notifyCap('admin', '【项目终止】' + me.name + ' 终止了项目 ' + p.project_no + '（' + p.customer_name + '）：' + reason, '#/project/' + p.id);
    saveDB(); return ok(res, { project_status: p.project_status });
  }

  /* --- 安装任务（节点字段与必填由 spec.js 驱动） --- */
  if (seg[1] === 'install' && seg[3] === 'advance' && method === 'POST') {
    const t = db.installations.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '安装任务不存在');
    const p = db.projects.find((x) => x.id === t.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作该项目');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!installAllowed(me, p, t.status)) return fail(res, 403, '当前节点【' + t.status + '】您没有操作权限');
    const b = await readJSON(req); const d = b.data || {};
    const stage = t.status;
    try { needNode('install', stage, d, t); } catch (e) { return fail(res, 400, e.message); }
    const saved = applyNodeFields(t, 'install', stage, d);
    mergeCustom(t, 'install', d.custom);

    if (stage === '安装确认') {
      t.install_address = t.install_address || p.address || '';
      plog(p, me.name, '安装确认：' + (t.install_address || '—') + '，确认安装时间 ' + (t.confirm_install_date || '—'));
    } else if (stage === '安装派单') {
      p.installer_id = t.manager_id || me.id;
      plog(p, me.name, '安装派单：' + (t.installer_name || '—') + '（负责人 ' + (userName(t.manager_id) || '—') + '）');
      notify(p.sales_id, '【安装派单】项目 ' + p.project_no + ' 已派给 ' + (t.installer_name || '—') + '，安装日期 ' + (t.confirm_install_date || '待确认'), '#/project/' + p.id + '/install');
      notifyCaps(['install', 'admin'], '【安装提醒】项目 ' + p.project_no + ' 将于 ' + (t.confirm_install_date || '待定') + ' 安装', '#/project/' + p.id + '/install');
    } else if (stage === '正在安装') {
      t.is_exception = String(t.install_exception) === '是';
      if (t.is_exception) {
        p.exception_status = '安装异常'; p.exception_desc = t.exception_desc || '';
        if (p.project_status !== '已完成') p.project_status = '异常';
        notifyCap('admin', '【异常提醒】项目 ' + p.project_no + ' 安装异常：' + (t.exception_desc || ''), '#/project/' + p.id + '/install');
        notify(p.sales_id, '【异常提醒】您的项目 ' + p.project_no + ' 安装异常：' + (t.exception_desc || ''), '#/project/' + p.id + '/install');
      } else if (p.exception_status === '安装异常') {
        p.exception_status = '无异常'; p.exception_desc = ''; t.exception_resolve_date = today();
        if (p.project_status === '异常') p.project_status = '安装中';
      }
      plog(p, me.name, '开始安装' + (t.is_exception ? '（已报备安装异常）' : ''));
    } else if (stage === '验收确认') {
      plog(p, me.name, '验收' + (t.accept_result || '') + (t.accept_result === '不合格' ? '，需整改：' + (t.rectification_desc || '') : ''));
      if (t.accept_result === '不合格') notifyCaps(['install'], '【整改提醒】项目 ' + p.project_no + ' 验收不合格，需整改：' + (t.rectification_desc || ''), '#/project/' + p.id + '/install');
    } else if (stage === '客户确认') {
      plog(p, me.name, '客户确认：' + (t.customer_confirm_status || '') + '，评价 ' + (t.customer_rating || 0) + ' 星');
    }

    const idx = INSTALL_STAGES.indexOf(t.status);
    let next = INSTALL_STAGES[idx + 1];
    if (next === '安装完成') {
      /* 「客户确认」后系统自动标记「安装完成」 */
      t.status = '安装完成';
      const dd = t.actual_delivery_date || today();
      t.actual_delivery_date = dd; p.actual_delivery_date = dd; p.project_status = '已完成';
      plog(p, '系统', '安装完成，项目交付 ✓ 实际交付日期：' + dd);
      notifyCap('admin', '【项目交付】项目 ' + p.project_no + '（' + p.customer_name + '）已完成交付', '#/project/' + p.id);
    } else {
      t.status = next || t.status;
    }
    markRollbackProgress(t, stage, INSTALL_STAGES, ['安装完成']);
    t.updated_at = now(); p.updated_at = now();
    saveDB(); return ok(res, { status: t.status });
  }
  if (seg[1] === 'install' && seg[3] === 'exception' && method === 'POST') {
    const t = db.installations.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '安装任务不存在');
    const p = db.projects.find((x) => x.id === t.project_id);
    if (!canSeeProject(me, p)) return fail(res, 403, '无权操作');
    if (isTerminated(p)) return fail(res, 400, '项目已终止，不能继续操作');
    if (!isA(me) && !hasCap(me, 'install')) return fail(res, 403, '只有安装部可以登记安装异常');
    const b = await readJSON(req);
    if (b.resolve) {
      t.is_exception = false; t.exception_resolve_date = today(); plog(p, me.name, '安装异常已解决');
      if (p.exception_status === '安装异常') { p.exception_status = '无异常'; p.exception_desc = ''; if (p.project_status === '异常') p.project_status = '安装中'; }
    } else {
      need(b, 'desc', '异常说明');
      t.is_exception = true; t.exception_desc = b.desc; t.exception_date = today();
      p.exception_status = '安装异常'; p.exception_desc = b.desc; if (p.project_status !== '已完成') p.project_status = '异常';
      plog(p, me.name, '安装异常：' + b.desc);
      notifyCap('admin', '【异常提醒】项目 ' + p.project_no + ' 安装异常：' + b.desc, '#/project/' + p.id + '/install');
      notify(p.sales_id, '【异常提醒】您的项目 ' + p.project_no + ' 安装异常：' + b.desc, '#/project/' + p.id + '/install');
    }
    saveDB(); return ok(res);
  }

  /* --- 售后工单 --- */
  if (pathname === '/api/aftersales' && method === 'POST') {
    if (!isA(me) && !hasCap(me, 'sales') && !hasCap(me, 'install')) return fail(res, 403, '无权创建售后工单');
    const b = await readJSON(req);
    need(b, 'customer_name', '客户姓名'); need(b, 'problem_desc', '问题描述');
    let pid = b.project_id || '';
    const p = pid ? db.projects.find((x) => x.id === pid) : null;
    if (pid && !canSeeProject(me, p)) return fail(res, 403, '无权关联该项目');
    const t = {
      id: uid('as'), ticket_no: nextNo('YGX') + '-SH', project_id: pid, customer_name: b.customer_name, customer_phone: b.customer_phone || '',
      address: b.address || '', problem_desc: b.problem_desc, problem_images: b.problem_images || '',
      status: '待派工', assignee_id: '', assignee_name: '', apply_date: today(), start_date: '', expected_finish_date: b.expected_finish_date || '',
      actual_finish_date: '', customer_rating: 0, customer_feedback: '', after_sales_doc: b.after_sales_doc || '', photos: '', created_at: now(), updated_at: now(),
    };
    db.aftersales.push(t);
    if (p) plog(p, me.name, '创建售后工单 ' + t.ticket_no);
    notifyCaps(['install', 'admin'], '【售后工单】新工单 ' + t.ticket_no + '（' + b.customer_name + '）待派工', '#/aftersales');
    saveDB(); return ok(res, { id: t.id, ticket_no: t.ticket_no });
  }
  if (seg[1] === 'aftersales' && seg[3] === 'advance' && method === 'POST') {
    const t = db.aftersales.find((x) => x.id === seg[2]); if (!t) return fail(res, 404, '工单不存在');
    const p = t.project_id ? db.projects.find((x) => x.id === t.project_id) : null;
    if (p && !canSeeProject(me, p)) return fail(res, 403, '无权操作');
    const b = await readJSON(req); const d = b.data || {};
    const stage = t.status;
    const allow = (roles, salesToo) => isA(me) || roles.some((r) => hasCap(me, r)) || (salesToo && hasCap(me, 'sales'));
    try {
      needCustom(d, 'aftersales', stage, t);
      if (stage === '待派工') { if (!allow(['install'])) return fail(res, 403, '只有售后负责人可以派工'); need(d, 'assignee_name', '派工人员'); t.assignee_name = d.assignee_name; const au = db.users.find((x) => x.name === d.assignee_name); t.assignee_id = au ? au.id : ''; t.start_date = today(); plog(p, me.name, '售后派工：' + d.assignee_name); notify(t.assignee_id, '【售后派工】工单 ' + t.ticket_no + ' 已派给您，请及时处理', '#/aftersales'); }
      else if (stage === '待执行') { if (!allow(['install'])) return fail(res, 403, '无权操作'); t.start_date = today(); plog(p, me.name, '售后开始执行'); }
      else if (stage === '执行中') { if (!allow(['install', 'sales'])) return fail(res, 403, '无权操作'); t.actual_finish_date = today(); if (d.photos) t.photos = d.photos; plog(p, me.name, '售后处理完成，等待确认'); notifyCaps(['install', 'admin'], '【售后确认】工单 ' + t.ticket_no + ' 已完工，请确认', '#/aftersales'); }
      else if (stage === '已完成') { if (!allow(['install'])) return fail(res, 403, '只有售后负责人可以确认完结'); plog(p, me.name, '售后服务已完结'); }
      else if (stage === '已完结') { if (!allow(['install'], true)) return fail(res, 403, '无权操作'); const r = Number(d.customer_rating); if (r) t.customer_rating = r; if (d.customer_feedback) t.customer_feedback = d.customer_feedback; plog(p, me.name, '客户确认服务结束' + (r ? '，评分 ' + r + ' 星' : '')); }
    } catch (e) { return fail(res, 400, e.message); }
    mergeCustom(t, 'aftersales', d.custom, stage);
    const idx = AFTER_STAGES.indexOf(t.status);
    t.status = AFTER_STAGES[idx + 1] || t.status; t.updated_at = now();
    saveDB(); return ok(res, { status: t.status });
  }
  if (seg[1] === 'aftersales' && seg[3] === 'terminate' && method === 'POST') {
    const t = db.aftersales.find((x) => x.id === seg[2]);
    if (!t) return fail(res, 404, '工单不存在');
    if (!isA(me)) return fail(res, 403, '只有管理层可以终止售后工单');
    const p = t.project_id ? db.projects.find((x) => x.id === t.project_id) : null;
    t.status = '已终止'; plog(p, me.name, '售后工单已终止（管理层）');
    saveDB(); return ok(res);
  }

  /* --- 系统配置（飞书 + 大模型） --- */
  if (pathname === '/api/config' && method === 'POST') {
    return fail(res, 403, '隔离试用版禁止配置真实飞书凭据及外部服务');
    if (!isA(me)) return fail(res, 403, '只有管理层可以修改系统配置');
    const b = await readJSON(req);
    const c = db.config || {};
    const str = (v, d) => (v === undefined ? d : String(v));
    db.config = {
      feishu_app_id: str(b.feishu_app_id, c.feishu_app_id || ''),
      feishu_app_secret: str(b.feishu_app_secret, c.feishu_app_secret || ''),
      /* 飞书登录回调地址：需与开放平台后台登记的完全一致；留空则按 YGX_BASE_URL 自动生成 */
      feishu_login_redirect: str(b.feishu_login_redirect, c.feishu_login_redirect || ''),
      approval_code: str(b.approval_code, c.approval_code || ''),
      llm_base_url: str(b.llm_base_url, c.llm_base_url || ''),
      llm_api_key: str(b.llm_api_key, c.llm_api_key || ''),
      llm_model: str(b.llm_model, c.llm_model || ''),
      llm_enabled: b.llm_enabled === undefined ? !!c.llm_enabled : !!b.llm_enabled,
    };
    saveDB(); return ok(res, { config: db.config });
  }

  /* ---------------- 权限组（部门） ---------------- */
  /* 标注：canStaff 已在请求入口统一定义，这里不再重复声明 */

  /* 归一化权限组入参：只接受合法页面/动作/能力，非法值回落 */
  function normGroupBody(b, base) {
    const str = (v, d) => (v === undefined ? d : String(v).trim());
    const pages = Array.isArray(b.pages) ? b.pages.filter((x) => ALL_PAGES.includes(x)) : (base ? base.pages.slice() : []);
    const actions = Array.isArray(b.actions) ? b.actions.filter((x) => ALL_ACTIONS.includes(x)) : (base ? base.actions.slice() : []);
    const caps = Array.isArray(b.caps) ? b.caps.filter((x) => ALL_CAPS.includes(x)) : (base ? (base.caps || []).slice() : []);
    const scope = SCOPE_DEFS.some((x) => x.key === b.scope) ? b.scope : (base ? base.scope : 'self');
    return {
      name: str(b.name, base ? base.name : ''), desc: str(b.desc, base ? (base.desc || '') : ''),
      pages: Array.from(new Set(pages)), actions: Array.from(new Set(actions)),
      caps: Array.from(new Set(caps)), scope,
    };
  }
  const memberCount = (key) => db.users.filter((u) => (u.roles || []).includes(key)).length;
  const pubGroup = (g) => Object.assign({}, g, { members: memberCount(g.key) });

  if (pathname === '/api/groups' && method === 'GET') {
    if (!canStaff()) return fail(res, 403, '无权查看权限组');
    return ok(res, { groups: db.groups.map(pubGroup) });
  }

  if (pathname === '/api/groups/create' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '无权新建权限组');
    const b = await readJSON(req);
    const g = normGroupBody(b, null);
    if (!g.name) return fail(res, 400, '请填写权限组名称');
    let key = String(b.key || '').trim().replace(/[^A-Za-z0-9_]/g, '');
    if (!key) key = 'g' + Date.now().toString(36);
    if (groupExists(key)) return fail(res, 400, '权限组标识「' + key + '」已存在，请换一个');
    const ng = Object.assign({ key, builtin: false }, g);
    db.groups.push(ng); saveDB();
    return ok(res, { group: pubGroup(ng) });
  }

  if (pathname === '/api/groups/update' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '无权修改权限组');
    const b = await readJSON(req);
    const g = db.groups.find((x) => x.key === b.key);
    if (!g) return fail(res, 404, '权限组不存在');
    const nb = normGroupBody(b, g);
    if (!nb.name) return fail(res, 400, '权限组名称不能为空');
    /* 防呆：管理层组必须保留「管理层」能力 + 全部数据，否则可能把所有人锁死 */
    if (g.key === 'admin') {
      if (!nb.caps.includes('admin')) return fail(res, 400, '「管理层」权限组必须保留「管理层」能力');
      if (nb.scope !== 'all') return fail(res, 400, '「管理层」权限组的数据范围必须是「全部数据」');
    }
    Object.assign(g, nb); saveDB();
    return ok(res, { group: pubGroup(g) });
  }

  if (pathname === '/api/groups/delete' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '无权删除权限组');
    const b = await readJSON(req);
    const g = db.groups.find((x) => x.key === b.key);
    if (!g) return fail(res, 404, '权限组不存在');
    if (g.key === 'admin') return fail(res, 400, '默认「管理层」权限组不可删除');
    const n = memberCount(g.key);
    if (n) return fail(res, 400, '该组还有 ' + n + ' 名成员，请先把他们移到别的组再删除');
    db.groups = db.groups.filter((x) => x.key !== g.key); saveDB();
    return ok(res);
  }

  /* ---------------- 员工管理 ---------------- */
  function normPerms(p, roles) {
    const base = permsFromRoles(roles);
    if (!p) return base;
    const pages = Array.isArray(p.pages) ? p.pages.filter((x) => ALL_PAGES.includes(x)) : base.pages;
    const actions = Array.isArray(p.actions) ? p.actions.filter((x) => ALL_ACTIONS.includes(x)) : base.actions;
    const scope = SCOPE_DEFS.some((s) => s.key === p.scope) ? p.scope : base.scope;
    return { pages: Array.from(new Set(pages)), scope, actions: Array.from(new Set(actions)) };
  }
  function normRoles(rs) {
    const list = (Array.isArray(rs) ? rs : []).filter((r) => groupExists(r));
    return Array.from(new Set(list));
  }
  function adminCount() { return db.users.filter((u) => u.roles.includes('admin') && u.active !== false).length; }
  /* 一个人是否已被业务数据引用 */
  function usedBy(u) {
    const collections = { project: db.projects, design: db.design, production: db.production, install: db.installations, aftersales: db.aftersales };
    const customUse = (db.field_defs || []).filter(f => ['user', 'users'].includes(f.type)).some(f =>
      CUSTOM_FIELDS.storedValues(collections[f.scope] || [], f.key).some(value => Array.isArray(value) ? value.includes(u.id) : value === u.id));
    return db.projects.some((p) => [p.sales_id, p.designer_id, p.production_manager_id, p.installer_id, p.after_sales_id].includes(u.id))
      || db.design.some((t) => [t.designer_id, t.sales_id, t.splitter_id].includes(u.id))
      || db.production.some((t) => [t.production_manager_id, ...(t.production_manager_ids || []), t.material_manager_id, t.sales_id].includes(u.id))
      || db.installations.some((t) => [t.manager_id, t.sales_id].includes(u.id))
      || db.aftersales.some((t) => [t.assignee_id, t.sales_id].includes(u.id)) || customUse;
  }

  if (pathname === '/api/staff' && method === 'GET') {
    if (!canStaff()) return fail(res, 403, '无权查看员工信息');
    return ok(res, { users: db.users.map(pubUser) });
  }

  if (pathname === '/api/staff/create' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '只有管理层或具备员工管理权限的人可以新增员工');
    const b = await readJSON(req);
    need(b, 'name', '姓名'); need(b, 'username', '账号');
    const uname = String(b.username).trim();
    if (db.users.some((u) => u.username === uname)) return fail(res, 400, '账号「' + uname + '」已存在');
    if (b.phone && db.users.some((u) => u.phone && u.phone === String(b.phone))) return fail(res, 400, '手机号已被其他员工使用');
    const roles = normRoles(b.roles);
    if (!roles.length) return fail(res, 400, '请至少选择一个权限组');
    const np = String(b.password || '123456');
    if (np.length < 6) return fail(res, 400, '初始密码至少 6 位');
    /* 默认跟随权限组；只有明确传了 perms 才落为个人单独设置 */
    const u = {
      id: uid('u'), username: uname, phone: String(b.phone || '').trim(), name: String(b.name).trim(),
      roles, title: String(b.title || '').trim(), pwd: sha(np), active: true,
      custom: false, perms: null, allow_zoom: b.allow_zoom === true,
    };
    db.users.push(u); saveDB();
    return ok(res, { user: pubUser(u) });
  }

  if (pathname === '/api/staff/update' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '无权修改员工信息');
    const b = await readJSON(req);
    const u = db.users.find((x) => x.id === b.id);
    if (!u) return fail(res, 404, '员工不存在');
    if (b.username !== undefined) {
      const uname = String(b.username).trim();
      if (!uname) return fail(res, 400, '账号不能为空');
      if (db.users.some((x) => x.id !== u.id && x.username === uname)) return fail(res, 400, '账号「' + uname + '」已存在');
      u.username = uname;
    }
    if (b.phone !== undefined) {
      const ph = String(b.phone).trim();
      if (ph && db.users.some((x) => x.id !== u.id && x.phone === ph)) return fail(res, 400, '手机号已被其他员工使用');
      u.phone = ph;
    }
    if (b.name !== undefined && String(b.name).trim()) u.name = String(b.name).trim();
    if (b.title !== undefined) u.title = String(b.title).trim();
    if (b.allow_zoom !== undefined) u.allow_zoom = b.allow_zoom === true;
    if (b.roles !== undefined) {
      const roles = normRoles(b.roles);
      if (!roles.length) return fail(res, 400, '请至少选择一个权限组');
      if (u.roles.includes('admin') && !roles.includes('admin') && adminCount() <= 1) return fail(res, 400, '至少要保留一位在用的管理层');
      u.roles = roles;
    }
    /* 权限模式：useGroupPerms=true → 跟随权限组（改一次组，全组生效）；否则落为个人单独设置 */
    if (b.useGroupPerms) { u.custom = false; u.perms = null; }
    else if (b.perms !== undefined) { u.perms = normPerms(b.perms, u.roles); u.custom = true; }
    if (b.active !== undefined) {
      if (b.active === false && u.id === me.id) return fail(res, 400, '不能停用自己的账号');
      if (b.active === false && u.roles.includes('admin') && adminCount() <= 1) return fail(res, 400, '至少要保留一位在用的管理层');
      u.active = !!b.active;
      if (!u.active) for (const k of Object.keys(db.sessions)) if (db.sessions[k].userId === u.id) delete db.sessions[k];
    }
    saveDB();
    return ok(res, { user: pubUser(u) });
  }

  if (pathname === '/api/staff/password' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '无权重置密码');
    const b = await readJSON(req);
    const u = db.users.find((x) => x.id === b.id);
    if (!u) return fail(res, 404, '员工不存在');
    const np = String(b.newP || '');
    if (np.length < 6) return fail(res, 400, '新密码至少 6 位');
    u.pwd = sha(np);
    for (const k of Object.keys(db.sessions)) if (db.sessions[k].userId === u.id) delete db.sessions[k];
    saveDB(); return ok(res);
  }

  if (pathname === '/api/staff/delete' && method === 'POST') {
    if (!canStaff()) return fail(res, 403, '无权删除员工');
    const b = await readJSON(req);
    const i = db.users.findIndex((x) => x.id === b.id);
    if (i < 0) return fail(res, 404, '员工不存在');
    const u = db.users[i];
    if (u.id === me.id) return fail(res, 400, '不能删除自己的账号');
    if (u.roles.includes('admin') && adminCount() <= 1) return fail(res, 400, '至少要保留一位在用的管理层');
    if (usedBy(u)) return fail(res, 400, '该员工已有关联业务数据，无法删除；请改为「停用」以保留历史记录');
    db.users.splice(i, 1);
    for (const k of Object.keys(db.sessions)) if (db.sessions[k].userId === u.id) delete db.sessions[k];
    saveDB(); return ok(res);
  }

  /* ---------------- 大模型：语音转写文本 → 结构化字段 ---------------- */
  const DEFAULT_PARSE_FIELDS = [
    { key: 'date', name: '日期', hint: '格式 YYYY-MM-DD；没提到就用今天' },
    { key: 'stage', name: '节点', hint: '生产/安装节点名称' },
    { key: 'qty', name: '数量', hint: '纯整数' },
    { key: 'remark', name: '备注', hint: '整理成一句通顺的说明' },
  ];
  async function llmChat(messages, jsonMode) {
    const cfg = db.config || {};
    if (!cfg.llm_enabled) throw new Error('未启用大模型，请先在「我的 → 系统设置」中开启');
    if (!cfg.llm_base_url || !cfg.llm_api_key || !cfg.llm_model) throw new Error('大模型配置不完整（需要接口地址、API Key、模型名）');
    const url = String(cfg.llm_base_url).replace(/\/+$/, '') + '/chat/completions';
    const body = { model: cfg.llm_model, messages, temperature: 0.1 };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res, text;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm_api_key },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      text = await res.text();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '大模型请求超时（30 秒）' : ('无法连接大模型：' + e.message));
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error('大模型返回 ' + res.status + '：' + String(text).slice(0, 200));
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('大模型返回内容无法解析'); }
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    return (msg && msg.content) || '';
  }
  if (pathname === '/api/llm/parse' && method === 'POST') {
    const b = await readJSON(req);
    const text = String(b.text || '').trim();
    if (!text) return fail(res, 400, '没有可解析的内容');
    const fields = (Array.isArray(b.fields) && b.fields.length) ? b.fields : DEFAULT_PARSE_FIELDS;
    const dict = Array.isArray(b.dict) ? b.dict.filter(Boolean) : [];
    const sys = '你是家具制造企业「项目管理系统」里的信息抽取助手。用户会用语音口述现场情况，'
      + '你要把口语化的内容抽取成结构化字段。要求：只输出一个 JSON 对象，不要输出任何解释文字；'
      + '没提到的字段不要出现在结果里；日期一律换算成 YYYY-MM-DD；数字只保留数值本身。';
    const usr = '今天是 ' + today() + '。\n\n可用字段：\n'
      + fields.map((f) => '- ' + f.key + '（' + (f.name || f.key) + '）' + (f.hint ? '：' + f.hint : '')).join('\n')
      + (dict.length ? '\n\n可对照的固定选项（尽量从中选择）：\n' + dict.join('、') : '')
      + '\n\n请从下面这段语音转写文字中抽取信息：\n"""\n' + text + '\n"""';
    try {
      const out = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: usr }], true);
      let data = {};
      const m = String(out).match(/\{[\s\S]*\}/);
      if (m) { try { data = JSON.parse(m[0]); } catch (e) { data = {}; } }
      return ok(res, { data, raw: String(out).slice(0, 2000) });
    } catch (e) { return fail(res, 400, e.message); }
  }
  if (pathname === '/api/llm/test' && method === 'POST') {
    if (!isA(me)) return fail(res, 403, '只有管理层可以测试大模型');
    try {
      const out = await llmChat([{ role: 'user', content: '只回复两个字：可用' }], false);
      return ok(res, { reply: String(out).trim().slice(0, 60) });
    } catch (e) { return fail(res, 400, e.message); }
  }

  return fail(res, 404, '接口不存在: ' + method + ' ' + pathname);
}

/* ---------------- 统计 ---------------- */
function computeStats(u) {
  const ids = visibleProjectIds(u);
  const vis = (pid) => ids === null || ids.has(pid);
  const projects = db.projects.filter((p) => vis(p.id));
  const design = db.design.filter((t) => vis(t.project_id));
  const production = db.production.filter((t) => vis(t.project_id));
  const installations = db.installations.filter((t) => vis(t.project_id));
  const aftersales = db.aftersales.filter((t) => vis(t.project_id));
  const approvals = db.approvals.filter((a) => vis(a.project_id));
  const month = today().slice(0, 7);

  const statusDist = {}; for (const s of PROJECT_STATUS) statusDist[s] = 0;
  for (const p of projects) statusDist[p.project_status] = (statusDist[p.project_status] || 0) + 1;
  const designDist = {}; for (const s of DESIGN_STAGES) designDist[s] = 0;
  for (const t of design) designDist[t.status] = (designDist[t.status] || 0) + 1;
  const prodDist = {}; for (const s of PROD_STAGES) prodDist[s] = 0;
  for (const t of production) prodDist[t.status] = (prodDist[t.status] || 0) + 1;

  const completed = projects.filter((p) => p.project_status === '已完成' && p.actual_delivery_date);
  const onTime = completed.filter((p) => p.expected_delivery_date && p.actual_delivery_date <= p.expected_delivery_date);
  const rated = installations.filter((t) => t.customer_rating > 0);
  const asRated = aftersales.filter((t) => t.customer_rating > 0);
  const exceptions = projects.filter((p) => p.exception_status !== '无异常');

  /* 在办工作量：按「岗位组」统计（生产组含木工/油漆/发货三个岗位） */
  const workload = {};
  const WL_GROUPS = [
    ['sales', 'sales'],
    ['designer', 'designer'],
    ['production', 'prod'],
    ['install', 'install'],
  ];
  for (const [group, cap] of WL_GROUPS) {
    workload[group] = db.users.filter((x) => x.active !== false && hasCap(x, cap)).map((x) => {
      let active = 0;
      if (group === 'sales') active = projects.filter((p) => p.sales_id === x.id && !['已完成', '已终止'].includes(p.project_status)).length;
      if (group === 'designer') active = design.filter((t) => t.designer_id === x.id && t.status !== '设计完成' && !t.terminated).length;
      if (group === 'production') active = production.filter((t) => (t.production_manager_id === x.id || (t.production_manager_ids || []).includes(x.id)) && t.status !== '已终止' && !(t.status === '准备出货' && t.ship_done_at)).length;
      if (group === 'install') active = installations.filter((t) => t.manager_id === x.id && t.status !== '安装完成' && !t.terminated).length
        + aftersales.filter((t) => t.assignee_id === x.id && !['已结束', '已终止'].includes(t.status)).length;
      return { name: x.name, active };
    });
  }

  // 我的待办
  const todos = [];
  for (const t of design) {
    const p = db.projects.find((x) => x.id === t.project_id); if (!p) continue;
    if (!t.terminated && !isTerminated(p) && designAllowed(u, p, t.status) && t.status !== '设计完成') todos.push({ type: 'design', id: t.id, project_id: p.id, text: p.project_no + ' ' + p.customer_name + '：' + t.status });
  }
  if (isProd(u) || isA(u) || (u.roles || []).includes('external')) {
    for (const t of production) {
      const p = db.projects.find((x) => x.id === t.project_id); if (!p || isTerminated(p)) continue;
      if (t.batch_flow) continue;   // 分批生产由批次页面驱动
      if (['出货申请', '准备出货', '已终止'].includes(t.status) || !prodAllowed(u, p, t.status)) continue;
      todos.push({ type: 'production', id: t.id, project_id: t.project_id, text: p.project_no + ' ' + p.customer_name + '：' + t.status });
    }
    for (const t of production) {
      const p = db.projects.find((x) => x.id === t.project_id);
      if (!p || isTerminated(p) || t.batch_flow || t.paused_by || t.purchase_completed_at) continue;
      if (!['DZ', 'WJ'].includes(p.project_type) || !['原件打磨', '油漆喷刷', '组装打包'].includes(t.status)) continue;
      if (!prodAllowed(u, p, '外购入库')) continue;
      if (approvals.some((a) => a.project_id === p.id && !['待发起', '已驳回', '已终止'].includes(a.status))) continue;
      todos.push({ type: 'purchase', id: t.id, project_id: p.id, text: p.project_no + ' ' + p.customer_name + '：外购入库' });
    }
    for (const a of approvals) { if (a.status === '待出货') { const p = db.projects.find((x) => x.id === a.project_id); if (!p || !prodAllowed(u, p, '准备出货')) continue; todos.push({ type: 'ship', id: a.id, project_id: a.project_id, text: p.project_no + ' ' + p.customer_name + '：准备出货（' + (a.batch_no ? '第' + a.batch_no + '批出货' : '单批次') + '）' }); } }
  }
  if (hasCap(u, 'sales') || isA(u)) {
    for (const a of approvals) {
      const p = db.projects.find((x) => x.id === a.project_id);
      const mine = isA(u) || p.sales_id === u.id;
      if (mine && ['待发起', '待填出货信息', '已驳回'].includes(a.status)) todos.push({ type: 'ship', id: a.id, project_id: a.project_id, text: p.project_no + ' ' + p.customer_name + '：出货审批 - ' + a.status + (a.batch_no ? '（第' + a.batch_no + '批出货）' : '') });
    }
    for (const t of installations) { const p = db.projects.find((x) => x.id === t.project_id); const mine = isA(u) || p.sales_id === u.id; if (mine && t.status === '客户确认') todos.push({ type: 'install', id: t.id, project_id: t.project_id, text: p.project_no + ' ' + p.customer_name + '：' + t.status }); }
  }
  for (const a of approvals) {
    if (a.status !== '管理层审批' || a.paused_by) continue;
    const p = db.projects.find((x) => x.id === a.project_id);
    if (!p || isTerminated(p)) continue;
    const financePending = a.finance_paid !== '已收齐';
    if ((financePending && canConfirmShipFinance(u)) || (!financePending && canApproveShipConditions(u))) {
      todos.push({ type: 'ship', id: a.id, project_id: a.project_id, text: p.project_no + ' ' + p.customer_name + '：' + (financePending ? '财务确认尾款' : '演示审批主管审批发货条件') + (a.batch_no ? '（第' + a.batch_no + '批出货）' : '') });
    }
  }
  if (hasCap(u, 'install') || isA(u)) {
    for (const t of installations) { if (['安装确认', '正在安装'].includes(t.status)) { const p = db.projects.find((x) => x.id === t.project_id); todos.push({ type: 'install', id: t.id, project_id: t.project_id, text: p.project_no + ' ' + p.customer_name + '：' + t.status }); } }
    for (const t of aftersales) { if (['待派工', '执行中', '已完成'].includes(t.status)) todos.push({ type: 'aftersales', id: t.id, project_id: t.project_id, text: t.ticket_no + ' ' + t.customer_name + '：' + t.status }); }
  }

  return {
    projTotal: projects.length,
    inProgress: projects.filter((p) => ['设计中', '生产中', '分批生产/出货中', '安装中', '异常'].includes(p.project_status)).length,
    todoCount: todos.length,
    exceptionCount: exceptions.length,
    monthDeliveries: projects.filter((p) => p.actual_delivery_date && p.actual_delivery_date.slice(0, 7) === month).length,
    statusDist, designDist, prodDist,
    onTimeRate: completed.length ? Math.round((onTime.length / completed.length) * 100) : null,
    avgInstallRating: rated.length ? +(rated.reduce((s, t) => s + t.customer_rating, 0) / rated.length).toFixed(1) : null,
    avgAfterRating: asRated.length ? +(asRated.reduce((s, t) => s + t.customer_rating, 0) / asRated.length).toFixed(1) : null,
    contractTotal: projects.filter((p) => !['未启动', '已终止'].includes(p.project_status)).reduce((s, p) => s + (Number(p.contract_amount) || 0), 0),
    workload, todos,
  };
}

/* ---------------- 静态资源 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const fp = path.normalize(path.join(PUB, pathname));
  if (!fp.startsWith(PUB)) return fail(res, 403, '禁止访问');
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    // SPA 回退
    const ip = path.join(PUB, 'index.html');
    if (fs.existsSync(ip)) { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(fs.readFileSync(ip)); }
    return fail(res, 404, 'Not Found');
  }
  const ext = path.extname(fp).toLowerCase();
  /* sw.js 必须每次取最新，否则版本更新不生效 */
  const cc = pathname === '/sw.js' ? 'no-cache, no-store, must-revalidate' : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cc, 'Service-Worker-Allowed': '/' });
  res.end(fs.readFileSync(fp));
}

/* ---------------- 服务器 ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(u.pathname);
    if (pathname.startsWith('/api/') || pathname === '/healthz') STORE.assertAvailable();
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, u.searchParams);
    if (pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('请求处理错误:', e);
    try { fail(res, e.code === 'YGX_STORAGE_UNAVAILABLE' ? 503 : 500, e.code === 'YGX_STORAGE_UNAVAILABLE' ? e.message : '服务器内部错误: ' + e.message); } catch (e2) {}
  }
});

let port = PORT;
/* v2.1 修复：原实现递归 listen 时不移除 error 监听器，
   会出现「多个监听器同时存活 → 横幅重复打印 / 绑定多个端口」。
   改为「用 net 探测端口空闲后再 listen」，一次性、无残留。 */
const net = require('net');
function probeFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '0.0.0.0');
  });
}
async function listen(start) {
  let p = start;
  while (p < start + 20) {
    /* eslint-disable no-await-in-loop */
    const free = await probeFree(p);
    if (free) break;
    console.log('端口 ' + p + ' 被占用，尝试 ' + (p + 1) + ' ...');
    p++;
  }
  server.once('error', (e) => { console.error('启动失败:', e.message); process.exit(1); });
  server.listen(p, () => {
    port = p;
    console.log('=====================================');
    console.log('  忆古轩家居 · 项目管理系统 已启动');
    console.log('  本机访问:   http://localhost:' + p);
    console.log('  局域网访问: http://' + getLANIP() + ':' + p);
    console.log('  管理账号:   demo_owner / demo_approver / demo_sales_lead  初始密码 123456');
    console.log('  员工账号:   演示账号（见README与员工管理页）');
    console.log('  数据目录:   ' + DATA_DIR);
    console.log('=====================================');
  });
}
function getLANIP() {
  const os = require('os');
  const ifs = os.networkInterfaces();
  for (const k of Object.keys(ifs)) for (const i of ifs[k]) if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}
listen(port);
