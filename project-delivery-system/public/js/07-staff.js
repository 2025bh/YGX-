/* ============ 07 员工管理（员工 / 权限组（部门） / 权限） ============ */
'use strict';

/* 勾选 chip 样式切换 */
document.addEventListener('change', (e) => {
  const cb = e.target.closest && e.target.closest('.chk input[type=checkbox], .chk input[type=radio]');
  if (cb) {
    const box = cb.closest('.chk');
    if (cb.type === 'checkbox') box.classList.toggle('on', cb.checked);
    else {
      const grp = cb.closest('.chk-grid');
      if (grp) Array.from(grp.querySelectorAll('.chk')).forEach((x) => {
        const inp = x.querySelector('input'); x.classList.toggle('on', inp.checked);
      });
    }
    if (cb.dataset.perm === '1' && cb.closest('.perm-box')) cb.closest('.perm-box').dataset.touched = '1';
  }
});

function staffMeta() {
  const m = (S.db && S.db.meta) || {};
  return {
    groups: m.groups || [], roles: m.roles || {}, caps: m.caps || [],
    pages: m.pages || [], scopes: m.scopes || [], actions: m.actions || [],
  };
}
function staffById(id) { return (S.db.users || []).find((u) => u.id === id); }
/* 某个权限组里有几个人 */
function groupMembers(key) { return (S.db.users || []).filter((u) => (u.roles || []).indexOf(key) >= 0).length; }
/* 由若干权限组汇总出权限（与后端同口径），用于「跟随权限组」时的实时预览 */
function permsFromGroups(keys) {
  const m = staffMeta(); const map = {};
  m.groups.forEach((g) => { map[g.key] = g; });
  const pages = []; const actions = []; let scope = 'self';
  (keys || []).forEach((k) => {
    const g = map[k]; if (!g) return;
    (g.pages || []).forEach((p) => { if (pages.indexOf(p) < 0) pages.push(p); });
    (g.actions || []).forEach((a) => { if (actions.indexOf(a) < 0) actions.push(a); });
    if (g.scope === 'all') scope = 'all';
    else if (scope !== 'all' && g.scope !== 'self') scope = g.scope;
  });
  return { pages, scope, actions };
}

