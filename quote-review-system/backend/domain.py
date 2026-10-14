"""Deterministic quantities. Imported geometry is evidence, never a learned guess."""
import math
import re
from decimal import Decimal

FIELDS = {'figure':'图号','region':'区域','name':'部件名称','unit':'单位','height':'高度','length':'长度','width':'宽度','thickness':'厚度','quantity':'数量','total_length':'总长','area':'面积','material':'材料','price':'单价','risk':'风险等级'}
NUMBERS = {'height','length','width','thickness','quantity','price','area','total_length','minimum_area'}
UNITS = {'㎡','米','个','樘','套','根','扇','待确认'}
ALIASES = {**{v:k for k,v in FIELDS.items()}, '规格单位':'unit','计价单位':'billing_unit','部件':'name','名称':'name','图纸名称':'name','面积原值':'area','总长原值':'total_length','深度':'width','高度mm':'height'}

def natural(value):
    return tuple(int(x) if x.isdigit() else x for x in re.split(r'(\d+)', str(value)))

def key(row):
    fig = re.sub(r'\s+', '', str(row.get('figure','')))
    name = re.sub(r'[\s（）()]+', '', str(row.get('name','')))
    name = re.sub(r'\d+(?:-\d+)+$', '', name)
    return fig, re.sub(r'\s+', '', str(row.get('region',''))), name

def number(value):
    if value is None or value == '': return None
    if isinstance(value, bool): raise ValueError('数字不能是布尔值')
    n = float(value)
    if not math.isfinite(n) or n < 0 or n > 1e10: raise ValueError('数字必须是有效的非负数')
    return n

def normalize(raw):
    aliases = ALIASES
    out = {aliases.get(k,k):v for k,v in raw.items() if aliases.get(k,k) in set(FIELDS)|{'calc_mode','minimum_area','note','images','pdf','bounds','handles','frame_index','frame_handle','source_evidence'}}
    billing=raw.get('billing_unit',raw.get('计价单位'))
    if billing not in (None,''):out['unit']=billing
    for k in NUMBERS:
        if k in out: out[k] = number(out[k])
    for k in ('figure','region','name','material','note'):
        out[k] = str(out.get(k) or '')[:8000]
    if 'quantity' not in out: out['quantity']=1
    unit_raw=str(out.get('unit') or '㎡')
    if unit_raw.lower() in ('mm','毫米'):
        out['note']+='；原表规格单位mm，收费口径待确认';out['unit']='待确认';out['calc_mode']='pending';out['risk']='高'
    else:out['unit'] = unit_raw.replace('M','m').replace('m²','㎡').replace('m2','㎡').replace('m','米')
    if out['unit'] not in UNITS:
        if '待核' in out['unit'] or '/' in out['unit'] or out['unit'] in ('米米','毫米'):
            out['note']+='；原计价单位：'+out['unit'];out['unit']='待确认';out['calc_mode']='pending';out['risk']='高'
        else:raise ValueError(f"不支持单位：{out['unit']}，请先确认计价单位")
    out['risk'] = str(out.get('risk') or '中').replace('HIGH','高').replace('MEDIUM','中').replace('LOW','低')
    if not out['name'] or not out['figure']: raise ValueError('部件名称和图号不能为空')
    if out.get('bounds') is not None:
        if not isinstance(out['bounds'],list) or len(out['bounds'])!=4 or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in out['bounds']):raise ValueError('图框位置必须为四个有效坐标')
        x,y,X,Y=out['bounds']
        if x>=X or y>=Y:raise ValueError('图框范围为空或颠倒')
    if '电视柜' in out['name'] and out['unit']=='米': out['risk']='高'
    if not out.get('calc_mode'):
        out['calc_mode'] = 'rect' if out['unit']=='㎡' else 'length' if out['unit']=='米' else 'count'
        if out['unit']=='㎡' and out.get('area') is not None and any(out.get(k) is None for k in ('height','length','quantity')):out['calc_mode']='manual'
        if out['unit']=='米' and out.get('total_length') is not None and any(out.get(k) is None for k in ('length','quantity')):out['calc_mode']='manual'
        if out['unit']=='㎡' and out.get('area') is not None and out.get('height') is not None and out.get('length') is not None:
            expected=out['height']*out['length']*out['quantity']/1e6 if out.get('quantity') is not None else None
            if expected is None or abs(expected-out['area'])>0.00001 and round(expected,2)!=round(out['area'],2): out['calc_mode']='manual'
    return out

