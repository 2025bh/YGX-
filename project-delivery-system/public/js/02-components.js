/* ============ 02 通用组件 ============ */
'use strict';

/* 星级选择器交互 */
document.addEventListener('click', (e) => {
  const star = e.target.closest('.star-picker span');
  if (!star) return;
  const picker = star.parentElement;
  const v = Number(star.dataset.v);
  $$('span', picker).forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
  picker.dataset.value = v;
});

const MULTI_PICKER = '.person-picker, .cf-picker';
function closeOtherMultiPickers(active) {
  document.querySelectorAll('.person-picker[open], .cf-picker[open]').forEach((picker) => {
    if (picker !== active) picker.open = false;
  });
}
document.addEventListener('click', (e) => {
  closeOtherMultiPickers(e.target.closest(MULTI_PICKER));
});
document.addEventListener('focusin', (e) => {
  closeOtherMultiPickers(e.target.closest(MULTI_PICKER));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const openPicker = document.querySelector('.person-picker[open], .cf-picker[open]');
  if (!openPicker) return;
  closeOtherMultiPickers();
  openPicker.querySelector('summary')?.focus();
  e.preventDefault();
  e.stopPropagation();
}, true);

/* 文件上传组件: filesWidget(fieldKey) 返回 {el, get()} */
function filesWidget(label, single) {
  const state = { files: [] };
  const el = document.createElement('div');
  el.className = 'field file-widget';
  el.innerHTML =
    '<label>' + h(label) + '</label>' +
    '<button type="button" class="upload-btn">' + ico('paperclip', 16) + ' 点击上传' + (single ? '文件' : '文件（可多个）') + '</button>' +
    '<input type="file" style="display:none" ' + (single ? '' : 'multiple') + '>' +
    '<div class="fchips"></div>';
  const input = $('input[type=file]', el);
  const btn = $('.upload-btn', el);
  btn.onclick = () => input.click();
  input.onchange = async () => {
    for (const f of input.files) {
      btn.classList.add('uploading'); btn.innerHTML = ico('clock', 16) + ' 上传中…';
      try { const r = await uploadFile(f); state.files.push(r); } catch (e) { toast(e.message, 'err'); }
      btn.classList.remove('uploading'); btn.innerHTML = ico('paperclip', 16) + ' 继续上传';
      input.value = '';
      renderChips();
    }
  };
  function renderChips() {
    $('.fchips', el).innerHTML = state.files.map((f, i) =>
      '<span class="fchip"><a href="/api/files/' + esc(f.id) + '" target="_blank" onclick="event.stopPropagation()">' + ico('file', 14) + ' ' + h(f.name) + '</a><span class="rm" data-i="' + i + '">×</span></span>'
    ).join('');
    $$('.rm', el).forEach((r) => r.onclick = () => { state.files.splice(Number(r.dataset.i), 1); renderChips(); });
  }
  return {
    el,
    get() { return single ? (state.files[0] ? state.files[0].id : '') : state.files.map((f) => f.id).join(','); },
  };
}

/* 步骤条: 项目可见人均可查看节点；退回权限在详情内另行判断。 */
function stepsBar(stages, current, skipped, rollback) {
  skipped = skipped || [];
  const idx = stages.indexOf(current);
  let prevDone = false;
  return '<div class="steps">' + stages.map((st, i) => {
    let cls = '';
    if (skipped.includes(st)) cls = 'skip';
    else if ((rollback?.pendingStages || []).includes(st)) cls = 'parallel';
    else if (i < idx) { cls = 'done'; prevDone = true; }
    else if (i === idx) cls = 'cur';
    else if (prevDone && cls === '') { /* keep */ }
    const dot = cls === 'done' ? '✓' : (cls === 'skip' ? '—' : cls === 'parallel' ? '并' : (i + 1));
    let lineCls = 'step ' + cls;
    if (i > 0 && (i - 1 < idx) && !skipped.includes(stages[i - 1])) lineCls += ' prev-done';
    const inner = '<div class="dot">' + dot + '</div><div class="lb">' + h(st) + '</div>';
    return rollback?.scope
      ? '<button type="button" class="' + lineCls + ' node-view-step" data-node-scope="' + h(rollback.scope) + '" data-node-stage="' + h(st) + '" title="查看' + h(st) + '">' + inner + '</button>'
      : '<div class="' + lineCls + '">' + inner + '</div>';
  }).join('') + '</div>';
}

