"""Create a fictional structural sample, never publish pseudonymous real records."""
import argparse,json
from pathlib import Path

def synthetic(data):
    raw=data if isinstance(data,list) else data.get('rows',[])
    rows=[]
    for i,item in enumerate(raw,1):
        unit=str(item.get('unit',item.get('单位','㎡')))
        if unit=='m':unit='米'
        if unit not in ('㎡','米','个','套','樘','根','扇'):unit='待确认'
        row={'figure':str((i-1)//3+1),'region':f'演示区域{(i-1)//3+1}','name':f'演示部件{i:03d}','material':'演示材料','height':2000+(i%4)*100,'length':1000+(i%5)*200,'width':500+(i%3)*50,'quantity':1,'unit':unit,'price':None,'risk':'中','calc_mode':'rect' if unit=='㎡' else 'length' if unit=='米' else 'pending' if unit=='待确认' else 'count'}
        rows.append(row)
    return {'data_classification':'SYNTHETIC','description':'名称、区域、材料、尺寸、数量和价格均已替换为模拟值，源文件与原始数据未发布，不能用于实际核价','customer_type':data.get('customer_type','C') if isinstance(data,dict) and data.get('customer_type') in ('C','B') else 'C','rows':rows}

def main():
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    if a.output.exists() or a.input.resolve()==a.output.resolve():raise SystemExit('输出必须是新的文件，不能覆盖输入或旧产物')
    data=json.loads(a.input.read_text(encoding='utf-8-sig'));out=synthetic(data);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'已生成{len(out["rows"])}条模拟结构；原始名称、数值、价格和证据未写入输出')
if __name__=='__main__':main()
