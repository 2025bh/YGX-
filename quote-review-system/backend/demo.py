"""Fully fictional practice data; existing private projects are preserved."""
from .app import db,uid,now,dumps,add_snapshot
from .domain import normalize,calculate

def bootstrap():
    pid='practice-v2'
    with db() as c:
        if c.execute('SELECT 1 FROM projects WHERE id=?',(pid,)).fetchone():return {'seeded':False}
        c.execute('INSERT INTO projects (id,name,customer_type,demo,has_reference,created) VALUES (?,?,?,?,?,?)',(pid,'逐题练习 · 十种常见纠错','C',1,1,now()))
        common={'region':'模拟空间','height':2100,'length':1200,'width':500,'quantity':1,'unit':'㎡','material':'模拟木材A（非真实报价）','risk':'中','price':None}
        cases=[
            ('1','柜体高度',{'height':1900},{'height':2100}),
            ('2','书桌',{'height':790,'length':2800},{'unit':'米','calc_mode':'length'}),
            ('3','独立脚线',{'height':90,'length':3200},{'unit':'米','calc_mode':'length'}),
            ('4','格栅门工艺费',None,{'height':880,'length':420,'quantity':2}),
            ('5','贴墙布',{},None),
            ('6','完整材料名称',{'material':'模拟木材'},{'material':common['material']}),
            ('7','同件多个差异',{'height':2000,'length':1150,'quantity':1},{'height':2100,'length':1200,'quantity':2}),
            ('8','人工扣除护墙',{}, {'area':2.1,'calc_mode':'manual','note':'模拟展开扣除：2.52 - 0.42 = 2.10㎡'}),
            ('9','待补测柜',{'height':None},{'height':None}),
            ('10','同物异名',{}, {'name':'模拟衣柜别称'}),
        ]
        ai_rows=[];ref_rows=[]
        for fig,name,a,b in cases:
            ai=calculate(normalize({**common,'figure':fig,'name':name,**a})) if a is not None else None
            ref=calculate(normalize({**common,'figure':fig,'name':name,**b})) if b is not None else None
            if fig=='10':
                for kind,v in [('ai',ai),('reference',ref)]:
                    c.execute('INSERT INTO rows (id,project_id,ai,reference,adopted,updated) VALUES (?,?,?,?,?,?)',(uid(),pid,dumps(v) if kind=='ai' else None,dumps(v) if kind=='reference' else None,dumps(v),now()))
            else:c.execute('INSERT INTO rows (id,project_id,ai,reference,adopted,updated) VALUES (?,?,?,?,?,?)',(uid(),pid,dumps(ai) if ai else None,dumps(ref) if ref else None,dumps(ai or ref),now()))
            if ai:ai_rows.append(ai)
            if ref:ref_rows.append(ref)
        for kind,rows in [('ai',ai_rows),('reference',ref_rows)]:
            add_snapshot(c,pid,kind,'模拟练习_'+kind+'.json',dumps({'rows':rows}).encode(),rows)
    return {'seeded':True,'demo':True,'cases':10}