/* 表单字段构建 */
function fld(label, inner, req, full, hint) {
  return '<div class="field' + (full ? ' full' : '') + '"><label>' + h(label) + (req ? '<span class="req">*</span>' : '') + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
}
function inp(name, type, val, attrs) {
  /* 日期字段统一用自绘中文日历（见 08-datepicker.js），不用浏览器原生日历控件 */
  if (type === 'date') return '<input class="dp-input" name="' + h(name) + '" type="text" value="' + h(val || '') + '" placeholder="点击选择日期" readonly autocomplete="off" ' + (attrs || '') + '>';
  return '<input name="' + h(name) + '" type="' + h(type || 'text') + '" value="' + h(val || '') + '" ' + (attrs || '') + '>';
}
function sel(name, options, val) {
  return '<select name="' + h(name) + '">' + options.map((o) => {
    const v = typeof o === 'string' ? o : o.v; const t = typeof o === 'string' ? o : o.t;
    return '<option value="' + h(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + h(t) + '</option>';
  }).join('') + '</select>';
}
function userSel(name, role, val, allowEmpty) {
  const opts = (allowEmpty ? [{ v: '', t: '请选择' }] : []).concat(S.db.users.filter((u) => !role || u.roles.includes(role)).map((u) => ({ v: u.id, t: u.name + '（' + (u.title || u.roles[0]) + '）' })));
  return sel(name, opts, val);
}
/* 按「能力标签」选人：新增权限组只要勾了对应能力，这里自动出现，不必改代码 */
function capUsers(cap, field) {
  return S.db.users.filter((u) => u.active !== false &&
    (!cap || hasCapOfUser(u, cap)) &&
    (!(field?.excludeNames || []).includes(u.name)) &&
    (!field?.allowedNames || field.allowedNames.includes(u.name)));
}
function hasCapOfUser(u, cap) {
  return (u.roles || []).some((k) => { const g = groupByKey(k); return g && (g.caps || []).includes(cap); });
}
function capUserSel(name, cap, val, allowEmpty, field) {
  const list = capUsers(cap, field);
  const resolved = list.find(u => u.id === val || u.name === val)?.id || val;
  const opts = (allowEmpty ? [{ v: '', t: '请选择' }] : []).concat(list.map((u) => ({ v: u.id, t: u.name + '（' + (u.title || u.roles[0]) + '）' })));
  return sel(name, opts, resolved);
}
/* 多人选择：手机和电脑共用勾选列表。 */
function capUsersSel(name, cap, vals, field) {
  const list = capUsers(cap, field);
  const picked = String(vals == null ? '' : (Array.isArray(vals) ? vals.join(',') : vals)).split(',').filter(Boolean);
  const defaults = field?.defaultNames || (field?.defaultName ? [field.defaultName] : []);
  const chosen = picked.length ? picked : list.filter(u => defaults.includes(u.name)).map(u => u.id);
  return '<details class="person-picker"><summary>已选 ' + chosen.length + ' 人 · 点击选择</summary><div class="person-options">' +
    list.map((u) => '<label><input type="checkbox" name="' + h(name) + '" data-multi-person value="' + h(u.id) + '"' + (chosen.includes(u.id) ? ' checked' : '') + '><span>' + h(u.name) + '</span><small>' + h(u.title || u.roles[0]) + '</small></label>').join('') +
    '</div></details>';
}

/* 收集表单数据 */
function formData(root) {
  const out = {};
  $$('input, select, textarea', root).forEach((el) => {
    if (el.type === 'file' || el.closest('.file-widget')) return;
    if (!el.name) return;   // 附加字段用 data-cf 标记、不设 name，由 cfBox.get() 单独收集
    if (el.dataset.multiPerson !== undefined) {
      if (!(el.name in out)) out[el.name] = '';
      if (el.checked) out[el.name] = [out[el.name], el.value].filter(Boolean).join(',');
    }
    else if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.multiple) out[el.name] = Array.from(el.selectedOptions).map((o) => o.value).join(',');
    else out[el.name] = el.value;
  });
  $$('[data-star]', root).forEach((sp) => { out[sp.dataset.star || 'customer_rating'] = Number(sp.dataset.value || 0); });
  return out;
}

/* 可点击元素属性：link 存在时挂 onclick 与手型光标 */
function clickAttr(link) {
  return link ? ' style="cursor:pointer" onclick="nav(\'' + link + '\')"' : '';
}

