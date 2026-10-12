'use strict';
/* ============================================================
 * 飞书审批适配层（可插拔）
 * ------------------------------------------------------------
 * 设计口径（见《四类项目完整流程图》出货审批搭建方案）：
 *   · 出货审批**不在 PWA 内自建审批逻辑**；PWA 只负责按当前项目 + 本次出货批次
 *     自动生成审批参数，由服务端调用飞书审批能力创建既有《出货审批》实例。
 *   · 项目编号 / 客户信息 / 关联生产批次 / 本次出货内容 / 出货方式 等
 *     凡能从系统取到的字段一律自动带入，不允许销售重复填写。
 *   · 审批仍在飞书处理；系统通过订阅或轮询把审批状态 / 时间 / 意见 / 实例 ID 回写。
 *
 * 当前实现：本地适配器（mock）
 *   - 未配置 feishu_app_id / feishu_app_secret / approval_code 时，全部走本地模式：
 *     生成 MOCK 实例号、把飞书群通知写进系统日志，流程完全可跑通、可演示、可回归。
 *   - 配好凭据后，把 createShipApproval / syncApproval / notifyShipGroup 三个函数
 *     换成真实 HTTP 调用即可，上层业务代码零改动。
 *
 * ⚠️ 上线前：必须先在隔离测试环境验证现有飞书《出货审批》模板是否支持
 *    API 创建、各字段 ID 映射、申请人身份、附件、审批链与事件回调，
 *    不得直接在生产环境测试。
 * ============================================================ */

let DB = null;                 // 由 server.js 注入，用于读配置与写日志
const setDB = (d) => { DB = d; };
const cfg = () => (DB && DB.config) || {};
const configured = () => !!(cfg().feishu_app_id && cfg().feishu_app_secret && cfg().approval_code);
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

/* ============================================================
 * 一、员工身份登录（OAuth）
 * ------------------------------------------------------------
 * 正式部署形态下，员工通过飞书身份登录，不再使用本地账号密码。
 * 本层只负责「拿身份」，不负责「建会话」——会话仍由 server.js 管理。
 *
 * 接入前提（在飞书开放平台完成）：
 *   · 创建企业自建应用，拿到 app_id / app_secret
 *   · 申请权限：获取用户基本信息、获取用户 user_id / open_id
 *   · 登记重定向 URL，必须与下方 redirectUri() 完全一致
 * ============================================================ */

/* 登录能力是否可用（与「出货审批」的 configured() 相互独立） */
const loginEnabled = () => !!(cfg().feishu_app_id && cfg().feishu_app_secret);

/* 对外访问根地址：正式部署须配置 YGX_BASE_URL，否则回调地址不可达 */
const baseUrl = () => String(process.env.YGX_BASE_URL || '').replace(/\/+$/, '');

/* 登录回调地址（需与飞书后台登记的一致） */
const redirectUri = () => cfg().feishu_login_redirect || (baseUrl() + '/api/auth/feishu/callback');

/* 生成授权跳转地址 —— server.js 收到 /api/auth/feishu/start 时调用 */
function buildAuthUrl(state) {
  const q = new URLSearchParams({
    app_id: cfg().feishu_app_id || '',
    redirect_uri: redirectUri(),
    state: state || '',
  });
  /* === 接入点：飞书网页授权登录地址 ===
     正式接入时替换为开放平台文档给出的授权页地址。 */
  return 'https://open.feishu.cn/open-apis/authen/v1/authorize?' + q.toString();
}

/* 用授权码换取员工身份 —— 返回 { ok, user|err }
   user: { open_id, union_id, user_id, name, phone, email, avatar } */
async function exchangeCode(code) {
  if (!loginEnabled()) return { ok: false, err: '飞书登录未配置' };
  if (!code) return { ok: false, err: '缺少授权码' };

  /* === 接入点：真实接入分两步 ===
     ① 取 app_access_token：
        POST https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal
        Body: { app_id, app_secret }
     ② 用 code 换用户信息：
        POST https://open.feishu.cn/open-apis/authen/v1/oidc/access_token
        Header: Authorization: Bearer <app_access_token>
        Body: { grant_type:'authorization_code', code }
     再从返回中取 open_id / user_id，并按需调
        GET /open-apis/contact/v3/users/:user_id  补姓名与手机号。

     本地/演示模式：不发起真实请求，交由 server.js 走本地账号登录。
     接入后此函数改为真实 HTTP 调用即可，server.js 的调用方式不变。 */
  return { ok: false, err: '飞书登录尚未接入（当前为本地演示模式）' };
}

/* 按姓名 / 手机号匹配本地员工账号
   匹配优先级：手机号 > 姓名。重名或匹配不到都视为失败，由调用方决定如何提示。 */
