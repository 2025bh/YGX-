"""Question cards refer to frozen inputs. Only confirmed answers change adopted data."""
import hashlib,json
from fastapi import Depends,HTTPException,UploadFile,File
from pydantic import BaseModel,Field
from .app import app,db,project,row_view,master,user,uid,now,dumps,correct,Correction,review_source
from .domain import calculate,key,natural

FIELDS={'height':'高度','length':'长度','width':'宽度','thickness':'厚度','quantity':'数量','unit':'计价单位','material':'材料','price':'单价','name':'部件名称','area':'面积','total_length':'总长'}

def source_version(c,pid):
    return review_source(c,pid)

def queue(c,pid):
    p=project(c,pid)
    rows=[row_view(r,p) for r in c.execute("SELECT * FROM rows WHERE project_id=? AND status!='superseded'",(pid,)).fetchall()]
    source=source_version(c,pid)
    unmatched=[r for r in rows if not r['ai'] and r['reference']]
    checked={r['row_id'] for r in c.execute('SELECT row_id FROM pair_checks WHERE source=?',(source,))}
    pairs={};held=set()
    for r in rows:
        if r['ai'] and not r['reference'] and r['id'] not in checked and r['status']!='resolved':
            a=r['ai'];same=[x for x in unmatched if x['reference']['figure']==a['figure']]
            unknown=[x for x in unmatched if x['reference']['figure']=='待配图' and (x['reference']['region']==a['region'] or not x['reference']['region'])]
            named=[x for x in unknown if key(x['reference'])[2]==key(a)[2]]
            candidates=([x for x in same if x['reference']['region']==a['region']] or same) or named or unknown
            if candidates:pairs[r['id']]=candidates;held.update(x['id'] for x in candidates)
    cards=[]
    labels={'pair':'这两行是不是同一个部件？','missing':'AI是否漏了这个报价项目？','extra':'这个项目确实存在并需要报价吗？','difference':'这些数据应该采用哪一组？','verify':'请核对本项是否完整、计价是否正确'}
    for r in rows:
        if r['id'] in held:continue
        a,b=r['ai'],r['reference']
        kind='pair' if r['id'] in pairs else 'missing' if not a and b else 'extra' if a and not b and p['has_reference'] else 'difference' if r['diffs'] else 'verify'
        changes=[]
        if a and b:
            for field,label in FIELDS.items():
                av,bv=a.get(field),b.get(field)
                if av==bv or av in (None,'') and bv in (None,''):continue
                rounding=field in ('area','total_length') and isinstance(av,(int,float)) and isinstance(bv,(int,float)) and round(av,2)==round(bv,2)
                changes.append({'field':field,'label':label,'ai':av,'reference':bv,'rounding_only':rounding})
        if kind=='difference' and changes and all(x['rounding_only'] for x in changes):kind='verify'
        v=r['adopted'];base=v.get('area') if v['unit']=='㎡' else v.get('total_length') if v['unit']=='米' else v.get('quantity')
        incomplete=not v.get('excluded') and (base is None or v['calc_mode']=='pending' or v['unit']=='待确认' or p['customer_type']=='B' and v['calc_mode'] not in ('manual','confirmed_rect','confirmed_length','confirmed_count'))
        if p['has_reference'] and kind=='verify' and r['status']=='pending' and not incomplete:continue
        latest=c.execute('SELECT reason FROM corrections WHERE row_id=? ORDER BY created DESC LIMIT 1',(r['id'],)).fetchone()
        cards.append({'id':r['id'],'row':r,'kind':kind,'title':labels[kind],'last_note':latest['reason'] if latest else '','changes':changes,'candidates':pairs.get(r['id'],[]),'source':source,'status':'done' if r['status']=='resolved' else 'waiting' if r['status']=='waiting' else 'pending'})
    cards.sort(key=lambda q:(natural(q['row']['adopted']['figure']),q['kind']!='pair',q['id']))
    grouped={}
    for r in rows:
        v=r['adopted'];fk=dumps([v['figure'],v.get('frame_index'),v.get('frame_handle')]);grouped.setdefault(fk,[]).append(r)
    inventory=c.execute('SELECT * FROM drawing_inventory WHERE project_id=?',(pid,)).fetchone()
    inventory_valid=bool(inventory and inventory['source_sha']==p['source_sha'])
    metadata={}
    if inventory_valid:
        for f in json.loads(inventory['frames']):
            fk=dumps([f['figure'],f['index'],f.get('handle')])
            linked=[r for r in rows if r['adopted'].get('frame_index')==f['index']]
            if not linked:linked=grouped.get(fk,[])
            grouped[fk]=linked;metadata[fk]=f
        linked_ids={r['id'] for fk,rr in grouped.items() if fk in metadata for r in rr}
        grouped={fk:rr for fk,rr in grouped.items() if fk in metadata or any(r['id'] not in linked_ids for r in rr)}
    frames=[]
    for fk,rr in grouped.items():
        meta=metadata.get(fk);figure=meta['figure'] if meta else rr[0]['adopted']['figure']
        signature=hashlib.sha256(dumps([source,p['source_sha'],meta,[(r['id'],r['version'],r['status'],{k:v for k,v in r['adopted'].items() if k not in ('pdf','images')}) for r in sorted(rr,key=lambda x:x['id'])]]).encode()).hexdigest()
        check=c.execute('SELECT * FROM frame_checks WHERE project_id=? AND frame_key=?',(pid,fk)).fetchone()
        drawing={'figure':figure,'name':'图框查漏','region':'','unit':'㎡','quantity':1,'material':'','risk':'中','calc_mode':'pending','bounds':meta['bounds'],'frame_index':meta['index'],'pdf':p.get('previews',{}).get(meta['index']),'images':[p['preview_images'][meta['index']]] if meta['index'] in p.get('preview_images',{}) else []} if meta else rr[0]['adopted']
        frames.append({'key':fk,'figure':figure,'rows':rr,'drawing':drawing,'signature':signature,'status':check['status'] if check and check['signature']==signature else 'pending','note':check['note'] if check else ''})
    frames.sort(key=lambda f:natural(f['figure']))
    pending=sum(x['status']=='pending' for x in cards);waiting=sum(x['status']=='waiting' for x in cards)
    coverage='完整CAD图框清单' if inventory_valid and inventory['complete'] else '仅已列报价图号；尚未确认完整CAD图框清单'
    listed_complete=not pending and not waiting and all(f['status']=='done' for f in frames)
    return {'cards':cards,'frames':frames,'coverage':coverage,'coverage_complete':bool(inventory_valid and inventory['complete']),'has_reference':bool(p['has_reference']),'pending':pending,'waiting':waiting,'completed':sum(x['status']=='done' for x in cards),'stage':'cards' if pending else 'frames','listed_complete':listed_complete,'finished':listed_complete and bool(inventory_valid and inventory['complete']),'source':source}

