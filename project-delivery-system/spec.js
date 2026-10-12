'use strict';
/* ============================================================
 * 忆古轩家居 · 流程规格总表（唯一事实源 · Single Source of Truth）
 * ------------------------------------------------------------
 * 内容：五类项目（成品/清仓 · 定制 · 板式 · 外接）的
 *       ① 设计 / 生产 / 安装阶段表与自动节点
 *       ② 每个节点的字段清单：字段名 · 类型 · 是否必填 · 操作岗位
 *       ③ 出货审批状态机
 * 依据：四川忆古轩_项目交付业务流程总图_v2.1_优化版.docx（2.3、2.4 节主流程表）
 * 用法：server.js 做后端校验并下发给前端；public/js 用它渲染表单。
 *       改流程 = 只改这一个文件，前后端同时生效。
 * ============================================================ */

/* ---------- 字段构造器 ----------
 * f(key, label, type, required, extra)
 *   type  : text | textarea | date | number | money | select | file | user | users | checkbox | stars
 *   extra : { col, options, cap, multi, hint, default, when, full, readonly }
 *     col  : 落库到记录的原生列名；不填则写入 rec.custom[key]
 *     cap  : user/users 类型的候选能力标签（admin/sales/designer/prod/install）
 *     when : 条件必填 { key, eq } —— 同节点另一字段等于某值时才必填
 */
const F = (key, label, type, required, extra) => Object.assign({ key, label, type, required: !!required }, extra || {});

/* ---------- 一、阶段表 ---------- */
/* 设计阶段：设计完成 为系统自动节点，不对外操作 */
const D_DZ = ['设计师分配', '上门量尺', '初稿图纸制作', '初稿客户确认', '复尺确认', '客户最终确认', '开始拆单', '转接生产', '五金单转交', '设计完成'];
const D_BS = ['设计师分配', '复尺确认', '客户最终确认', '开始拆单', '转接生产', '设计完成'];
const D_WJ = ['客户最终确认', '转接生产', '设计完成'];   // 「转接生产」为系统自动节点
const D_SIMPLE = ['客户最终确认', '设计完成'];

/* 生产阶段：末节点「准备出货」完成后即项目完成（或转安装） */
const P_DZ = ['下单备料', '材料到场', '生产开料', '木工制作', '原件打磨', '油漆喷刷', '外购入库', '组装打包', '出货申请', '准备出货', '已终止'];
const P_SIMPLE = ['组装打包', '出货申请', '准备出货', '已终止'];

const INSTALL_STAGES = ['安装确认', '安装派单', '正在安装', '验收确认', '客户确认', '安装完成'];
const AFTER_STAGES = ['待派工', '待执行', '执行中', '已完成', '已完结', '已结束'];

/* ---------- 二、四类项目流程定义 ---------- */
const FLOW = {
  CP: {
    name: '成品', design: D_SIMPLE, prod: P_SIMPLE,
    autoProd: true,          // 新建项目即自动创建生产任务
    install: false,          // 不走安装
    hardware: false,         // 无五金单
    batch: false,            // 无分批生产
    autoStages: ['设计完成'],
  },
  QC: {
    name: '清仓', design: D_SIMPLE, prod: P_SIMPLE,
    autoProd: true, install: false, hardware: false, batch: false,
    autoStages: ['设计完成'],
  },
  DZ: {
    name: '定制', design: D_DZ, prod: P_DZ,
    autoProd: false, install: true, hardware: true, batch: true,
    autoStages: ['设计完成'],
  },
  BS: {
    name: '板式', design: D_BS, prod: P_DZ,
    autoProd: false, install: false, hardware: false, batch: false,
    /* 「转接生产」完成后系统自动完成设计阶段 */
    autoStages: ['设计完成'],
    /* 木工制作完成后自动跳过 原件打磨 / 油漆喷刷 */
    prodSkip: { '木工制作': ['原件打磨', '油漆喷刷', '外购入库'] },
  },
  WJ: {
    name: '外接', design: D_WJ, prod: P_DZ,
    autoProd: false, install: false, hardware: false, batch: false,
    /* 外接设计阶段只有「客户最终确认」节点，「转接生产」由系统自动完成 */
    autoStages: ['转接生产', '设计完成'],
  },
};

