/* ============ 10 流程节点表单（由服务端 spec.js 的 NODE_FIELDS 驱动） ============
 * 一个节点一个表单，字段、必填、类型、默认值统统来自流程规格总表：
 *   nodeFormHtml(scope, stage, rec) → HTML
 *   mountNodeForm(root)            → 挂载文件上传控件
 *   collectNodeForm(root, scope, stage) → { key: value }
 * 以后改流程只改 spec.js，这里不用动。
 */
'use strict';

let NF_FILES = {};   // 当前表单的文件控件： key -> filesWidget
let NF_EXISTING_FILES = {};

function nodeFieldValue(f, rec, stage) {
  if (f.key === 'split_drawings_ref' && S.detail?.design?.split_drawings) return S.detail.design.split_drawings;
  if (!rec) return f.default === 'today' ? todayStr() : (f.default && f.default !== 'today' ? f.default : '');
  const saved = rec.node_values?.[stage];
  if (saved && Object.prototype.hasOwnProperty.call(saved, f.key)) return saved[f.key];
  const v = f.col ? rec[f.col] : ((rec.custom || {})[f.key]);
  if (f.key === 'is_exception' && typeof v === 'boolean') return v ? '是' : '否';
  if (v === undefined || v === null || v === '') {
    if (f.default === 'today') return todayStr();
    if (f.default && f.default !== 'today') return f.default;
    if (f.defaultName && f.type === 'user') return f.defaultName;
    return '';
  }
  return v;
}
function todayStr() { return dpTodayStr(); }

function nodeFormHtml(scope, stage, rec) {
  NF_FILES = {};
  NF_EXISTING_FILES = {};
  const defs = nodeFields(scope, stage);
  if (!defs.length) return '<div class="notice" style="margin:0">该节点暂未配置字段。</div>';
  const fields = [];
  for (const f of defs) {
    const val = nodeFieldValue(f, rec, stage);
    const nm = 'f_' + f.key;
    const full = !!f.full;
    if (f.readonly && f.type === 'users') {
      const names = (Array.isArray(val) ? val : String(val || '').split(','))
        .map(userNameById).filter(name => name !== '—');
      fields.push(fld(f.label, '<div class="readonly-field-value">' + h(names.join('、') || '待分配') + '</div>', false, full, f.hint));
      continue;
    }
    if (f.type === 'file') {
      if (f.readonly) {
        fields.push(fld(f.label, val ? fileLink(val, '查看图纸') : '<span>暂无图纸</span>', false, true, f.hint));
        continue;
      }
      NF_EXISTING_FILES[f.key] = val;
      NF_FILES[f.key] = filesWidget(f.label + '（' + (f.required ? '必填' : '选填') + '）', true);
      const older = (rec?.file_history || []).filter(item => item.stage === stage && item.field === f.label);
      fields.push('<div class="full">' + (val ? '<div class="hint">已保存：' + fileLink(val, '查看' + f.label) + '</div>' : '') +
        (older.length ? '<div class="hint">历史附件：' + older.map(item => fileLink(item.file_id, '查看旧版')).join('、') + '</div>' : '') +
        '<div id="nf-' + f.key + '"></div></div>');
      continue;
    }
    let inner;
    if (f.type === 'select') inner = sel(nm, [{ v: '', t: '请选择' }, ...(f.options || []).map((o) => ({ v: o, t: (f.optionLabels && f.optionLabels[o]) || o }))], val);
    else if (f.type === 'textarea') inner = '<textarea name="' + nm + '"' + (full ? '' : ' style="min-height:56px"') + '>' + h(val) + '</textarea>';
    else if (f.type === 'checkbox') inner = '<div class="checkline"><input type="checkbox" name="' + nm + '" style="width:17px;height:17px;accent-color:var(--blue)"' + (val ? ' checked' : '') + '> ' + h(f.hint || '已确认') + '</div>';
    else if (f.type === 'stars') inner = starsHtml(Number(val) || 5, true).replace('data-star', 'data-star="' + nm + '"');
    else if (f.type === 'user') inner = capUserSel(nm, f.cap, val, true, f);
    else if (f.type === 'users') inner = capUsersSel(nm, f.cap, val, f);
    else if (f.type === 'number' || f.type === 'money') inner = inp(nm, 'number', val, 'min="0" step="' + (f.type === 'money' ? '0.01' : '1') + '"');
    else if (f.type === 'date') inner = inp(nm, 'date', val);
    else inner = inp(nm, 'text', val);
    fields.push(fld(f.label, inner, f.required, full, f.type === 'checkbox' ? '' : f.hint));
  }
  return '<div class="form-grid">' + fields.join('') + '</div>';
}

