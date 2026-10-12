'use strict';

const types = { text: '单行文本', textarea: '多行文本', date: '日期', number: '数字', money: '金额', select: '单选', multiselect: '多选', user: '人员（单选）', users: '人员（多选）', file: '文件/附件' };
const choices = type => ['select', 'multiselect'].includes(type);
const optionsOf = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[,，\r\n]/)).map(v => String(v).trim()).filter(Boolean))];
const present = value => Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== '';

function normalize(custom, definitions, users, previous = {}) {
  if (custom === undefined) return undefined;
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new Error('附加字段格式无效');
  const result = {};
  for (const f of definitions) {
    if (!Object.prototype.hasOwnProperty.call(custom, f.key)) continue;
    let value = custom[f.key];
    if (['user', 'users', 'multiselect'].includes(f.type)) {
      const many = f.type !== 'user';
      if (value == null || value === '') value = many ? [] : '';
      if (many ? !Array.isArray(value) || value.some(v => typeof v !== 'string') : typeof value !== 'string') {
        throw new Error('「' + f.label + '」请选择有效' + (f.type === 'multiselect' ? '选项' : '人员'));
      }
      const selected = [...new Set((many ? value : [value]).map(v => v.trim()).filter(Boolean))];
      const old = Array.isArray(previous[f.key]) ? previous[f.key] : [previous[f.key]];
      for (const id of selected) {
        if (f.type === 'multiselect') {
          if (!(f.options || []).includes(id) && !old.includes(id)) throw new Error('「' + f.label + '」包含无效选项');
        } else if (!users.some(u => u.id === id && u.active !== false) && !old.includes(id)) {
          throw new Error('「' + f.label + '」包含不存在或已停用的人员');
        }
      }
      value = many ? selected : selected[0] || '';
    }
    result[f.key] = value;
  }
  return result;
}

// Rollback snapshots count as usage, so changing a definition cannot invalidate history.
function storedValues(records, key) {
  const values = [];
  const visit = record => {
    if (present(record?.custom?.[key])) values.push(record.custom[key]);
    for (const item of record?.node_history || []) if (item.snapshot) visit(item.snapshot);
  };
  records.forEach(visit);
  return values;
}
function updateError(before, after, records) {
  const values = storedValues(records, before.key);
  if (!values.length) return '';
  if (['type', 'scope', 'stage'].some(key => (before[key] || '') !== (after[key] || ''))) return '字段已有填写记录，不能更换类型、表单或节点；请新增字段，原字段可停用';
  const removed = (before.options || []).filter(value => !(after.options || []).includes(value));
  if (choices(before.type) && values.flat().some(value => removed.includes(value))) return '已填写过的选项不能移除或改名；可以新增选项，历史记录会保留';
  return '';
}
module.exports = { types, choices, optionsOf, normalize, storedValues, updateError };
