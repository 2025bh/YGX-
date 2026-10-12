/* ============ 09 附加字段：节点表单渲染 + 详情展示 + 管理员字段设置 ============ */
'use strict';

/* ------------------------------------------------------------------
   一、读取字段定义（定义存在 S.db.field_defs，由服务端下发）
   scope: project / design / production / install / aftersales
   stage: 空字符串 = 该表单的「全流程」字段，任何节点都能填
------------------------------------------------------------------ */
function cfAll() { return (S.db && S.db.field_defs) || []; }
function cfScopeDefs(scope) { return cfDefs(scope, ''); }
function cfDefs(scope, stage) {
  return cfAll()
    .filter((f) => f.scope === scope && f.active !== false && (!f.stage || !stage || f.stage === stage))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
/* 该表单在当前节点有没有附加字段可填（决定要不要渲染操作框） */
function cfHas(scope, stage) { return cfDefs(scope, stage).length > 0; }
function cfTypeName(t) { const m = (S.db.consts && S.db.consts.FIELD_TYPES) || {}; return m[t] || t; }
function cfScopeName(s) { const m = (S.db.consts && S.db.consts.FIELD_SCOPES) || {}; return m[s] || s; }
function cfStageName(scope, stage) {
  if (stage) return stage;
  return scope === 'project' ? '项目总表本身' : '全流程（不限节点）';
}
function cfScopeKeys() { return Object.keys((S.db.consts && S.db.consts.FIELD_SCOPES) || {}); }
function cfTypeKeys() { return Object.keys((S.db.consts && S.db.consts.FIELD_TYPES) || {}); }
function cfStagesOf(scope) {
  const m = (S.db.consts && S.db.consts.STAGES_BY_SCOPE) || {};
  return m[scope] || [''];
}

/* ------------------------------------------------------------------
   二、渲染：一个附加字段输入控件（统一用 data-cf="key" 标记，不用 name，
   避免和内置字段的 formData 收集混在一起）
------------------------------------------------------------------ */
function cfControl(f, val) {
  const at = ' data-cf="' + h(f.key) + '"';
  if (f.type === 'user') {
    const options = cfPeople(val ? [val] : []);
    return '<select aria-label="' + h(f.label) + '"' + at + '><option value="">请选择人员</option>' + options.map(o =>
      '<option value="' + h(o.v) + '"' + (o.v === val ? ' selected' : '') + (o.inactive ? ' disabled' : '') + '>' + h(o.t) + '</option>').join('') + '</select>';
  }
  if (['users', 'multiselect'].includes(f.type)) {
    const selected = Array.isArray(val) ? val : [];
    const options = f.type === 'users' ? cfPeople(selected) : [...new Set([...(f.options || []), ...selected])].map(v => ({ v, t: v }));
    return '<details class="cf-picker"' + at + '><summary aria-label="' + h(f.label) + '">请选择' + (f.type === 'users' ? '人员' : '选项') + '</summary>' +
      '<div class="cf-picker-search"><input type="search" data-cf-search aria-label="搜索' + h(f.label) + '" placeholder="搜索"></div><div class="cf-picker-options">' +
      options.map(o => '<label><input type="checkbox" data-cf-choice value="' + h(o.v) + '"' + (selected.includes(o.v) ? ' checked' : '') +
        (o.inactive && !selected.includes(o.v) ? ' disabled' : '') + '><span>' + h(o.t) + '</span></label>').join('') +
      '</div><div class="cf-picker-empty" hidden>没有匹配项</div></details>';
  }
  if (f.type === 'date') return '<input class="dp-input" type="text" value="' + h(val || '') + '" placeholder="点击选择日期" readonly autocomplete="off"' + at + '>';
  if (f.type === 'textarea') return '<textarea rows="3"' + at + '>' + h(val || '') + '</textarea>';
  if (f.type === 'number') return '<input type="number" value="' + h(val == null ? '' : val) + '"' + at + '>';
  if (f.type === 'money') return '<input type="number" min="0" step="0.01" value="' + h(val == null ? '' : val) + '"' + at + '>';
  if (f.type === 'select') {
    const cur = String(val == null ? '' : val);
    return '<select' + at + '>' + [{ v: '', t: '请选择' }].concat((f.options || []).map((o) => ({ v: o, t: o })))
      .map((o) => '<option value="' + h(o.v) + '"' + (o.v === cur ? ' selected' : '') + '>' + h(o.t) + '</option>').join('') + '</select>';
  }
  return '<input type="text" value="' + h(val || '') + '"' + at + '>';
}

function cfPeople(selected) {
  const list = S.db.users.filter(u => u.active !== false || selected.includes(u.id));
  return list.map(u => ({ v: u.id, t: u.name + (u.active === false ? '（已停用）' : ''), inactive: u.active === false }))
    .concat(selected.filter(id => !list.some(u => u.id === id)).map(id => ({ v: id, t: '已移除人员', inactive: true })));
}
function cfUpdatePicker(picker) {
  const selected = [...picker.querySelectorAll('[data-cf-choice]:checked')];
  picker.querySelector('summary').textContent = selected.length ? selected.slice(0, 2).map(el => el.nextElementSibling.textContent).join('、') +
    (selected.length > 2 ? ' 等 ' + selected.length + ' 项' : '') : '请选择';
}
function cfMountControls(root) {
  for (const picker of root.querySelectorAll('.cf-picker')) {
    cfUpdatePicker(picker);
    if (picker.dataset.bound) continue;
    picker.dataset.bound = '1';
    picker.addEventListener('change', () => cfUpdatePicker(picker));
    picker.querySelector('[data-cf-search]').oninput = event => {
      const query = event.target.value.trim().toLowerCase();
      let visible = 0;
      for (const item of picker.querySelectorAll('.cf-picker-options label')) {
        item.hidden = !item.textContent.toLowerCase().includes(query);
        if (!item.hidden) visible++;
      }
      picker.querySelector('.cf-picker-empty').hidden = visible > 0;
    };
  }
}

/*
  cfBox(scope, stage, values) → { defs, html, mount(root), get() }
  用法：把 html 拼进表单容器的 innerHTML，innerHTML 赋值后调用 mount(容器) 挂文件控件，
  提交时用 get() 取值，塞进请求体的 custom 字段。
*/
function cfBox(scope, stage, values) {
  values = values || {};
  const defs = cfDefs(scope, stage);
  const widgets = [];
  let html = '';
  if (defs.length) {
    html += '<div class="full cf-sep"><span>附加字段 · ' + h(cfScopeName(scope)) + ' · ' + h(cfStageName(scope, stage)) + '</span>' +
      '<span class="cf-sep-hint">管理员可在「字段设置」里增删改</span></div>';
  }
  defs.forEach((f) => {
    const tag = (f.required ? '<span class="req">*</span>' : '');
    if (f.type === 'file') {
      const w = filesWidget(f.label + (f.required ? '（必填）' : '（可选，可后补）'), true);
      const anchor = 'cf-file-' + f.key;
      html += '<div class="full">' + (values[f.key] ? '<div class="hint">已保存：' + fileLink(values[f.key], '查看' + f.label) + '</div>' : '') +
        '<div id="' + h(anchor) + '"></div></div>';
      widgets.push({ f, w, anchor });
    } else {
      html += '<div class="field' + (f.type === 'textarea' ? ' full' : '') + '"><label>' + h(f.label) + tag + '</label>' +
        cfControl(f, values[f.key]) + '</div>';
    }
  });
  const box = {
    defs, html, _root: null,
    mount(root) {
      box._root = root;
      root.customFieldBox = box;
      widgets.forEach((x) => { const a = $('#' + x.anchor, root); if (a) a.appendChild(x.w.el); });
      cfMountControls(root);
      return box;
    },
    get() {
      const out = {};
      defs.forEach((f) => {
        const w = widgets.find((x) => x.f.key === f.key);
        if (w) { out[f.key] = w.w.get() || values[f.key] || ''; return; }
        const el = box._root ? $('[data-cf="' + f.key + '"]', box._root) : null;
        out[f.key] = ['users', 'multiselect'].includes(f.type) ? [...(el?.querySelectorAll('[data-cf-choice]:checked') || [])].map(input => input.value) :
          el ? String(el.value == null ? '' : el.value).trim() : '';
      });
      return out;
    },
    draft() {
      const values = box.get();
      return Object.fromEntries(defs.filter(f => f.type !== 'file').map(f => [f.key, values[f.key]]));
    },
    restore(values) {
      for (const f of defs) {
        if (f.type === 'file' || !Object.prototype.hasOwnProperty.call(values || {}, f.key)) continue;
        const el = $('[data-cf="' + f.key + '"]', box._root);
        if (!el) continue;
        if (['users', 'multiselect'].includes(f.type)) {
          for (const input of el.querySelectorAll('[data-cf-choice]')) input.checked = Array.isArray(values[f.key]) && values[f.key].includes(input.value);
          cfUpdatePicker(el);
        } else el.value = values[f.key] ?? '';
      }
    },
  };
  return box;
}

/* ------------------------------------------------------------------
   三、详情页展示：已填写的附加字段（返回 {k,v} 数组，v 已转义/已生成 HTML）
------------------------------------------------------------------ */
function cfDisplayValue(f, v) {
  if (f.type === 'user') return h(userNameById(v));
  if (f.type === 'users') return h((Array.isArray(v) ? v : []).map(userNameById).join('、'));
  if (f.type === 'multiselect') return h((Array.isArray(v) ? v : []).join('、'));
  if (f.type === 'file') return fileLink(v, '查看' + f.label);
  if (f.type === 'money') return h(money(v));
  if (f.type === 'date') return h(fmtDate(v));
  return h(v);
}
function cfInfoItems(scope, rec) {
  const vals = (rec && rec.custom) || {};
  return cfAll().filter(f => f.scope === scope)
    .filter((f) => { const v = vals[f.key]; return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ''); })
    .map((f) => ({ k: f.label, v: cfDisplayValue(f, vals[f.key]) }));
}
/* 把附加字段拼成 info-grid 的格子 */
function cfInfoGridHtml(scope, rec) {
  return cfInfoItems(scope, rec)
    .map((i) => '<div><div class="k">' + h(i.k) + '</div><div class="v">' + i.v + '</div></div>').join('');
}