def calculate(row, customer_type='C'):
    out = dict(row)
    if row.get('excluded'):
        return {**out, 'area':None,'total_length':None,'amount':None,'calculation':'本项不计价'}
    qty=number(row.get('quantity'))
    mode=row.get('calc_mode', 'rect')
    if mode not in {'rect','length','count','confirmed_rect','confirmed_length','confirmed_count','manual','pending'}:raise ValueError('未知计算方式，不能自动算量')
    if mode=='pending':return {**out,'amount':None,'calculation':'计价口径待确认，不能完成审核'}
    if customer_type=='B' and mode not in {'confirmed_rect','confirmed_length','confirmed_count','manual'}:
        return {**out,'amount':None,'calculation':'B端计价口径待老师傅确认；保留导入工程量'}
    mode=mode.removeprefix('confirmed_')
    unit=row.get('unit')
    if unit=='㎡' and mode not in ('rect','manual') or unit=='米' and mode not in ('length','manual') or unit not in ('㎡','米','待确认') and mode!='count':raise ValueError('计价单位与计算方式不匹配')
    h,l=number(row.get('height')),number(row.get('length'))
    out['area']=None; out['total_length']=None
    base=None
    if row.get('unit')=='待确认':return {**out,'amount':None,'calculation':'原单位有冲突，待确认计价口径'}
    if row.get('unit')=='米':
        if mode=='manual': base=number(row.get('total_length'))
        elif l is not None and qty is not None: base=float(Decimal(str(l))*Decimal(str(qty))/1000)
        out['total_length']=base; text='长度 × 数量 ÷ 1000（米）' if mode!='manual' else '人工核定总长（米）'
    elif row.get('unit')=='㎡':
        if mode=='manual': base=number(row.get('area')); text='人工核定展开/扣除面积（㎡）'
        elif h is not None and l is not None and qty is not None:
            base=float(Decimal(str(h))*Decimal(str(l))*Decimal(str(qty))/1000000); text='高度 × 长度 × 数量 ÷ 1000000（㎡）'
        else: text='缺少高度、长度或数量，待补测'
        floor=number(row.get('minimum_area'))
        if floor and base is not None: base=max(base,floor); text+=f'；本项经确认最低按{floor:g}㎡计'
        out['area']=base
    else: base=qty; text='数量计价'
    price=number(row.get('price'))
    out['amount']=float(Decimal(str(base))*Decimal(str(price))) if base is not None and price is not None else None
    out['calculation']=text + ('；单价未填' if price is None else '')
    return out

def differences(ai, ref):
    if ai is None: return ['疑似漏项']
    if ref is None: return ['疑似多项']
    results=[]
    for fields,label in [(('height','length','width','thickness','quantity'),'尺寸差异'),(('unit',),'计价差异'),(('material',),'材料差异'),(('price',),'单价差异'),(('area','total_length'),'工程量差异'),(('name',),'名称差异')]:
        for f in fields:
            a,b=ai.get(f),ref.get(f)
            same=(a in (None,'') and b in (None,'')) or a==b
            if isinstance(a,(int,float)) and isinstance(b,(int,float)): same=abs(a-b)<1e-6
            if not same: results.append(label); break
    return results

def parse_rows(content, filename, allow_no_figure=False, confirm_spec_units=False):
    import io,json
    def intake(raw):
        raw=dict(raw)
        billing=raw.get('billing_unit',raw.get('计价单位'))
        if billing not in (None,''):raw['unit']=billing
        if allow_no_figure and not (raw.get('figure') or raw.get('图号')):
            raw['figure']='待配图';raw['risk']='高';raw['note']=str(raw.get('note',''))+'；原人工表没有图号，待确认部件与图纸配对'
        spec=str(raw.get('unit',raw.get('单位',''))).lower()
        if confirm_spec_units and spec in ('mm','毫米'):
            area=number(raw.get('area',raw.get('面积')));length=number(raw.get('total_length',raw.get('总长')))
            raw['note']=str(raw.get('note',''))+'；原规格单位mm；导入时确认按工程量列解释计价单位'
            if area is not None and length is None:raw['unit']='㎡'
            elif length is not None and area is None:raw['unit']='米'
        return normalize(raw)
    if filename.lower().endswith('.json'):
        data=json.loads(content.decode('utf-8-sig'))
        rows=data if isinstance(data,list) else data.get('rows',data.get('行',[]))
        if not isinstance(rows,list): raise ValueError('JSON需要rows数组')
        return [intake(r) for r in rows], []
    if not filename.lower().endswith('.xlsx'): raise ValueError('请上传JSON或xlsx文件')
    from openpyxl import load_workbook
    wb=load_workbook(io.BytesIO(content),data_only=True)
    rows=[]; warnings=[]
    for ws in wb.worksheets:
        vals=list(ws.values); header=None; mapping={}
        for i,rr in enumerate(vals[:30]):
            if any(v in ('部件名称','名称') for v in rr):
                header=i
                for j,v in enumerate(rr):
                    if v in ALIASES: mapping[j]=ALIASES[v]
                for sub in vals[i+1:i+3]:
                    for j,v in enumerate(sub):
                        if v in ALIASES and j not in mapping:mapping[j]=ALIASES[v]
                break
        if header is None: warnings.append(f'{ws.title}未找到表头，未导入'); continue
        if not {'name'}<=set(mapping.values()) or not allow_no_figure and 'figure' not in mapping.values():
            warnings.append(f'{ws.title}缺少图号或部件名称列，未导入'); continue
        previous={}
        for ix,rr in enumerate(vals[header+1:],header+2):
            raw={k:rr[j] for j,k in mapping.items() if j<len(rr)}
            if not raw.get('name') or raw.get('name') in ('名称','部件名称','合计','木作合计','总计'): continue
            if str(raw.get('name')).startswith('='): continue
            for k in ('figure','region'):
                if raw.get(k) in (None,''): raw[k]=previous.get(k)
                else: previous[k]=raw[k]
            if raw.get('figure')=='图号': continue
            try: rows.append(intake(raw))
            except (ValueError,TypeError) as e: raise ValueError(f'{ws.title}第{ix}行：{e}') from e
    if not rows: raise ValueError('没有可导入的明细行；需要图号和部件名称列，不能用序号猜图号')
    return rows,warnings