/* 环形图（描边圆环画法：12 点起始、顺时针、扇区间留均匀细缝，不会出现弦切怪形） */
function donutChart(segments, size) {
  size = size || 150;
  const cx = size / 2, cy = size / 2;
  const sw = Math.max(6, Math.round(size * 0.13));   // 环宽
  const r = cx - sw / 2;                             // 环中心线半径
  const C = 2 * Math.PI * r;                         // 周长
  const list = (segments || []).filter((s) => s && s.value > 0);
  const total = list.reduce((s, x) => s + x.value, 0);

  // 空数据：画一圈浅灰底环
  if (!list.length) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--gray-l,#eef2f7)" stroke-width="' + sw + '"/>' +
      '<text x="' + cx + '" y="' + (cy + 7) + '" text-anchor="middle" font-size="22" font-weight="700" fill="#94a3b8">0</text>' +
      '</svg>';
  }

  // 扇区之间留缝；只有一个扇区时不留缝，画成完整圆环
  const gap = list.length > 1 ? Math.min(C * 0.02, sw * 0.5) : 0;
  let acc = 0;
  const arcs = list.map((seg) => {
    const segLen = (seg.value / total) * C;
    const draw = Math.max(segLen - gap, 0.6);
    const dash = draw.toFixed(2) + ' ' + (C - draw).toFixed(2);
    const off = -(acc + gap / 2);
    acc += segLen;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + seg.color + '"' +
      ' stroke-width="' + sw + '" stroke-dasharray="' + dash + '" stroke-dashoffset="' + off.toFixed(2) + '"' +
      ' transform="rotate(-90 ' + cx + ' ' + cy + ')"' + clickAttr(seg.link) + '/>';
  }).join('');

  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img">' +
    arcs +
    '<text x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" font-size="22" font-weight="700" fill="#0f172a">' + total + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 17) + '" text-anchor="middle" font-size="11" fill="#64748b">总计</text></svg>';
}
function legendHtml(segments) {
  return '<div class="legend">' + segments.map((s) =>
    '<div class="li' + (s.link ? ' clickable' : '') + '"' + clickAttr(s.link) + '><span class="sw" style="background:' + s.color + '"></span>' + h(s.label) + '<span class="lv">' + s.value + '</span></div>'
  ).join('') + '</div>';
}
function hbar(label, value, max, color) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return '<div class="hbar"><div class="hb-top"><span>' + h(label) + '</span><span>' + value + '</span></div><div class="hb-track"><div class="hb-fill" style="width:' + pct + '%;background:' + (color || 'var(--blue)') + '"></div></div></div>';
}

/* 看板渲染 */
function kanban(stages, cards, skippedOf) {
  skippedOf = skippedOf || (() => []);
  return '<div class="kanban">' + stages.map((st) => {
    const list = cards.filter((c) => c.status === st);
    return '<div class="kcol"><div class="khead">' + h(st) + '<span class="n">' + list.length + '</span></div>' +
      list.map((c) => c.html).join('') + '</div>';
  }).join('') + '</div>';
}
function projectAddressHtml(p) {
  return '<div class="project-address">' + ico('pin', 13) + '<span>' + h(p && p.address ? p.address : '地址待补充') + '</span></div>';
}
function projCard(p, extra) {
  return '<div class="kcard" onclick="nav(\'#/project/' + p.id + '\')">' +
    '<div class="no project-number">' + h(p.project_no) + '</div>' +
    '<div class="nm">' + h(p.customer_name) + '</div>' +
    projectAddressHtml(p) +
    '<div class="meta">' + typeBadge(p.project_type) + statusBadge(p.project_status) + '</div>' +
    (extra || '') + '</div>';
}

/* 空状态：ic 传图标名（如 'inbox' / 'alert'），也可传任意字符串（会被当文本） */
function emptyBox(text, ic) {
  const key = ic || 'inbox';
  const inner = ICON_PATHS[key] ? ico(key, 40) : h(key);
  return '<div class="empty"><div class="e-ic">' + inner + '</div><div class="e-t">' + h(text) + '</div></div>';
}

/* ============ 语音输入 + 大模型整理 ============ */
/* 手机端浏览器语音识别（Chrome / 微信内置浏览器之外的安卓浏览器支持较好） */
function SpeechRecCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
function voiceSupported() { return !!SpeechRecCtor(); }
function llmEnabled() { return !!(S.db && S.db.llmEnabled); }