/* ------------------------------------------------------------------
   四、附加字段「随时补充」面板
   节点表单里已能填当前节点的字段；这个面板让任何人都能随时补/改本表单全部字段
   （尤其是由出货流程驱动的生产节点，没有内置表单）。
------------------------------------------------------------------ */
const CF_PANELS = [];
function cfPanelHtml(scope, rec, endpoint, icon, title, note) {
  const defs = cfScopeDefs(scope);
  if (!defs.length) return '';
  const cfb = cfBox(scope, '', (rec && rec.custom) || {});
  const id = 'cf-panel-' + scope;
  CF_PANELS.push({ id, endpoint, cfb });
  return '<div class="card" id="' + id + '"><h3>' + ico(icon || 'sliders', 17) + h(title || '附加字段') +
    '<span class="more"><button class="btn sm primary" data-cf-panel-save="' + id + '">' + ico('check', 13) + ' 保存</button></span></h3>' +
    (note ? '<div class="hint" style="margin:-4px 0 10px">' + note + '</div>' : '') +
    '<div class="form-grid">' + cfb.html + '</div></div>';
}
/* 在 renderShell 之后调用：把面板里的文件控件挂上并绑定保存按钮 */
function mountCfPanels() {
  const list = CF_PANELS.splice(0, CF_PANELS.length);
  list.forEach((p) => {
    const root = $('#' + p.id); if (!root) return;
    p.cfb.mount(root);
    const btn = $('[data-cf-panel-save="' + p.id + '"]', root);
    if (!btn) return;
    btn.onclick = async () => {
      const custom = p.cfb.get();
      btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = ico('clock', 13) + ' 保存中…';
      try {
        await api(p.endpoint, { method: 'POST', body: { custom } });
        await refreshAfterAction();
        toast('附加字段已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = old; }
    };
  });
}

/* ------------------------------------------------------------------
   五、管理员：表单字段设置
------------------------------------------------------------------ */
function viewFields() {
  const all = cfAll();
  const activeN = all.filter((f) => f.active !== false).length;
  let html = '<div class="page-head"><div><div class="t">表单字段设置</div>' +
    '<div class="sub">共 ' + all.length + ' 个字段（启用 ' + activeN + ' 个）· 这里加的字段会出现在对应表单的<b>节点填写框</b>和项目<b>详情页</b>里</div></div>' +
    '<button class="btn-hero" onclick="openFieldEditor()"><span class="plus">' + ico('plus', 20) + '</span>新增字段</button></div>';

  cfScopeKeys().forEach((scope) => {
    const list = all.filter((f) => f.scope === scope).sort((a, b) => (a.order || 0) - (b.order || 0));
    html += '<div class="card"><h3>' + ico('list', 17) + h(cfScopeName(scope)) +
      '<span class="badge b-blue">' + list.filter((f) => f.active !== false).length + ' 个启用</span>' +
      '<span class="more"><button class="btn sm primary" onclick="openFieldEditor(null,\'' + scope + '\')">' + ico('plus', 13) + ' 新增' + h(cfScopeName(scope)) + '字段</button></span></h3>' +
      fieldTableHtml(list) + '</div>';
  });
  return html;
}

function fieldTableHtml(list) {
  if (!list.length) return emptyBox('这个表单还没有任何附加字段，点右上角「新增字段」加一个');
  return '<div class="table-wrap"><table class="table"><thead><tr>' +
    '<th>字段名称</th><th>类型</th><th>填写节点</th><th>必填</th><th>状态</th><th>来源</th><th style="width:230px">操作</th>' +
    '</tr></thead><tbody>' + list.map((f) => {
      const off = f.active === false;
      return '<tr' + (off ? ' class="row-off"' : '') + '>' +
        '<td><b>' + h(f.label) + '</b><div style="font-size:11.5px;color:var(--gray)">' + h(f.key) + '</div>' +
        (['select', 'multiselect'].includes(f.type) && (f.options || []).length ? '<div style="font-size:11.5px;color:var(--gray)">可选值：' + h((f.options || []).join(' / ')) + '</div>' : '') + '</td>' +
        '<td>' + h(cfTypeName(f.type)) + '</td>' +
        '<td>' + (f.stage ? '<span class="badge b-amber">' + h(f.stage) + '</span>' : '<span class="badge b-gray">全流程</span>') + '</td>' +
        '<td>' + (f.required ? '<span class="badge b-red">必填</span>' : '—') + '</td>' +
        '<td>' + (off ? '<span class="badge b-gray">已停用</span>' : '<span class="badge b-green">启用中</span>') + '</td>' +
        '<td>' + (f.builtin ? '<span class="badge b-blue">预置</span>' : '<span class="badge b-purple">自建</span>') + '</td>' +
        '<td class="ops">' +
        '<button class="btn sm" onclick="openFieldEditor(\'' + h(f.id) + '\')">' + ico('edit', 13) + ' 编辑</button>' +
        '<button class="btn sm" onclick="toggleFieldDef(\'' + h(f.id) + '\')">' + ico('power', 13) + ' ' + (off ? '启用' : '停用') + '</button>' +
        '<button class="btn sm danger" onclick="deleteFieldDef(\'' + h(f.id) + '\')">' + ico('trash', 13) + '</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

/* 新增 / 编辑字段弹窗（传 id 编辑；传 scope 指定默认所属表单） */
function openFieldEditor(id, presetScope) {
  const isNew = !id;
  const f = isNew ? null : cfAll().find((x) => x.id === id || x.key === id);
  if (!isNew && !f) return toast('字段不存在', 'err');
  const cur = f || { scope: presetScope || 'design', stage: '', label: '', type: 'text', required: false, options: [], active: true };

  const scopeOpts = cfScopeKeys().map((s) => ({ v: s, t: cfScopeName(s) }));
  const typeOpts = cfTypeKeys().map((t) => ({ v: t, t: cfTypeName(t) }));

  openModal(
    '<div class="mhead"><div class="t">' + ico(isNew ? 'plus' : 'edit', 18) + (isNew ? '新增字段' : '编辑字段 · ' + h(cur.label)) + '</div><button class="x">✕</button></div>' +
    '<div class="mbody field-editor-layout"><div class="form-grid">' +
    fld('字段名称', inp('cf-label', 'text', cur.label, 'placeholder="如：五金单预计转交时间"'), 1) +
    fld('所属表单', sel('cf-scope', scopeOpts, cur.scope), 1) +
    fld('填写节点', '<select name="cf-stage" id="cf-stage"></select>', 1, 0, '选「全流程」= 该表单每个节点都能填') +
    fld('字段类型', sel('cf-type', typeOpts, cur.type), 1) +
    '<div class="field full" id="cf-opt-box"><label>下拉可选值<span class="req">*</span></label>' +
    '<textarea name="cf-opt" id="cf-opt" rows="3" placeholder="一行一个，或用逗号分隔。如：未开始,进行中,已完成"></textarea>' +
    '</div>' +
    '<div class="field full"><label class="checkline"><input type="checkbox" id="cf-req"' + (cur.required ? ' checked' : '') + ' style="width:17px;height:17px;accent-color:var(--blue)"> 设为必填（不填不能推进该节点）</label></div>' +
    '</div><section class="cf-preview"><h3>填写预览</h3><div id="cf-preview-control"></div></section></div>' +
    '<div class="mfoot"><button class="btn" onclick="closeModal()">取消</button>' +
    '<button class="btn primary" id="cf-save">' + (isNew ? '创建字段' : '保存修改') + '</button></div>', true);

  const scopeSel = $('select[name=cf-scope]');
  const stageSel = $('#cf-stage');
  const typeSel = $('select[name=cf-type]');
  const optBox = $('#cf-opt-box');
  const optTa = $('#cf-opt');
  if (cur.options && cur.options.length) optTa.value = cur.options.join('\n');

  /* 节点选项随所属表单联动；尽量保留原来选中的节点 */
  const refreshStages = (keep) => {
    const scope = scopeSel.value;
    const stages = cfStagesOf(scope);
    const want = keep !== undefined ? keep : stageSel.value;
    const opts = [{ v: '', t: scope === 'project' ? '项目总表（无节点）' : '全流程（不限节点）' }]
      .concat(stages.filter((s) => s).map((s) => ({ v: s, t: s })));
    stageSel.innerHTML = opts.map((o) => '<option value="' + h(o.v) + '"' + (o.v === want ? ' selected' : '') + '>' + h(o.t) + '</option>').join('');
  };
  const preview = () => {
    const field = { key: 'preview', type: typeSel.value, label: $('input[name=cf-label]').value.trim() || '未命名字段',
      options: [...new Set(optTa.value.split(/[,，\n]/).map(v => v.trim()).filter(Boolean))] };
    const root = $('#cf-preview-control');
    root.innerHTML = '<div class="field"><label>' + h(field.label) + ($('#cf-req').checked ? '<span class="req">*</span>' : '') + '</label>' +
      (field.type === 'file' ? '<button class="upload-btn" disabled>' + ico('paperclip', 16) + ' 上传文件</button>' : cfControl(field, '')) + '</div>';
    cfMountControls(root);
  };
  const refreshOpts = () => { optBox.style.display = ['select', 'multiselect'].includes(typeSel.value) ? '' : 'none'; preview(); };
  scopeSel.onchange = () => refreshStages('');
  typeSel.onchange = refreshOpts;
  $('input[name=cf-label]').oninput = preview;
  optTa.oninput = preview;
  $('#cf-req').onchange = preview;
  refreshStages(cur.stage);
  refreshOpts();

  $('#cf-save').onclick = async () => {
    const btn = $('#cf-save');
    const body = {
      label: ($('input[name=cf-label]') || {}).value ? $('input[name=cf-label]').value.trim() : '',
      scope: scopeSel.value,
      stage: stageSel.value,
      type: typeSel.value,
      options_raw: optTa.value,
      required: $('#cf-req').checked,
    };
    if (!body.label) return toast('请填写字段名称', 'err');
    if (['select', 'multiselect'].includes(body.type) && !String(body.options_raw).trim()) return toast('单选或多选字段必须填写可选值', 'err');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      if (isNew) await api('/api/fields/create', { method: 'POST', body });
      else await api('/api/fields/update', { method: 'POST', body: Object.assign({ id: f.id }, body) });
      closeModal(); await loadBootstrap(); render();
      toast(isNew ? '字段「' + body.label + '」已创建' : '字段已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = isNew ? '创建字段' : '保存修改'; }
  };
}

async function toggleFieldDef(id) {
  const f = cfAll().find((x) => x.id === id); if (!f) return;
  const off = f.active === false;
  try {
    await api('/api/fields/update', { method: 'POST', body: { id: id, active: off } });
    await loadBootstrap(); render();
    toast('已' + (off ? '启用' : '停用') + '字段「' + f.label + '」', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteFieldDef(id) {
  const f = cfAll().find((x) => x.id === id); if (!f) return;
  const tip = '确定删除尚未填写过的字段「' + f.label + '」？\n\n' +
    '· 它会从' + cfScopeName(f.scope) + (f.stage ? '的「' + f.stage + '」节点' : '的全流程') + '上消失\n' +
    '· 已有填写记录的字段不能删除，只能停用\n' +
    (f.builtin ? '· 这是照真实数据预置的字段\n' : '') +
    '\n如果只是暂时不想让人填，建议改用「停用」。';
  if (!window.confirm(tip)) return;
  try {
    await api('/api/fields/delete', { method: 'POST', body: { id: id } });
    await loadBootstrap(); render();
    toast('已删除字段「' + f.label + '」', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