class Inventory(BaseModel):
    source_sha:str
    complete:bool=False
    frames:list[dict]=Field(max_length=1000)

@app.post('/api/projects/{pid}/frames')
def inventory(pid:str,b:Inventory,u=Depends(master)):
    from .domain import normalize
    seen=set();clean=[]
    for f in b.frames:
        try:
            normalize({'figure':f['figure'],'name':'图框','bounds':f['bounds']})
            index=int(f['index'])
            if index<1 or index in seen:raise ValueError('图框序号无效或重复')
            seen.add(index);clean.append({'index':index,'figure':str(f['figure']),'bounds':f['bounds'],'handle':f.get('handle')})
        except (KeyError,ValueError,TypeError) as e:raise HTTPException(422,str(e))
    with db() as c:
        c.execute('BEGIN IMMEDIATE');p=project(c,pid)
        if not p['source_sha'] or b.source_sha!=p['source_sha']:raise HTTPException(409,'图框清单与CAD源版本不一致')
        c.execute('INSERT OR REPLACE INTO drawing_inventory VALUES (?,?,?,?)',(pid,b.source_sha,int(b.complete),dumps(sorted(clean,key=lambda f:f['index']))))
    return {'saved':True,'count':len(clean)}

@app.get('/api/projects/{pid}/review')
def review(pid:str,u=Depends(user)):
    with db() as c:return queue(c,pid)