/* 给容器里每个 textarea 挂上「语音输入 / AI 整理」小工具条 */
function attachVoiceInputs(root) {
  const targets = $$('textarea', root);
  if (!targets.length) return;
  const canVoice = voiceSupported();
  const canAI = llmEnabled();
  if (!canVoice && !canAI) return;
  targets.forEach((ta) => {
    if (ta.dataset.voiceReady === '1') return;
    ta.dataset.voiceReady = '1';
    const bar = document.createElement('div');
    bar.className = 'voice-bar';
    bar.innerHTML =
      (canVoice ? '<button type="button" class="vbtn mic-btn">' + ico('mic', 15) + ' 语音输入</button>' : '') +
      (canAI ? '<button type="button" class="vbtn ai-btn">' + ico('sparkle', 15) + ' AI 整理</button>' : '') +
      (canVoice || canAI ? '<span class="vhint">' + (canVoice ? '点一下开始说，说完再点一下结束' : '') + '</span>' : '');
    ta.parentNode.insertBefore(bar, ta.nextSibling);

    const micBtn = $('.mic-btn', bar);
    if (micBtn) {
      const SR = SpeechRecCtor();
      let rec = null; let listening = false; let base = ''; let finalText = '';
      micBtn.onclick = () => {
        if (listening) { rec.stop(); return; }
        base = ta.value ? ta.value.replace(/\s*$/, '') + ' ' : '';
        finalText = '';
        rec = new SR();
        rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true;
        rec.onresult = (ev) => {
          let interim = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
          }
          ta.value = base + finalText + interim;
        };
        rec.onerror = (ev) => {
          listening = false; micBtn.classList.remove('on');
          micBtn.innerHTML = ico('mic', 15) + ' 语音输入';
          toast(ev.error === 'not-allowed' ? '麦克风未授权，请在浏览器里允许使用麦克风' : ('语音识别出错：' + ev.error), 'err');
        };
        rec.onend = () => {
          listening = false; micBtn.classList.remove('on');
          micBtn.innerHTML = ico('mic', 15) + ' 语音输入';
        };
        try { rec.start(); } catch (e) { toast('语音识别启动失败：' + e.message, 'err'); return; }
        listening = true; micBtn.classList.add('on');
        micBtn.innerHTML = ico('mic', 15) + ' 正在听…（点此结束）';
      };
    }

    const aiBtn = $('.ai-btn', bar);
    if (aiBtn) aiBtn.onclick = () => aiTidyField(ta, aiBtn);
  });
}

/* 把这个文本域里的大白话交给大模型，自动填进同弹窗内对应字段 */
async function aiTidyField(ta, btn) {
  const text = String(ta.value || '').trim();
  if (!text) { toast('请先用语音或键盘输入内容，再点 AI 整理', 'err'); return; }
  const root = ta.closest('.modal') || ta.closest('.modal-mask') || document;
  const fields = $$('input[name],select[name],textarea[name]', root).map((el) => {
    const box = el.closest('.field');
    const lab = (box && box.querySelector('label')) ? box.querySelector('label').textContent.replace(/\s*\*$/, '').trim() : el.name;
    let hint = '';
    if (el.tagName === 'SELECT') hint = '只能从中选一个：' + Array.from(el.options).map((o) => o.value).filter(Boolean).join(' / ');
    else if (el.type === 'date') hint = '格式 YYYY-MM-DD';
    else if (el.type === 'number') hint = '只填数字';
    return { key: el.name, name: lab, hint };
  }).filter((f) => f.key);
  const dict = [];
  $$('select[name]', root).forEach((el) => Array.from(el.options).forEach((o) => {
    if (o.value && dict.indexOf(o.value) < 0) dict.push(o.value);
  }));
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = ico('clock', 15) + ' AI 整理中…'; }
  try {
    const r = await api('/api/llm/parse', { method: 'POST', body: { text, fields, dict } });
    const data = r.data || {};
    const done = []; let n = 0;
    Object.keys(data).forEach((k) => {
      const el = $('[name="' + k + '"]', root);
      const v = data[k];
      if (!el || v === null || v === undefined || v === '') return;
      if (el.tagName === 'SELECT') {
        const hit = Array.from(el.options).find((o) => o.value === String(v) || o.text === String(v));
        if (!hit) return;
        el.value = hit.value; done.push(k + '=' + hit.value); n++;
        return;
      }
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
      done.push(k + '=' + String(v).slice(0, 20)); n++;
    });
    if (n) toast('已自动填写：' + done.join('、'), 'ok');
    else toast('没能识别出可填写的字段，内容已保留在文本框里', 'err');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = old; }
  }
}