/* 出货审批状态机 */
const APPROVAL_STATUS = ['待发起', '管理层审批', '已驳回', '待填出货信息', '待出货', '已完成', '已终止'];
const SHIP_STEPS = ['销售提交出货申请', '管理层审批', '填写出货信息', '准备出货 / 实际发货'];

/* ---------- 三、节点字段总表 ---------- */
/* 生产项目里「生产是否异常」是全流程唯一一个报备字段：任一节点选了「是」，
   后续所有节点都能看到它以及之前填写的内容（见 server 的全局异常处理）。 */
const EXC_FIELDS = () => ([
  F('is_exception', '生产是否异常', 'select', true, { col: 'is_exception', options: ['否', '是'], hint: '全生产阶段唯一的异常报备开关，异常内容后续节点都能看到' }),
  F('exception_desc', '异常报备', 'textarea', false, { when: { key: 'is_exception', eq: '是' }, full: true, hint: '选择「是」时必须说明异常情况' }),
]);

const NODE_FIELDS = {
  /* ===== 项目总表 ===== */
  project: {
    '': [
      F('project_type', '项目类型', 'select', true, { col: 'project_type', options: ['CP', 'DZ', 'WJ', 'QC', 'BS'], optionLabels: { CP: '成品（CP）', DZ: '定制（DZ）', WJ: '外接（WJ）', QC: '清仓（QC）', BS: '板式（BS）' } }),
      F('customer_name', '客户姓名', 'text', true, { col: 'customer_name' }),
      F('customer_phone', '联系电话', 'text', true, { col: 'customer_phone' }),
      F('address', '楼盘/地址', 'text', true, { col: 'address', hint: '出货将按此地址配送，请务必准确' }),
      F('customer_type', '客户类型', 'select', true, { col: 'customer_type', options: ['B端', 'C端'] }),
      F('source_channel', '来源渠道', 'select', true, { col: 'source_channel', options: ['线上客资', '客户介绍', '自然到店', '合作商家', '其他渠道'] }),
      F('is_showroom', '是否样板间', 'checkbox', false, { col: 'is_showroom' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
  },

  /* ===== 设计任务 ===== */
  design: {
    /* 1. 设计师分配（销售） */
    '设计师分配': [
      F('designer_id', '设计师', 'user', true, { col: 'designer_id', cap: 'designer' }),
      F('assign_date', '分配时间', 'date', true, { col: 'assign_date' }),
      F('intent_deposit_date', '交意向金时间', 'date', true, { col: 'intent_deposit_date' }),
      F('design_owner', '设计负责人', 'text', false, { col: 'design_owner', default: '演示审批主管' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 2. 上门量尺（设计师） */
    '上门量尺': [
      F('measure_date', '初量尺时间', 'date', true, { col: 'measure_date' }),
      F('measure_person', '初量尺人员', 'users', true, { col: 'measure_person', excludeNames: ['演示老板'], hint: '可选择多位人员' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 3. 初稿图纸制作（设计师） */
    '初稿图纸制作': [
      F('draft_drawings', '初稿最终图纸', 'file', true, { col: 'draft_drawings', full: true }),
      F('draft_complete_date', '初稿完成时间', 'date', true, { col: 'draft_complete_date' }),
      F('drawing_version', '图纸版本', 'select', false, { col: 'drawing_version', options: ['第一版', '第二版', '第三版', '第四版', '第五版'], hint: '改了几版才到最终版' }),
    ],
    /* 4. 初稿客户确认（销售） */
    '初稿客户确认': [
      F('initial_quotation', '初量尺报价表', 'file', true, { col: 'initial_quotation', full: true, hint: '可上传照片或文件' }),
      F('customer_confirm_status', '客户确认状态', 'select', true, { col: 'customer_confirm_status', options: ['正在确认', '方案确认', '修改图纸'], hint: '选「修改图纸」自动退回上一节点' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 5. 复尺确认（设计师） */
    '复尺确认': [
      F('remeasure_date', '复尺时间', 'date', true, { col: 'remeasure_date' }),
      F('final_drawing_date', '最终图纸完成时间', 'date', true, { col: 'final_drawing_date' }),
      F('final_drawings', '最终图纸文件', 'file', true, { col: 'final_drawings', full: true }),
      F('splitter_id', '拆单人员', 'user', true, { col: 'splitter_id', cap: 'designer' }),
      F('drawing_version_remeasure', '图纸版本', 'select', false, { col: 'drawing_version_remeasure', options: ['第一版', '第二版', '第三版', '第四版', '第五版'], hint: '改了几版才到最终版' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 6. 客户最终确认（销售） */
    '客户最终确认': [
      F('quotation', '最终报价表', 'file', true, { col: 'quotation', full: true }),
      F('contract_amount', '合同金额（元）', 'money', true, { col: 'contract_amount' }),
      F('expected_delivery_date', '预计交付日期', 'date', true, { col: 'expected_delivery_date' }),
      F('customer_confirm_status', '客户确认状态', 'select', true, { col: 'customer_confirm_status', options: ['正在确认', '方案确认', '修改图纸'], hint: '选「修改图纸」自动退回上一节点' }),
      F('contract', '正式合同', 'file', false, { col: 'contract', full: true }),
      F('customer_feedback', '客户反馈', 'textarea', false, { col: 'customer_feedback', full: true }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 7. 开始拆单（设计师） */
    '开始拆单': [
      F('splitter_start_date', '拆单开始时间', 'date', true, { col: 'splitter_start_date' }),
      F('split_status', '拆单状态', 'select', true, { col: 'split_status', options: ['未拆单', '已完成', '拆单中'] }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 8. 转接生产（设计师） */
    '转接生产': [
      F('split_status', '拆单状态', 'select', true, { col: 'split_status', options: ['未拆单', '已完成', '拆单中'] }),
      F('splitter_transfer_date', '拆单转接时间', 'date', true, { col: 'splitter_transfer_date', hint: '完成后自动创建生产任务，项目转「生产中」' }),
      F('split_drawings', '拆单完成图纸', 'file', true, { col: 'split_drawings', full: true }),
      F('production_manager_ids', '生产负责人', 'users', true, { col: 'production_manager_ids', allowedNames: ['演示木工主管', '演示油漆主管', '演示外接负责人'], defaultName: '演示木工主管', hint: '默认演示木工主管，可多选' }),
      F('hardware_start_date', '五金单开始时间', 'date', false, { col: 'hardware_start_date', default: 'today' }),
      F('prod_drawing_receiver', '生产图纸接收人员', 'users', false, { col: 'prod_drawing_receiver', allowedNames: ['演示采购负责人', '演示油漆主管', '演示木工主管'], defaultNames: ['演示采购负责人', '演示油漆主管', '演示木工主管'] }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 9. 五金单转交（设计师） */
    '五金单转交': [
      F('hardware_transfer_date', '转交时间', 'date', true, { col: 'hardware_transfer_date' }),
      F('hardware_list', '五金单原件', 'file', true, { col: 'hardware_list', full: true }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
  },

  /* ===== 生产任务 ===== */
  production: {
    /* 12. 下单备料（木工·演示木工主管） */
    '下单备料': [
      F('material_order_status', '材料下单状态', 'select', true, { col: 'material_order_status', options: ['待开单', '已下单'] }),
      F('material_order_date', '材料下单时间', 'date', true, { col: 'material_order_date' }),
      F('production_manager_ids', '生产负责人', 'users', false, { col: 'production_manager_ids', readonly: true, hint: '与「转接生产」中的生产负责人一致' }),
      F('material_list', '材料单原件', 'file', false, { col: 'material_list', full: true }),
      F('split_drawings_ref', '拆单图纸', 'file', false, { col: 'split_drawings_ref', full: true, readonly: true, hint: '直接显示转接生产里的拆单图纸' }),
      F('design_feedback', '设计反馈', 'textarea', false, { full: true, hint: '默认汇总设计阶段全部备注' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 13. 材料到场（木工） */
    '材料到场': [
      F('wood_arrival_date', '木材到厂时间', 'date', true, { col: 'wood_arrival_date' }),
      F('board_arrival_date', '板材到厂时间', 'date', false, { col: 'board_arrival_date' }),
      F('material_arrival_status', '材料到场状态', 'select', true, { col: 'material_arrival_status', options: ['全部材料到场', '部分材料到场'] }),
      F('cutting_start_date', '开始开料时间', 'date', true, { col: 'cutting_start_date' }),
      ...EXC_FIELDS(),
      F('is_batch', '是否分批次制作', 'select', true, { col: 'is_batch', options: ['否', '是'], hint: '选「是」后项目转入【分批生产 / 出货中】' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 14. 生产开料（木工） */
    '生产开料': [
      F('cutting_complete_date', '开料完成时间', 'date', true, { col: 'cutting_complete_date' }),
      F('cutting_owner', '开料负责人', 'user', true, { col: 'cutting_owner', allowedNames: ['演示开料负责人'], defaultName: '演示开料负责人' }),
      ...EXC_FIELDS(),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 15. 木工制作（木工） */
    '木工制作': [
      F('woodwork_complete_date', '木工完成时间', 'date', true, { col: 'woodwork_complete_date' }),
      ...EXC_FIELDS(),
      F('woodwork_status', '木工制作状态', 'select', false, { col: 'woodwork_status', options: ['项目分配', '部件制作', '部件组装', '验收通过'] }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 16. 原件打磨（木工） */
    '原件打磨': [
      F('polishing_complete_date', '打磨完成时间', 'date', true, { col: 'polishing_complete_date' }),
      ...EXC_FIELDS(),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 17. 油漆喷刷（油漆·演示油漆主管） */
    '油漆喷刷': [
      F('painting_complete_date', '油漆完成时间', 'date', true, { col: 'painting_complete_date' }),
      ...EXC_FIELDS(),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 18. 外购入库（五金采购·演示采购负责人） */
    '外购入库': [
      F('purchase_order_status', '外购下单状态', 'select', true, { col: 'purchase_order_status', options: ['未下单', '不需要', '已下单', '已入库'] }),
      F('purchase_arrival_date', '外购入库时间', 'date', false, { col: 'purchase_arrival_date', when: { key: 'purchase_order_status', eq: '已入库' } }),
      F('purchase_owner', '外购下单人员', 'user', false, { col: 'purchase_owner', allowedNames: ['演示采购负责人'], defaultName: '演示采购负责人' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 19. 组装打包（油漆） */
    '组装打包': [
      F('assembly_complete_date', '组装完成时间', 'date', true, { col: 'assembly_complete_date' }),
      F('packaging_complete_date', '包装完成时间', 'date', true, { col: 'packaging_complete_date' }),
      ...EXC_FIELDS(),
      F('warehouse_owner', '库管负责人', 'user', false, { col: 'warehouse_owner', allowedNames: ['演示发货负责人'], defaultName: '演示发货负责人' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
  },

  /* ===== 出货审批（PWA 内节点 20/22/23） ===== */
  ship: {
    /* 20. 销售在系统里一键提交出货申请 */
    'submit': [
      F('ship_doc', '出货单', 'file', true, { col: 'ship_doc', full: true, hint: '可上传照片或文件' }),
      F('ship_customer_name', '本次出货客户姓名', 'text', true, { col: 'ship_customer_name' }),
      F('ship_customer_phone', '本次出货客户电话', 'text', true, { col: 'ship_customer_phone' }),
      F('ship_address', '本次出货详细地址', 'text', true, { col: 'ship_address', full: true }),
      F('ship_project_no', '本次出货项目编号', 'text', true, { col: 'ship_project_no' }),
      F('address_verified', '已核对客户详细地址', 'checkbox', true, { col: 'address_verified' }),
      F('phone_verified', '已核对客户电话', 'checkbox', true, { col: 'phone_verified' }),
      F('name_verified', '已核对客户姓名', 'checkbox', true, { col: 'name_verified' }),
      F('no_verified', '已核对项目编号', 'checkbox', true, { col: 'no_verified' }),
      F('is_multi_batch', '是否多批次出货', 'select', false, { col: 'is_multi_batch', options: ['否', '是'] }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 21. 财务核对与管理层审批（飞书接入前的隔离演示） */
    'finance_confirm': [
      F('finance_paid', '财务确认尾款已收', 'select', true, { options: ['已收齐', '未收齐'] }),
      F('note', '财务备注', 'textarea', false, { full: true }),
    ],
    'approve': [
      F('ship_condition_ok', '发货条件（货物是否完工）', 'select', true, { options: ['达到发货条件', '未达到'] }),
      F('note', '审批意见', 'textarea', false, { full: true }),
    ],
    /* 22. 出货申请（审批通过后销售填写） */
    'confirm': [
      F('agreed_ship_date', '约定发货时间', 'date', true, { col: 'agreed_ship_date' }),
      F('dispatch_install', '是否分派安装', 'select', true, { col: 'dispatch_install', options: ['否', '是'], default: '否', hint: '选「是」登记安装意向' }),
      F('customer_confirm_status', '客户确认状态', 'select', true, { col: 'customer_confirm_status', options: ['已确认', '协商中', '待确认'], hint: '必须「已确认」且填写约定发货时间，才自动进入待出货' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 23. 准备出货（发货负责人·演示发货负责人） */
    'prepare': [
      F('actual_ship_date', '实际发货日期', 'date', true, { col: 'actual_ship_date' }),
      F('ship_status', '出货状态', 'select', true, { col: 'ship_status', options: ['待出货', '装车中', '已出货', '出货异常'] }),
      F('ship_remark', '发货备注', 'textarea', false, { col: 'ship_remark', full: true }),
    ],
  },

  /* ===== 安装任务 ===== */
  install: {
    /* 24. 安装确认（安装负责人） */
    '安装确认': [
      F('install_address', '安装地址', 'text', true, { col: 'install_address', full: true }),
      F('confirm_install_date', '确认安装时间', 'date', true, { col: 'confirm_install_date' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 25. 安装派单（安装负责人） */
    '安装派单': [
      F('dispatch_date', '派单时间', 'date', true, { col: 'dispatch_date' }),
      F('manager_id', '安装负责人', 'user', true, { col: 'manager_id', cap: 'install' }),
      F('installer_name', '安装人员', 'text', true, { col: 'installer_name' }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 26. 正在安装（安装人员） */
    '正在安装': [
      F('start_install_date', '开始安装时间', 'date', true, { col: 'start_install_date' }),
      F('install_exception', '安装是否异常', 'select', true, { col: 'install_exception', options: ['否', '是'] }),
      F('install_exception_desc', '异常说明', 'textarea', false, { col: 'exception_desc', when: { key: 'install_exception', eq: '是' }, full: true }),
      F('exception_file', '异常证明', 'file', false, { col: 'exception_file', full: true }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 27. 验收确认（安装负责人） */
    '验收确认': [
      F('accept_result', '验收结果', 'select', true, { col: 'accept_result', options: ['合格', '不合格'] }),
      F('accept_date', '验收时间', 'date', true, { col: 'accept_date' }),
      F('rectification_desc', '整改说明', 'textarea', false, { col: 'rectification_desc', when: { key: 'accept_result', eq: '不合格' }, full: true }),
      F('remark', '备注', 'textarea', false, { col: 'remark', full: true }),
    ],
    /* 28. 客户确认（负责销售） */
    '客户确认': [
      F('customer_rating', '客户评价', 'stars', true, { col: 'customer_rating' }),
      F('customer_confirm_status', '客户确认状态', 'select', true, { col: 'customer_confirm_status', options: ['已确认', '有异议'] }),
      F('actual_delivery_date', '实际交付日期', 'date', true, { col: 'actual_delivery_date' }),
      F('customer_feedback', '客户反馈', 'textarea', false, { col: 'feedback', full: true }),
      F('customer_confirm_file', '客户确认文件', 'file', false, { col: 'customer_confirm_file', full: true }),
    ],
  },
};

/* ---------- 四、操作岗位（能力标签）总表 ---------- */
/* 节点 → 允许操作的能力。'sales' 还要额外满足「是本项目的负责销售」 */
const NODE_ACTORS = {
  design: {
    '设计师分配': ['sales'],
    '上门量尺': ['designer'],
    '初稿图纸制作': ['designer'],
    '初稿客户确认': ['sales'],
    '复尺确认': ['designer'],
    '客户最终确认': ['sales'],
    '开始拆单': ['designer'],
    '转接生产': ['designer'],
    '五金单转交': ['designer'],
  },
  production: {
    /* 定制：下单备料→原件打磨 归木工；油漆喷刷/组装打包 归油漆；外购入库 归五金采购 */
    '下单备料': ['prod'], '材料到场': ['prod'], '生产开料': ['prod'], '木工制作': ['prod'],
    '原件打磨': ['prod'], '油漆喷刷': ['prod'], '外购入库': ['prod'], '组装打包': ['prod'],
  },
  install: {
    '安装确认': ['install'],
    '安装派单': ['install'],
    '正在安装': ['install'],
    '验收确认': ['install'],
    '客户确认': ['sales'],
  },
  /* 出货申请 / 出货确认 归销售；准备出货 归生产（发货组） */
  ship: { submit: ['sales'], confirm: ['sales'], prepare: ['prod'] },
};

/* ---------- 五、默认执行人（用于提示与默认值） ---------- */
const DEFAULT_OWNERS = {
  设计负责人: '演示审批主管',
  生产负责人: '演示木工主管',
  油漆负责人: '演示油漆主管',
  五金采购: '演示采购负责人',
  发货负责人: '演示发货负责人',
  开料负责人: '演示开料负责人',
  安装负责人: '演示审批主管',
};

/* ---------- 六、便捷查询 ---------- */
const flowOf = (type) => FLOW[type] || FLOW.DZ;
const designStagesFor = (type) => flowOf(type).design;
const prodStagesFor = (type) => flowOf(type).prod;
const fieldsFor = (scope, stage) => ((NODE_FIELDS[scope] || {})[stage] || []);
const allFieldsFor = (scope) => {
  const out = []; const seen = new Set();
  const byStage = NODE_FIELDS[scope] || {};
  for (const st of Object.keys(byStage)) for (const f of byStage[st]) if (!seen.has(f.key)) { seen.add(f.key); out.push(f); }
  return out;
};
/* 必填字段（含条件必填） */
function requiredFields(scope, stage, data) {
  return fieldsFor(scope, stage).filter((f) => {
    if (f.when) return String((data || {})[f.when.key]) === String(f.when.eq);
    return f.required;
  });
}

module.exports = {
  FLOW, NODE_FIELDS, NODE_ACTORS, DEFAULT_OWNERS, EXC_FIELDS,
  APPROVAL_STATUS, SHIP_STEPS, INSTALL_STAGES, AFTER_STAGES,
  designStagesFor, prodStagesFor, flowOf, fieldsFor, allFieldsFor, requiredFields,
};
