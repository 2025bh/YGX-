'use strict';

// Side-effect-free decisions, shared by HTTP handlers and regression tests.
function assertCurrent(record, request) {
  if (record.paused_by) throw new Error('上游已退回，当前任务暂停，需重新确认后继续');
  if (request.expected_status !== record.status) throw new Error('节点已经变化，请刷新后重新操作');
  if (request.expected_updated_at !== record.updated_at) throw new Error('资料已被更新，请刷新后核对');
}

function previousStage(stages, current, skipped = []) {
  return stages.slice(0, stages.indexOf(current)).filter(s => !skipped.includes(s)).at(-1);
}

function completionError(scope, stage, data) {
  if (scope === 'design' && stage.includes('确认') && data.customer_confirm_status && !['已确认', '方案确认', '修改图纸'].includes(data.customer_confirm_status)) return '客户尚未确认，请先保存资料';
  if (scope === 'design' && stage === '开始拆单' && data.split_status && data.split_status !== '已完成') return '拆单尚未完成，请先保存资料';
  if (scope === 'design' && stage === '转接生产' && data.split_status !== '已完成') return '拆单尚未完成，不能转接生产';
  if (scope === 'production' && stage === '下单备料' && data.material_order_status !== '已下单') return '材料尚未下单，请先保存资料';
  if (scope === 'production' && stage === '外购入库' && !['不需要', '已入库'].includes(data.purchase_order_status)) return '外购尚未入库，请先保存资料';
  if (scope === 'install' && stage === '验收确认' && data.accept_result !== '合格') return '验收未通过，保存整改内容后再验收';
  if (scope === 'install' && stage === '客户确认' && data.customer_confirm_status !== '已确认') return '客户尚未确认，不能完成交付';
  return '';
}

function readyForInstallation(production, batches) {
  if (!production) return false;
  if (!production.batch_flow) return production.ship_status === '已出货';
  const active = batches.filter(b => b.valid !== false);
  return production.batches_finalized === true && active.length > 0 && active.every(b => b.status === '已出货' && b.exception !== '是');
}

module.exports = { assertCurrent, previousStage, completionError, readyForInstallation };