@app.post('/api/projects/{pid}/quantity-preview')
def quantity_preview(pid:str,b:dict,u=Depends(master)):
    from .domain import normalize
    with db() as c:p=project(c,pid)
    try:return calculate({**normalize(b),'excluded':bool(b.get('excluded'))},p['customer_type'])
    except (ValueError,TypeError) as e:raise HTTPException(422,str(e))

@app.post('/api/projects/{pid}/drawing')
async def attach_drawing(pid:str,file:UploadFile=File(...),u=Depends(master)):
    from .app import upload_bytes,store_asset
    if not (file.filename or '').lower().endswith('.dwg'):raise HTTPException(422,'请提供与本次识别同版的DWG')
    content=await upload_bytes(file,100_000_000)
    if not content[:6].startswith(b'AC10'):raise HTTPException(422,'DWG文件头无法识别')
    sha=hashlib.sha256(content).hexdigest()
    with db() as c:
        c.execute('BEGIN IMMEDIATE');p=project(c,pid)
        if p['source_sha']:
            if p['source_sha']==sha:return {'saved':True,'duplicate':True,'sha':sha}
            raise HTTPException(409,'本项目已绑定其他版本，请为新图纸创建新项目')
        aid=store_asset(content,'source.dwg','application/octet-stream',pid,c)
        c.execute('UPDATE projects SET source_sha=?,source_asset=? WHERE id=?',(sha,aid,pid))
    return {'saved':True,'sha':sha}

class Answer(BaseModel):
    action:str
    expected_version:int
    request_id:str=Field(min_length=8,max_length=100)
    note:str=Field(default='',max_length=8000)
    adopted:dict|None=None
    evidence:list[dict]=Field(default_factory=list,max_length=20)
    source:str=''
    target_id:str=''
    target_version:int|None=None

