"""Native DWG plotting on disposable, hash-checked copies only."""
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
from .app import db,DATA,ROOT,store_asset,dumps,now

def find_console():
    if os.environ.get('QUOTE_ACCORE'):return Path(os.environ['QUOTE_ACCORE'])
    direct=shutil.which('accoreconsole.exe')
    if direct:return Path(direct)
    if os.name=='nt':
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\Autodesk\AutoCAD\R24.0') as root:
                i=0
                while True:
                    try:name=winreg.EnumKey(root,i);i+=1
                    except OSError:break
                    try:
                        with winreg.OpenKey(root,name) as child:folder=winreg.QueryValueEx(child,'AcadLocation')[0]
                        path=Path(folder)/'accoreconsole.exe'
                        if path.exists():return path
                    except OSError:pass
        except OSError:pass
    return Path(os.environ.get('ProgramFiles',''))/'Autodesk/AutoCAD 2021/accoreconsole.exe'

def render_frames(pid=None,indexes=None):
    from pypdf import PdfReader
    acad=find_console()
    if not acad.exists():raise RuntimeError('未找到AutoCAD2021核心控制台，请设置QUOTE_ACCORE')
    with db() as c:
        found=c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone() if pid else c.execute('SELECT * FROM projects WHERE source_asset IS NOT NULL ORDER BY created DESC LIMIT 1').fetchone()
        if not found:raise RuntimeError('请先导入同版DWG及图框位置')
        p=dict(found);pid=p['id']
        source=dict(c.execute('SELECT * FROM assets WHERE id=?',(p['source_asset'],)).fetchone())
        rr=[dict(r) for r in c.execute('SELECT * FROM rows WHERE project_id=?',(pid,))]
        inventory=c.execute('SELECT frames,source_sha FROM drawing_inventory WHERE project_id=?',(pid,)).fetchone()
    original=DATA/source['path'];before=hashlib.sha256(original.read_bytes()).hexdigest()
    if before!=p['source_sha']:raise RuntimeError('源版本校验失败')
    chosen={}
    if inventory and inventory['source_sha']==p['source_sha']:
        for f in json.loads(inventory['frames']):
            if not indexes or f['index'] in indexes:chosen[f['index']]=f['bounds']
    for r in rr:
        v=json.loads(r['adopted']);n=v.get('frame_index')
        if n and (not indexes or n in indexes):chosen[n]=v['bounds']
    work=DATA/'native'/str(int(now()));work.mkdir(parents=True,exist_ok=True)
    working=work/'drawing.dwg';shutil.copy2(original,working)
    script=['(setvar "FILEDIA" 0)','(setvar "CMDDIA" 0)','(setvar "OSMODE" 0)','(setvar "BACKGROUNDPLOT" 0)','(setvar "PDFSHX" 0)']
    for n,bounds in chosen.items():
        x,y,X,Y=bounds
        script+=['_.-PLOT','_Y','Model','DWG To PDF.pc3','','_M','_L','_N','_W',f'{x},{y}',f'{X},{Y}','_F','_C','_Y','','_Y','_A',str(work/f'frame{n}.pdf').replace('\\','/'),'_N','_Y']
    script+=['_.QUIT','_Y','']
    scr=work/'plot.scr';scr.write_text('\n'.join(script),encoding='gb18030')
    try:
        result=subprocess.run([str(acad),'/i',str(working),'/s',str(scr),'/l','en-US'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=max(45,len(chosen)*20))
        code=result.returncode; output=result.stdout
    except subprocess.TimeoutExpired as exc:
        code=-1; output=exc.stdout or b''
    (work/'console.log').write_text(output.decode('utf-16le',errors='replace'),encoding='utf-8')
    rendered=[]
    with db() as c:
        for n in chosen:
            pdf=work/f'frame{n}.pdf'
            if not pdf.exists() or pdf.stat().st_size<500:continue
            reader=PdfReader(pdf)
            if not reader.pages:continue
            aid=store_asset(pdf.read_bytes(),f'CAD原生图{n}.pdf','application/pdf',pid,c)
            c.execute('INSERT INTO previews VALUES (?,?,?) ON CONFLICT(project_id,frame_index) DO UPDATE SET pdf_asset=excluded.pdf_asset',(pid,n,aid))
            rendered.append({'frame':n,'asset':aid,'bytes':pdf.stat().st_size,'pages':len(reader.pages),'fonts':list((reader.pages[0].get('/Resources') or {}).get('/Font',{}))})
    after=hashlib.sha256(original.read_bytes()).hexdigest()
    if before!=after:raise RuntimeError('源副本哈希变化')
    report={'requested':len(chosen),'rendered':rendered,'exit':code,'source_unchanged':before==after,'log':str(work/'console.log')}
    (work/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(render_frames(indexes=[int(x) for x in sys.argv[1:]] or None),ensure_ascii=False,indent=2))
