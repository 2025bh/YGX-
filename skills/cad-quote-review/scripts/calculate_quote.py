"""Portable deterministic quantities; explicit scope and no source-path assumptions."""
import argparse,json,math
from decimal import Decimal
from pathlib import Path

def number(value):
    if value is None or value=='':return None
    if isinstance(value,bool):raise ValueError('数字不能是布尔值')
    n=Decimal(str(value))
    if not n.is_finite() or n<0:raise ValueError('数字必须是有效非负数')
    return n

def calculate(row,customer_type='C'):
    result=dict(row);unit=row.get('unit');mode=row.get('calc_mode','pending');q=number(row.get('quantity'));price=number(row.get('price'))
    result.update(area=None,total_length=None,amount=None)
    if mode=='pending':result['status']='待确认口径';return result
    if customer_type=='B' and mode not in ('confirmed_rect','confirmed_length','confirmed_count','manual'):result['status']='B端口径待确认';return result
    mode=mode.removeprefix('confirmed_')
    if unit=='㎡' and mode not in ('rect','manual') or unit=='米' and mode not in ('length','manual') or unit not in ('㎡','米') and mode!='count':raise ValueError('单位与计算方式不匹配')
    base=None
    if unit=='㎡':
        h,l=number(row.get('height')),number(row.get('length'))
        base=number(row.get('area')) if mode=='manual' else h*l*q/1000000 if all(v is not None for v in (h,l,q)) else None
        minimum=number(row.get('minimum_area'))
        if base is not None and minimum is not None:base=max(base,minimum)
        result['area']=float(base) if base is not None else None
    elif unit=='米':
        l=number(row.get('length'));base=number(row.get('total_length')) if mode=='manual' else l*q/1000 if l is not None and q is not None else None
        result['total_length']=float(base) if base is not None else None
    else:base=q
    result['amount']=float(base*price) if base is not None and price is not None else None
    result['status']='缺工程量' if base is None else '缺单价' if price is None else '计算完成，待审核'
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
    if args.output.exists() or args.input.resolve()==args.output.resolve():raise SystemExit('输出必须是新的独立文件')
    data=json.loads(args.input.read_text(encoding='utf-8-sig'));data['rows']=[calculate(r,data.get('customer_type','C')) for r in data['rows']]
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