@app.post('/api/rows/{rid}/answer')
def answer(rid:str,b:Answer,u=Depends(master)):
    if b.action not in ('ai','reference','custom','waiting','exclude','distinct','pair'):raise HTTPException(422,'请选择本题处理方式')
    with db() as c:
        r=c.execute('SELECT * FROM rows WHERE id=?',(rid,)).fetchone()
        if not r or r['status']=='superseded':raise HTTPException(404,'题目已失效，请重新打开队列')
        p=project(c,r['project_id']);fingerprint=hashlib.sha256(dumps([rid,b.model_dump()]).encode()).hexdigest()
        prior=c.execute('SELECT * FROM mutation_requests WHERE id=?',(b.request_id,)).fetchone()
        if prior:
            if prior['digest']!=fingerprint or prior['user_id']!=u['id']:raise HTTPException(409,'答题内容已改变，请重新确认')
            return {**json.loads(prior['result']),'duplicate':True}
        if b.source!=source_version(c,p['id']):raise HTTPException(409,'来源报价已换版，请重新打开本题')
        prior_c=c.execute('SELECT 1 FROM corrections WHERE request_id=?',(b.request_id,)).fetchone()
        if r['version']!=b.expected_version and not prior_c:raise HTTPException(409,'本题刚被修改，请刷新后重新判断')
    if b.action in ('pair','distinct'):
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT * FROM rows WHERE id=?',(rid,)).fetchone()
            if r['version']!=b.expected_version or b.source!=source_version(c,p['id']):raise HTTPException(409,'题目已变化')
            if b.action=='pair':
                target=c.execute('SELECT * FROM rows WHERE id=?',(b.target_id,)).fetchone()
                if not r['ai'] or r['reference'] or not target or target['project_id']!=p['id'] or target['ai'] or not target['reference'] or target['status']=='superseded':raise HTTPException(422,'请选择本项目未配对的人工报价行')
                if target['version']!=b.target_version:raise HTTPException(409,'对应行已变化，请刷新')
                ref=json.loads(target['reference'])
                if ref['figure']=='待配图':ref={**ref,'figure':json.loads(r['ai'])['figure']}
                c.execute("UPDATE rows SET reference=?,version=version+1,status='pending' WHERE id=?",(dumps(ref),rid))
                c.execute("UPDATE rows SET status='superseded',version=version+1 WHERE id=?",(target['id'],))
                c.execute('INSERT OR REPLACE INTO pair_bindings VALUES (?,?)',(rid,dumps(key(json.loads(target['reference'])))))
            else:
                c.execute('INSERT OR IGNORE INTO pair_checks VALUES (?,?)',(rid,b.source))
                c.execute('UPDATE rows SET version=version+1 WHERE id=?',(rid,))
            result={'saved':True,'action':b.action}
            c.execute('INSERT INTO mutation_requests VALUES (?,?,?,?,?)',(b.request_id,u['id'],'answer',fingerprint,dumps(result)))
        return result
    v=row_view(r,p)['adopted']
    if b.action in ('custom','waiting'):v={**v,**(b.adopted or {})}
    if b.action in ('ai','reference'):
        candidate=r[b.action]
        if not candidate:raise HTTPException(422,'该题没有这一方数据')
        v={**row_view(r,p)[b.action],**{k:v[k] for k in ('images','pdf','bounds','handles','frame_index','frame_handle','source_evidence') if k in v}}
    if b.action=='exclude':v['excluded']=True
    choices={'ai':'老师傅确认采用AI数据','reference':'老师傅确认采用对照数据','custom':'老师傅修改本次确认数据','waiting':'老师傅指出问题，待进一步复核','exclude':'老师傅确认本项不计价'}
    if b.action=='custom' and not b.note.strip():raise HTTPException(422,'请用一句话说明这次修改')
    reason=b.note.strip() or choices[b.action]
    try:method=calculate(v,p['customer_type']).get('calculation','')
    except ValueError as e:raise HTTPException(422,str(e))
    result=correct(rid,Correction(expected_version=b.expected_version,request_id=b.request_id,adopted=v,status='waiting' if b.action=='waiting' else 'resolved',reason=reason,reading=b.note,pricing=method,error_type='待查' if b.action=='waiting' else '项目纠错',evidence=b.evidence,scope='project',source=b.source),u)
    with db() as c:c.execute('INSERT OR IGNORE INTO mutation_requests VALUES (?,?,?,?,?)',(b.request_id,u['id'],'answer',fingerprint,dumps({'saved':True,'action':b.action})))
    return result

class FrameAnswer(BaseModel):
    key:str
    signature:str
    status:str='done'
    note:str=Field(default='',max_length=8000)

@app.post('/api/projects/{pid}/frame-review')
def frame_answer(pid:str,b:FrameAnswer,u=Depends(master)):
    if b.status not in ('done','waiting'):raise HTTPException(422,'逐图审核状态无效')
    with db() as c:
        c.execute('BEGIN IMMEDIATE');q=queue(c,pid)
        f=next((f for f in q['frames'] if f['key']==b.key),None)
        if not f or f['signature']!=b.signature:raise HTTPException(409,'本图部件或来源已变化，请重新核对')
        if b.status=='done' and not f['rows'] and not b.note.strip():raise HTTPException(422,'请确认本图无独立报价部件，或先补入漏项')
        unresolved=[x for x in q['cards'] if x['row']['id'] in {r['id'] for r in f['rows']} and x['status']!='done']
        paired_ids={r['id'] for card in q['cards'] if card['kind']=='pair' and card['status']!='done' for r in card['candidates']}
        if b.status=='done' and any(r['id'] in paired_ids for r in f['rows']):raise HTTPException(422,'本图有待配对的人工报价行')
        if b.status=='done' and unresolved:raise HTTPException(422,'本图仍有未处理或待查题目，请先完成')
        if b.status=='done':
            for r in f['rows']:
                v=r['adopted'];base=v.get('area') if v['unit']=='㎡' else v.get('total_length') if v['unit']=='米' else v.get('quantity')
                if not v.get('excluded') and (v['figure']=='待配图' or v['figure'].startswith('待核')):raise HTTPException(422,'本图仍有未确认绿色图号的部件')
                if not v.get('excluded') and (base is None or v['unit']=='待确认' or v['calc_mode']=='pending' or p_type(c,pid)=='B' and v['calc_mode'] not in ('manual','confirmed_rect','confirmed_length','confirmed_count')):raise HTTPException(422,'本图仍有缺工程量或未确认计价口径的部件')
                if r['status']!='resolved':
                    c.execute("UPDATE rows SET status='resolved',version=version+1,updated=? WHERE id=?",(now(),r['id']))
            f=next(x for x in queue(c,pid)['frames'] if x['key']==b.key)
        c.execute('INSERT OR REPLACE INTO frame_checks VALUES (?,?,?,?,?,?,?)',(pid,b.key,f['signature'],b.status,b.note,'[]',now()))
    return {'saved':True}

