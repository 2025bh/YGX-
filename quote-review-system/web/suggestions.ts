import type {Quote} from './types';
export function suggestCorrection(text:string,draft:Quote,customerType:string):Partial<Quote>{
 const patch:Partial<Quote>={};
 // Only explicit new-value statements are parsed. A question or an old mistaken value is not an answer.
 for(const [label,field] of [['高度|总高|高','height'],['长度|长','length'],['宽度|进深|宽','width'],['数量','quantity']] as const){
  const regex=new RegExp('(?:'+label+')\\s*(?:改为|改成|应为|应该是|确认采用|确认|=|：)\\s*(\\d+(?:\\.\\d+)?)\\s*(毫米|mm|米|m)?','gi');
  const found=[...text.matchAll(regex)];
  if(found.length===1){const f=found[0];if(/错了|错误|不是/.test(text.slice(f.index!+f[0].length,f.index!+f[0].length+4)))continue;let value=Number(f[1]);if(field!=='quantity'&&/^(米|m)$/i.test(f[2]||''))value*=1000;patch[field]=value;}
 }
 if(/按(?:米|延米)计价|只算总长/.test(text)){
  patch.unit='米';patch.calc_mode=customerType==='B'?'confirmed_length':'length';
  if(draft.unit!=='米')patch.price=null;
 }
 return patch;
}