function matchUser(users, feishuUser) {
  if (!Array.isArray(users) || !feishuUser) return { ok: false, err: '数据不完整' };
  const phone = String(feishuUser.phone || '').replace(/\s|-/g, '');
  const name = String(feishuUser.name || '').trim();

  if (phone) {
    const byPhone = users.filter((u) => String(u.phone || '').replace(/\s|-/g, '') === phone);
    if (byPhone.length === 1) return { ok: true, user: byPhone[0], by: 'phone' };
    if (byPhone.length > 1) return { ok: false, err: '该手机号对应多个账号，请联系管理员' };
  }
  if (name) {
    const byName = users.filter((u) => String(u.name || '').trim() === name);
    if (byName.length === 1) return { ok: true, user: byName[0], by: 'name' };
    if (byName.length > 1) return { ok: false, err: '系统内存在同名账号，请补全手机号后重试' };
  }
  return { ok: false, err: '未找到对应的员工账号，请联系管理员开通' };
}

/* 登录模式：feishu = 飞书身份登录；local = 本地账号密码（开发/离线演示） */
const authMode = () => (process.env.YGX_AUTH_MODE === 'feishu' ? 'feishu' : 'local');

/* 组装审批参数：能从系统拿到的字段全部自动带入 */
function buildPayload(project, approval, batchName) {
  const t = (DB.production || []).find((x) => x.id === approval.production_task_id);
  const d = (DB.design || []).find((x) => x.project_id === project.id);
  return {
    approval_code: cfg().approval_code || '',
    project_no: approval.ship_project_no || project.project_no,
    customer_name: approval.ship_customer_name || project.customer_name,
    customer_phone: approval.ship_customer_phone || project.customer_phone,
    customer_address: approval.ship_address || project.address,
    project_type: project.project_type,
    contract_amount: project.contract_amount,
    batch: batchName || '',
    ship_content: approval.ship_content || '',
    ship_doc: approval.ship_doc || '',
    ship_mode: approval.is_multi_batch ? '分批出货' : '全部出货',
    dispatch_install: approval.dispatch_install || '',
    agreed_ship_date: approval.agreed_ship_date || '',
    production_status: t ? t.status : '',
    design_drawings: d ? d.final_drawings : '',
  };
}

/* 创建《出货审批》实例 —— 返回值：{ instance_id, status, mock } */
function createShipApproval(project, approval, batchName) {
  const payload = buildPayload(project, approval, batchName);
  if (!configured()) {
    /* 本地模式：不打断流程，返回模拟实例，供前端展示与后续联调对照 */
    return { instance_id: 'MOCK-' + uid('AP'), status: '本地模拟-待审批', mock: true, payload };
  }
  /* === 接入点：真实飞书调用应替换此处 ===
     POST https://open.feishu.cn/open-apis/approval/v4/instances
     Header: Authorization: Bearer <tenant_access_token>
     Body: { approval_code, user_id, form: '<json string>' }
     成功后返回 data.instance_code。 */
  return { instance_id: '', status: '待审批', mock: false, payload };
}

/* 查询 / 订阅审批结果 —— 返回值：{ status, approved, comment } */
function syncApproval(instanceId) {
  if (!configured() || !instanceId) return { status: '', approved: null, comment: '' };
  /* === 接入点：GET /open-apis/approval/v4/instances/:instance_code === */
  return { status: '', approved: null, comment: '' };
}

/* 发货安排飞书群通知：本地模式写日志，接入后调用消息 API 发到指定群 */
function notifyShipGroup(ctx) {
  if (!DB) return;
  const { project: p, approval: a, batchName } = ctx || {};
  if (!p) return;
  const lines = [
    '【项目发货安排】',
    (p.customer_name || '') + '｜' + (p.address || ''),
    '项目编号：' + (p.project_no || ''),
    batchName ? '出货批次：' + batchName : '',
    '约定发货时间：' + (a.agreed_ship_date || '—'),
    '出货方式：' + (a.is_multi_batch ? '分批出货' : '全部出货'),
    '是否安排安装：' + (a.dispatch_install || '—'),
    a.remark ? '备注：' + a.remark : '',
    '请生产、仓库、出货及安装相关人员提前准备。',
  ].filter(Boolean);
  const text = lines.join('\n');
  DB.logs.push({ id: uid('l'), project_id: p.id, at: nowIso(), by: '系统', text: '【飞书群通知' + (configured() ? '' : '·本地模拟') + '】\n' + text });
  if (!configured()) return { mock: true, text };
  /* === 接入点：POST /open-apis/im/v1/messages?receive_id_type=chat_id === */
  return { mock: false, text };
}

// Future adapter input includes stable local IDs and a notification ID for delivery deduplication.
// The isolated version only prepares the contract; it never claims an external send succeeded.
function notifyDesignReminder({ notification, project, sender, recipient }) {
  return {
    status: 'not_connected', attempted: false,
    payload: {
      event_type: 'design.node.reminded', event_id: notification.id,
      recipient_local_user_id: recipient.id, sender_local_user_id: sender.id,
      project_id: project.id, project_no: project.project_no, address: project.address || '',
      task_id: notification.task_id, node: notification.stage,
      text: notification.text, link: notification.link, occurred_at: notification.at,
    },
  };
}

module.exports = {
  setDB, configured, createShipApproval, syncApproval, notifyShipGroup, buildPayload,
  notifyDesignReminder,
  /* 员工身份登录（OAuth） */
  loginEnabled, authMode, buildAuthUrl, exchangeCode, matchUser, redirectUri,
};
