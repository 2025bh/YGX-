import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestCorrection} from '../web/suggestions.ts';
const draft={unit:'㎡',price:100} as any;
test('explicit new measurements and metre conversion',()=>assert.deepEqual(suggestCorrection('高度改成2100，长度确认2.8米',draft,'C'),{height:2100,length:2800}));
test('unit suggestion clears a price for the old unit',()=>assert.deepEqual(suggestCorrection('脚线按米计价',draft,'C'),{unit:'米',calc_mode:'length',price:null}));
test('old mistaken value and questions do not become answers',()=>{assert.deepEqual(suggestCorrection('高度1900错了，看总高',draft,'C'),{});assert.deepEqual(suggestCorrection('高度改成1900是错误的',draft,'C'),{});});
test('conflicting explicit values require manual clarification',()=>assert.deepEqual(suggestCorrection('高度改成2100，高度改成2200',draft,'C'),{}));