/* ---------- 页面 ---------- */
function viewStaff() {
  const users = (S.db.users || []).slice().sort((a, b) =>
    ((a.active === false ? 1 : 0) - (b.active === false ? 1 : 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
  const m = staffMeta();
  const groups = m.groups.slice().sort((a, b) =>
    (b.members - a.members) || ((a.builtin === b.builtin) ? 0 : (a.builtin ? -1 : 1)) || String(a.name).localeCompare(String(b.name), 'zh'));
  const active = users.filter((u) => u.active !== false).length;
  const noPhone = users.filter((u) => !u.phone).length;
  const inUse = groups.filter((g) => g.members > 0).length;

  let html = '<div class="page-head"><div><div class="t">员工管理</div>' +
    '<div class="sub">共 ' + users.length + ' 位员工 · 在用 ' + active + ' 位 · ' + groups.length + ' 个权限组 · <b>把权限配在组上，人加进组即可</b></div></div>' +
    '<button class="btn-hero" onclick="openStaffEditor()"><span class="plus">' + ico('plus', 20) + '</span>新增员工</button></div>';

  html += '<div class="stat-grid">' +
    '<div class="stat-card">' + icoBadge('users', 'var(--blue-l)', 'var(--blue)') + '<div><div class="v">' + users.length + '</div><div class="l">员工总数</div></div></div>' +
    '<div class="stat-card">' + icoBadge('userCheck', 'var(--green-l)', 'var(--green)') + '<div><div class="v">' + active + '</div><div class="l">在用账号</div></div></div>' +
    '<div class="stat-card">' + icoBadge('shield', 'var(--purple-l,#ede9fe)', '#7c3aed') + '<div><div class="v">' + groups.length + '</div><div class="l">权限组（' + inUse + ' 个已用人）</div></div></div>' +
    '<div class="stat-card clickable" onclick="filterNoPhone()">' + icoBadge('phone', (noPhone ? 'var(--red-l,#fee2e2)' : 'var(--gray-l,#eef2f7)'), (noPhone ? 'var(--red)' : 'var(--gray)')) + '<div><div class="v">' + noPhone + '</div><div class="l">待补手机号</div></div></div>' +
    '</div>';

  /* ---- 权限组（部门） ---- */
  html += '<div class="card"><h3>' + ico('shield', 17) + '权限组（部门）' +
    '<span class="more"><button class="btn sm primary" onclick="openGroupEditor()">' + ico('plus', 13) + ' 新增权限组</button></span></h3>' +
    '<div class="hint" style="margin:-4px 0 10px">把同一类人（如销售、设计、木工）放进一个组，权限只配一次；以后新人直接加进组，权限自动继承。改动组权限，全组成员即时生效。</div>' +
    groupTableHtml(groups) + '</div>';

  /* ---- 员工名单 ---- */
  html += '<div class="card"><h3>' + ico('users', 17) + '员工名单' +
    '<span class="more"><span class="hint-inline">' + ico('phone', 13) + ' 手机号填进「账号」后即可用手机号登录</span></span></h3>' +
    staffRowsHtml(users) + '</div>';

  /* ---- 能力说明 ---- */
  html += '<div class="card"><h3>' + ico('badge', 17) + '能力说明（决定「能不能做某个动作」，是权限组的底座）</h3>' +
    '<div class="table-wrap"><table class="table"><thead><tr><th>能力</th><th>说明</th><th>影响</th></tr></thead><tbody>' +
    m.caps.map((c) => {
      const n = groups.filter((g) => (g.caps || []).indexOf(c.key) >= 0).length;
      return '<tr><td><b>' + h(c.name) + '</b></td>' +
        '<td style="font-size:13px">' + h(c.desc || '') + '</td>' +
        '<td>' + (n ? '<span class="badge b-blue">' + n + ' 个组</span>' : '<span class="badge b-gray">未使用</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';

  /* ---- 表单字段设置入口（管理员自己加节点字段） ---- */
  const cfN = ((S.db && S.db.field_defs) || []).length;
  html += '<div class="card"><h3>' + ico('sliders', 17) + '表单字段设置' +
    '<span class="more"><button class="btn sm primary" onclick="nav(\'#/fields\')">' + ico('settings', 13) + ' 打开字段设置</button></span></h3>' +
    '<div class="hint" style="margin:-4px 0 0">当前已配置 <b>' + cfN + '</b> 个附加字段（项目总表 / 设计 / 生产 / 安装 / 售后）。' +
    '某个节点还要多填什么、哪些必须填，都可以自己加，不用改程序。' +
    (cfN ? '这些字段会出现在对应节点的填写框和项目详情页里。' : '') + '</div></div>';
  return html;
}
function filterNoPhone() {
  toast('这一列是「还没填手机号」的员工，补齐后他们才能用手机号登录', 'ok');
}

function staffRowsHtml(list) {
  if (!list.length) return emptyBox('还没有员工');
  return '<div class="table-wrap staff-table-wrap"><table class="table staff-table">' +
    '<colgroup><col style="width:88px"><col style="width:136px"><col style="width:104px"><col style="width:124px"><col style="width:128px">' +
    '<col style="width:218px"><col style="width:218px"><col style="width:90px"><col style="width:78px"><col style="width:196px"></colgroup><thead><tr>' +
    '<th>姓名</th><th>账号 / 手机号</th><th>所属权限组</th><th>职务</th><th>数据范围</th><th>可见页面</th><th>关键权限</th><th>页面缩放</th><th>状态</th><th>操作</th>' +
    '</tr></thead><tbody>' + list.map((u) => {
      const pm = u.perms || { pages: [], scope: 'self', actions: [] };
      const pgs = (pm.pages || []).map(pageLabel);
      const acts = (pm.actions || []).map(actionLabel);
      const off = u.active === false;
      return '<tr' + (off ? ' class="row-off"' : '') + '>' +
        '<td><b>' + h(u.name) + '</b>' + (u.custom ? ' <span class="badge b-amber">单独</span>' : '') + '</td>' +
        '<td class="num">' + h(u.username) + (u.phone
          ? '<div style="font-size:12px;color:var(--gray)">' + h(u.phone) + '</div>'
          : '<div style="font-size:12px;color:var(--red)">未填手机号</div>') + '</td>' +
        '<td>' + ((u.roles || []).length ? (u.roles || []).map((r) => '<span class="tag-role">' + h(roleLabel(r)) + '</span>').join('') : '<span style="color:var(--red)">未分组</span>') + '</td>' +
        '<td>' + h(u.title || '—') + '</td>' +
        '<td>' + h(scopeLabel(pm.scope)) + '</td>' +
        '<td class="perm-cell">' + (pgs.length ? h(pgs.join('、')) : '<span style="color:var(--red)">无</span>') + '</td>' +
        '<td class="perm-cell">' + (acts.length ? h(acts.join('、')) : '—') + '</td>' +
        '<td>' + (u.allow_zoom ? '允许' : '固定') + '</td>' +
        '<td>' + (off ? '<span class="badge b-gray">已停用</span>' : '<span class="badge b-green">在用</span>') + '</td>' +
        '<td class="ops">' +
          '<button class="btn sm" onclick="openStaffEditor(\'' + u.id + '\')">' + ico('edit', 13) + ' 编辑</button>' +
          '<button class="btn sm" title="重置密码" onclick="resetStaffPwd(\'' + u.id + '\')">' + ico('key', 13) + '</button>' +
          '<button class="btn sm" title="' + (off ? '启用' : '停用') + '" onclick="toggleStaff(\'' + u.id + '\')">' + ico('power', 13) + '</button>' +
          '<button class="btn sm danger" title="删除" onclick="deleteStaff(\'' + u.id + '\')">' + ico('trash', 13) + '</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function groupTableHtml(groups) {
  if (!groups.length) return emptyBox('还没有权限组');
  return '<div class="table-wrap"><table class="table"><thead><tr>' +
    '<th>权限组</th><th>说明</th><th>数据范围</th><th>可见页面</th><th>关键权限</th><th>能力</th><th>成员</th><th style="width:170px">操作</th>' +
    '</tr></thead><tbody>' + groups.map((g) => {
      const acts = (g.actions || []).map(actionLabel);
      return '<tr>' +
        '<td><b>' + h(g.name) + '</b>' + (g.builtin ? ' <span class="badge b-gray">内置</span>' : '') + '</td>' +
        '<td style="font-size:13px">' + h(g.desc || '—') + '</td>' +
        '<td>' + h(scopeLabel(g.scope)) + '</td>' +
        '<td class="perm-cell">' + ((g.pages || []).length ? h((g.pages || []).map(pageLabel).join('、')) : '—') + '</td>' +
        '<td class="perm-cell">' + (acts.length ? h(acts.join('、')) : '—') + '</td>' +
        '<td>' + ((g.caps || []).length ? (g.caps || []).map((c) => '<span class="tag-role">' + h(capLabel(c)) + '</span>').join('') : '—') + '</td>' +
        '<td class="num">' + g.members + ' 人</td>' +
        '<td class="ops">' +
          '<button class="btn sm" onclick="openGroupEditor(\'' + g.key + '\')">' + ico('edit', 13) + ' 编辑</button>' +
          '<button class="btn sm" onclick="viewGroupMembers(\'' + g.key + '\')">' + ico('users', 13) + ' 成员</button>' +
          (g.key === 'admin' ? '' : '<button class="btn sm danger" title="删除" onclick="deleteGroup(\'' + g.key + '\')">' + ico('trash', 13) + '</button>') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

/* 看组里都有谁 */
function viewGroupMembers(key) {
  const g = groupByKey(key); if (!g) return toast('权限组不存在', 'err');
  const list = (S.db.users || []).filter((u) => (u.roles || []).indexOf(key) >= 0);
  openModal('<div class="mhead"><div class="t">' + ico('users', 18) + h(g.name) + ' · 成员 ' + list.length + ' 人</div><button class="x">✕</button></div>' +
    '<div class="mbody">' + (list.length
      ? '<div class="table-wrap"><table class="table"><thead><tr><th>姓名</th><th>职务</th><th>状态</th></tr></thead><tbody>' +
        list.map((u) => '<tr><td><b>' + h(u.name) + '</b></td><td>' + h(u.title || '—') + '</td><td>' +
          (u.active === false ? '<span class="badge b-gray">已停用</span>' : '<span class="badge b-green">在用</span>') + '</td></tr>').join('') +
        '</tbody></table></div>'
      : emptyBox('这个组还没有成员')) + '</div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">关闭</button></div>', true);
}

/* ---------- 勾选组件 ---------- */
function chkGrid(name, items, selected, asRadio) {
  const sel = selected || [];
  return '<div class="chk-grid' + (asRadio ? ' radio' : '') + '">' + items.map((it) => {
    const on = sel.indexOf(it.key) >= 0;
    return '<label class="chk' + (on ? ' on' : '') + '"' + (it.title ? ' title="' + h(it.title) + '"' : '') + '>' +
      '<input type="' + (asRadio ? 'radio' : 'checkbox') + '" name="' + h(name) + '" value="' + h(it.key) + '"' +
      (on ? ' checked' : '') + (asRadio ? '' : ' data-perm="1"') + '>' +
      '<span>' + h(it.name) + '</span>' +
      (it.badge ? '<span class="chk-badge">' + h(it.badge) + '</span>' : '') + '</label>';
  }).join('') + '</div>';
}

/* ---------- 权限组：新增 / 编辑 ---------- */
function openGroupEditor(key) {
  const m = staffMeta();
  const isNew = !key;
  const g = isNew ? null : groupByKey(key);
  if (!isNew && !g) return toast('权限组不存在', 'err');
  const cur = g || { name: '', desc: '', scope: 'self', pages: [], actions: [], caps: [] };
  const isAdminGroup = !isNew && key === 'admin';

  /* 新建时可从现有组复制一套配置，省事 */
  const copyOpts = [{ v: '', t: '— 不复制，从空白开始 —' }].concat(
    m.groups.map((x) => ({ v: x.key, t: x.name + '（' + scopeLabel(x.scope) + '，' + (x.pages || []).length + ' 个页面）' })));

  const mask = openModal(
    '<div class="mhead"><div class="t">' + ico(isNew ? 'plus' : 'shield', 18) + (isNew ? '新增权限组' : '编辑权限组 · ' + h(cur.name)) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody">' +
      (isAdminGroup ? '<div class="mbody-note">' + ico('alert', 15) + ' 这是系统内置的「管理层」组，必须保留「管理层」能力和「全部数据」范围，否则可能把自己锁死。</div>' : '') +
      '<div class="sec-title">' + ico('badge', 16) + ' 基本信息</div>' +
      '<div class="form-grid">' +
        fld('权限组名称', inp('name', 'text', cur.name, 'placeholder="如：销售二组 / 招商部"'), 1) +
        fld('说明', inp('desc', 'text', cur.desc, 'placeholder="这个组是干什么的"'), 1) +
        (isNew ? fld('组标识（可留空自动生成）', inp('key', 'text', '', 'placeholder="英文或数字，如 sales2"'), 1) +
                 fld('从现有组复制配置', sel('copyfrom', copyOpts, ''), 1) : '') +
      '</div>' +

      '<div class="sec-title">' + ico('sliders', 16) + ' 这个组能看到什么</div>' +
      '<div class="perm-label">数据可见范围</div>' +
      chkGrid('g-scope', m.scopes, [cur.scope], true) +
      '<div class="perm-label">可访问页面</div>' +
      chkGrid('g-pages', m.pages, cur.pages) +
      '<div class="perm-label">关键动作权限</div>' +
      chkGrid('g-actions', m.actions, cur.actions) +

      '<div class="sec-title">' + ico('badge', 16) + ' 能力标签（决定业务上「能不能做」）</div>' +
      chkGrid('g-caps', m.caps, cur.caps) +
      '<div class="hint">能力标签是系统判定业务动作的依据：没勾「生产部」，该组的人即使能看到生产看板也不能改生产节点。新建自己的组时，请照抄对应部门的组合。</div>' +
    '</div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button>' +
    '<button class="btn primary" id="g-save">' + (isNew ? '创建权限组' : '保存修改') + '</button></div>', true);

  const fill = (pp) => {
    $$('input[name=g-pages]', mask).forEach((x) => { x.checked = (pp.pages || []).indexOf(x.value) >= 0; x.closest('.chk').classList.toggle('on', x.checked); });
    $$('input[name=g-actions]', mask).forEach((x) => { x.checked = (pp.actions || []).indexOf(x.value) >= 0; x.closest('.chk').classList.toggle('on', x.checked); });
    $$('input[name=g-caps]', mask).forEach((x) => { x.checked = (pp.caps || []).indexOf(x.value) >= 0; x.closest('.chk').classList.toggle('on', x.checked); });
    $$('input[name=g-scope]', mask).forEach((x) => { x.checked = x.value === pp.scope; x.closest('.chk').classList.toggle('on', x.checked); });
  };
  if (isNew) {
    const cpy = $('select[name=copyfrom]', mask);
    if (cpy) cpy.addEventListener('change', () => {
      const src = groupByKey(cpy.value); if (!src) return;
      $('input[name=name]', mask).value = src.name + '（副本）';
      $('input[name=desc]', mask).value = src.desc || '';
      fill(src);
      toast('已复制「' + src.name + '」的配置，可继续修改', 'ok');
    });
  }

  $('#g-save', mask).onclick = async () => {
    const btn = $('#g-save', mask);
    const body = {
      name: $('input[name=name]', mask).value.trim(),
      desc: $('input[name=desc]', mask).value.trim(),
      scope: ($$('input[name=g-scope]:checked', mask)[0] || {}).value || 'self',
      pages: $$('input[name=g-pages]:checked', mask).map((x) => x.value),
      actions: $$('input[name=g-actions]:checked', mask).map((x) => x.value),
      caps: $$('input[name=g-caps]:checked', mask).map((x) => x.value),
    };
    if (!body.name) return toast('请填写权限组名称', 'err');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      if (isNew) {
        const k = $('input[name=key]', mask).value.trim();
        if (k) body.key = k;
        await api('/api/groups/create', { method: 'POST', body });
      } else {
        body.key = key;
        await api('/api/groups/update', { method: 'POST', body });
      }
      closeModal(); await loadBootstrap(); render();
      toast(isNew ? '权限组「' + body.name + '」已创建' : '已保存，组内 ' + groupMembers(key) + ' 名成员即时生效', 'ok');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = isNew ? '创建权限组' : '保存修改'; }
  };
}

async function deleteGroup(key) {
  const g = groupByKey(key); if (!g) return;
  const n = groupMembers(key);
  if (n) return toast('「' + g.name + '」还有 ' + n + ' 名成员，请先把他们移到别的组再删除', 'err');
  if (!window.confirm('确定删除权限组「' + g.name + '」？\n\n这个组没有成员，删除不会影响任何人。')) return;
  try {
    await api('/api/groups/delete', { method: 'POST', body: { key } });
    await loadBootstrap(); render();
    toast('已删除权限组「' + g.name + '」', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 员工：新增 / 编辑 ---------- */
function openStaffEditor(id) {
  const m = staffMeta();
  const isNew = !id;
  const u = isNew ? null : staffById(id);
  if (!isNew && !u) return toast('员工不存在', 'err');
  const cur = u || { name: '', username: '', phone: '', title: '', roles: [], custom: false, perms: null };

  /* 权限组选项：带上成员数，方便判断往哪个组加人 */
  const groupItems = m.groups.slice().sort((a, b) => (b.members - a.members) || String(a.name).localeCompare(String(b.name), 'zh'))
    .map((g) => ({ key: g.key, name: g.name, badge: g.members + '人', title: g.desc || '' }));
  const followGroup = !cur.custom;

  const permPreview = permsFromGroups(cur.roles.length ? cur.roles : (isNew ? [] : []));

  const mask = openModal(
    '<div class="mhead"><div class="t">' + ico(isNew ? 'plus' : 'edit', 18) + (isNew ? '新增员工' : '编辑员工 · ' + h(cur.name)) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody">' +
      '<div class="sec-title">' + ico('user', 16) + ' 基本信息</div>' +
      '<div class="form-grid">' +
        fld('姓名', inp('name', 'text', cur.name, 'placeholder="如：演示油漆主管"'), 1) +
        fld('账号（登录用）', inp('username', 'text', cur.username, 'placeholder="建议直接填手机号"'), 1) +
        fld('手机号', inp('phone', 'tel', cur.phone, 'placeholder="11 位手机号，可用手机号登录"')) +
        fld('职务', inp('title', 'text', cur.title, 'placeholder="如：油漆制作负责人"')) +
        fld('允许手机手势放大页面', '<label class="checkline"><input type="checkbox" name="allow_zoom"' + (cur.allow_zoom ? ' checked' : '') + '> 允许</label>') +
        (isNew ? fld('初始密码', inp('password', 'text', '123456'), 1, 0, '默认 123456，员工登录后在「我的」里自行修改') : '') +
      '</div>' +

      '<div class="sec-title">' + ico('shield', 16) + ' 所属权限组（可多选，权限自动继承；一个组的权限只配一次）</div>' +
      chkGrid('roles', groupItems, cur.roles) +
      '<div class="hint">往组里加人就是授权。以后要调整这一类人的权限，改权限组即可，不用一个个改人。</div>' +

      '<div class="perm-box" data-touched="' + (followGroup ? '0' : '1') + '">' +
        '<div class="sec-title">' + ico('sliders', 16) + ' 个人权限' +
          '<span class="more" style="display:flex;gap:6px">' +
            '<button type="button" class="btn sm" id="st-follow">' + ico('refresh', 13) + ' 跟随权限组</button>' +
            '<button type="button" class="btn sm" id="st-custom">' + ico('edit', 13) + ' 单独设置' +
          '</span></div>' +
        '<div class="hint" id="st-mode-hint" style="margin:-2px 0 10px"></div>' +
        '<div id="st-perm-fields">' +
          '<div class="perm-label">数据可见范围</div>' +
          chkGrid('scope', m.scopes, [ (cur.perms && cur.custom) ? cur.perms.scope : permPreview.scope ], true) +
          '<div class="perm-label">可访问页面</div>' +
          chkGrid('pages', m.pages, (cur.perms && cur.custom) ? cur.perms.pages : permPreview.pages) +
          '<div class="perm-label">关键动作权限</div>' +
          chkGrid('actions', m.actions, (cur.perms && cur.custom) ? cur.perms.actions : permPreview.actions) +
        '</div>' +
        '<div class="hint">提示：不勾「项目总览」、只勾「生产看板」，就是「只能看生产、看不到总览和报表」的厂长权限。</div>' +
      '</div>' +
    '</div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button>' +
    '<button class="btn primary" id="st-save">' + (isNew ? '创建员工' : '保存修改') + '</button></div>', true);

  /* 当前权限模式：true=跟随权限组，false=单独设置 */
  let modeFollow = followGroup;

  /* 把权限框刷成「按所属组合并出来的结果」，并同步勾选状态 */
  const syncPreview = () => {
    const keys = $$('input[name=roles]:checked', mask).map((x) => x.value);
    const pp = permsFromGroups(keys);
    $$('input[name=pages]', mask).forEach((x) => { x.checked = pp.pages.indexOf(x.value) >= 0; x.closest('.chk').classList.toggle('on', x.checked); });
    $$('input[name=actions]', mask).forEach((x) => { x.checked = pp.actions.indexOf(x.value) >= 0; x.closest('.chk').classList.toggle('on', x.checked); });
    $$('input[name=scope]', mask).forEach((x) => { x.checked = x.value === pp.scope; x.closest('.chk').classList.toggle('on', x.checked); });
  };
  /* 跟随模式下锁住权限框（只能看，不能改） */
  const applyMode = () => {
    const box = $('#st-perm-fields', mask);
    box.classList.toggle('locked', modeFollow);
    $$('input', box).forEach((x) => { x.disabled = modeFollow; });
    $('#st-mode-hint', mask).innerHTML = modeFollow
      ? ico('refresh', 13) + ' 当前：<b>跟随权限组</b> —— 权限随所属组自动变化，改组即全组生效（推荐）'
      : ico('alert', 13) + ' 当前：<b>单独设置</b> —— 此人不跟随权限组，下面勾选的权限只对他一个人生效';
    if (modeFollow) syncPreview();
  };
  $('#st-follow', mask).onclick = () => { modeFollow = true; applyMode(); toast('已切回「跟随权限组」', 'ok'); };
  $('#st-custom', mask).onclick = () => { modeFollow = false; applyMode(); toast('已切为「单独设置」，请勾选此人的权限', 'ok'); };
  $$('input[name=roles]', mask).forEach((x) => {
    x.addEventListener('change', () => { if (modeFollow) syncPreview(); });
  });
  applyMode();

  if (isNew) {
    const usr = $('input[name=username]', mask), ph = $('input[name=phone]', mask);
    /* 填了手机号就自动同步成账号，省一步 */
    ph.addEventListener('input', () => { if (!usr.dataset.edited) usr.value = ph.value; });
    usr.addEventListener('input', () => { usr.dataset.edited = '1'; });
  }

  $('#st-save', mask).onclick = async () => {
    const btn = $('#st-save', mask);
    const name = $('input[name=name]', mask).value.trim();
    const username = $('input[name=username]', mask).value.trim();
    if (!name) return toast('请填写姓名', 'err');
    if (!username) return toast('请填写登录账号', 'err');
    const roles = $$('input[name=roles]:checked', mask).map((x) => x.value);
    if (!roles.length) return toast('请至少选择一个权限组', 'err');
    const body = {
      name, username, roles,
      phone: $('input[name=phone]', mask).value.trim(),
      title: $('input[name=title]', mask).value.trim(),
      allow_zoom: $('input[name=allow_zoom]', mask).checked,
    };
    if (modeFollow) body.useGroupPerms = true;
    else body.perms = {
      pages: $$('input[name=pages]:checked', mask).map((x) => x.value),
      actions: $$('input[name=actions]:checked', mask).map((x) => x.value),
      scope: ($$('input[name=scope]:checked', mask)[0] || {}).value || 'self',
    };
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      if (isNew) body.password = $('input[name=password]', mask).value || '123456';
      await api(isNew ? '/api/staff/create' : '/api/staff/update', { method: 'POST', body: isNew ? body : Object.assign({ id: id }, body) });
      closeModal(); await loadBootstrap(); render();
      toast(isNew ? '员工「' + name + '」已创建' : '已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = isNew ? '创建员工' : '保存修改'; }
  };
}

/* ---------- 行内操作 ---------- */
async function resetStaffPwd(id) {
  const u = staffById(id); if (!u) return;
  const np = window.prompt('给「' + u.name + '」设置新密码（至少 6 位）：', '123456');
  if (np === null) return;
  if (String(np).length < 6) return toast('新密码至少 6 位', 'err');
  try {
    await api('/api/staff/password', { method: 'POST', body: { id: id, newP: np } });
    toast('已重置「' + u.name + '」的密码，对方需重新登录', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function toggleStaff(id) {
  const u = staffById(id); if (!u) return;
  const off = u.active === false;
  try {
    await api('/api/staff/update', { method: 'POST', body: { id: id, active: off } });
    await loadBootstrap(); render();
    toast('已' + (off ? '启用' : '停用') + '「' + u.name + '」', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteStaff(id) {
  const u = staffById(id); if (!u) return;
  if (!window.confirm('确定删除员工「' + u.name + '」？\n\n如果他在系统里已经有项目/任务记录，请改用「停用」，否则历史记录会失去关联。')) return;
  try {
    await api('/api/staff/delete', { method: 'POST', body: { id: id } });
    await loadBootstrap(); render();
    toast('已删除「' + u.name + '」', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