def p_type(c,pid):return project(c,pid)['customer_type']

class FrameCAD(BaseModel):
    frame_key:str
    signature:str
    device_id:str

@app.post('/api/projects/{pid}/frame-cad')
def frame_cad(pid:str,b:FrameCAD,u=Depends(master)):
    with db() as c:
        p=project(c,pid);q=queue(c,pid);f=next((f for f in q['frames'] if f['key']==b.frame_key),None)
        d=c.execute('SELECT * FROM devices WHERE id=? AND user_id=?',(b.device_id,u['id'])).fetchone()
        if not d or d['last_seen']<now()-20:raise HTTPException(409,'请先启动本机CAD连接助手')
        if not f or f['signature']!=b.signature or not f['drawing'].get('bounds') or not p['source_asset']:raise HTTPException(409,'本图缺少同版定位数据或已变化')
        payload={'action':'open','project':pid,'source_asset':p['source_asset'],'source_sha':p['source_sha'],'review_source':review_source(c,pid),'bounds':f['drawing']['bounds'],'figure':f['figure'],'component':'整图查漏','handles':[],'row_version':0}
        job=uid();c.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',(job,b.device_id,None,dumps(payload),'queued',None,now()))
    return {'job':job}

class Undo(BaseModel):
    expected_version:int
    request_id:str=Field(min_length=8,max_length=100)

@app.post('/api/rows/{rid}/undo')
def undo(rid:str,b:Undo,u=Depends(master)):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        digest=hashlib.sha256(dumps([rid,b.model_dump()]).encode()).hexdigest()
        prev=c.execute('SELECT * FROM mutation_requests WHERE id=?',(b.request_id,)).fetchone()
        if prev:
            if prev['digest']!=digest or prev['user_id']!=u['id']:raise HTTPException(409,'撤销请求冲突')
            return {**json.loads(prev['result']),'duplicate':True}
        r=c.execute('SELECT * FROM rows WHERE id=?',(rid,)).fetchone()
        if not r or r['status']=='superseded' or r['version']!=b.expected_version:raise HTTPException(409,'本题已变化，请刷新')
        e=c.execute("SELECT * FROM review_events WHERE row_id=? ORDER BY created DESC LIMIT 1",(rid,)).fetchone()
        if not e or e['kind']!='correction' or e['expected_after_version']!=r['version']:raise HTTPException(409,'没有可撤销的最新确认；历史记录仍可查看')
        prior=json.loads(e['before_value'])
        c.execute('UPDATE rows SET adopted=?,status=?,version=version+1,updated=? WHERE id=?',(prior['adopted'],prior['status'],now(),rid))
        c.execute('INSERT INTO review_events VALUES (?,?,?,?,?,?,?,?,?,?)',(uid(),rid,r['project_id'],'undo',dumps(dict(r)),prior['adopted'],r['version']+1,u['id'],b.request_id,now()))
        for rule in c.execute('SELECT id,content FROM rules WHERE correction_id IN (SELECT id FROM corrections WHERE request_id=?)',(e['request_id'],)).fetchall():
            value=json.loads(rule['content']);value['status']='WITHDRAWN'
            c.execute("UPDATE rules SET status='WITHDRAWN',content=? WHERE id=?",(dumps(value),rule['id']))
        result={'saved':True};c.execute('INSERT INTO mutation_requests VALUES (?,?,?,?,?)',(b.request_id,u['id'],'undo',digest,dumps(result)))
    from .app import sync_rules
    sync_rules(u);return result