function mountNodeForm(root) {
  for (const k of Object.keys(NF_FILES)) {
    const box = $('#nf-' + k, root);
    if (box) box.appendChild(NF_FILES[k].el);
  }
  const scope = root.id === 'design-action' ? 'design' : root.id === 'prod-action' ? 'production' : root.id === 'install-action' ? 'install' : '';
  if (!scope || !S.detail?.[scope]) return;
  const record = S.detail[scope];
  const toolbar = document.createElement('div');
  toolbar.className = 'workflow-controls';
  toolbar.innerHTML = '<button class="btn" data-save>保存资料</button>';
  if (record.paused_by) {
    toolbar.innerHTML = '<span class="workflow-warning">上游退回，当前任务暂停</span>' + (isA() ? '<button class="btn" data-resume>核对后恢复</button>' : '');
    root.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = true; });
  }
  root.appendChild(toolbar);
  const draftKey = 'ygx-v22-draft:' + S.me.id + ':' + scope + ':' + record.id + ':' + record.status;
  const draftNote = document.createElement('span'); draftNote.className = 'workflow-warning';
  toolbar.appendChild(draftNote);
  let draft;
  try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (_) {}
  if (draft && !record.paused_by) {
    const restore = document.createElement('button'); restore.className = 'btn'; restore.textContent = '恢复未提交草稿';
    restore.onclick = () => {
      if (draft.updated_at !== record.updated_at && !confirm('服务器资料已变化，恢复后请核对再提交。继续恢复草稿？')) return;
      for (const element of root.querySelectorAll('input[name],select[name],textarea[name]')) {
        if (!(element.name in draft.values) || element.type === 'file') continue;
        if (element.dataset.multiPerson !== undefined) element.checked = String(draft.values[element.name]).split(',').includes(element.value);
        else if (element.type === 'checkbox') element.checked = draft.values[element.name];
        else if (!element.multiple) element.value = draft.values[element.name];
      }
      root.customFieldBox?.restore(draft.custom);
      draftNote.textContent = '草稿已恢复，尚未提交';
    };
    toolbar.appendChild(restore);
  }
  const saveDraft = () => {
    const values = {};
    for (const element of root.querySelectorAll('input[name],select[name],textarea[name]')) {
      if (element.type === 'file' || element.disabled || element.multiple) continue;
      if (element.dataset.multiPerson !== undefined) {
        if (!(element.name in values)) values[element.name] = '';
        if (element.checked) values[element.name] = [values[element.name], element.value].filter(Boolean).join(',');
      } else values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
    }
    try { localStorage.setItem(draftKey, JSON.stringify({ updated_at: record.updated_at, values, custom: root.customFieldBox?.draft() })); draftNote.textContent = navigator.onLine ? '本机草稿，未提交' : '断网中，草稿未提交'; }
    catch (_) { draftNote.textContent = '本机草稿保存失败，请勿关闭页面'; }
  };
  root.addEventListener('input', saveDraft);
  root.addEventListener('change', saveDraft);
  root.addEventListener('change', (e) => {
    if (e.target.dataset.multiPerson === undefined) return;
    const picker = e.target.closest('.person-picker');
    picker.querySelector('summary').textContent = '已选 ' + picker.querySelectorAll('input:checked').length + ' 人 · 点击选择';
  });
  for (const [selector, action] of [['[data-save]', 'save'], ['[data-resume]', 'resume']]) {
    const button = toolbar.querySelector(selector);
    if (!button) continue;
    button.onclick = async () => {
      const reason = action === 'save' ? '' : prompt('请填写重新核对的依据');
      if (action !== 'save' && !reason?.trim()) return;
      button.disabled = true;
      try {
        const data = action === 'save' ? collectNodeForm(root, scope, record.status) : {};
        await api('/api/' + scope + '/' + record.id + '/' + action, { method: 'POST', body: { data, reason } });
        await refreshAfterAction(); toast(action === 'save' ? '资料已保存，节点未推进' : '操作已记录', 'ok');
      } catch (e) { toast(e.message, 'err'); button.disabled = false; }
    };
  }
}

/* 收集节点表单：字段 key 不带 f_ 前缀，键名与 spec.js 完全一致 */
function collectNodeForm(root, scope, stage) {
  const raw = formData(root);
  const data = {};
  for (const f of nodeFields(scope, stage)) {
    const nm = 'f_' + f.key;
    if (f.readonly) continue;
    if (f.type === 'file') data[f.key] = (NF_FILES[f.key] && NF_FILES[f.key].get()) || NF_EXISTING_FILES[f.key] || '';
    else if (nm in raw) data[f.key] = raw[nm];
  }
  if (root.customFieldBox) data.custom = root.customFieldBox.get();
  return data;
}

/* 节点小标题：操作岗位 + 当前状态 */
function nodeBannerHtml(scope, stage, extra) {
  return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:var(--gray);margin:-2px 0 12px">' +
    ico('user', 14) + '操作岗位：<b style="color:var(--ink-2)">' + h(nodeActorsLabel(scope, stage)) + '</b>' +
    (extra || '') + '</div>';
}
