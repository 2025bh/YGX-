"""Import a version-bound frame inventory. Ambiguous green numbers stay unresolved."""
import argparse,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.app import db,project
from backend.review import inventory,Inventory

def import_frames(pid,path,complete=False):
    content=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    with db() as c:p=project(c,pid)
    if isinstance(content,dict):
        return inventory(pid,Inventory(**content),{'id':'local-admin','role':'admin'})
    frames=[];ambiguous=0
    for f in content:
        figures=list(dict.fromkeys(x for x in f.get('figure_candidates',[]) if re.fullmatch(r'\d{1,3}(?:-\d{1,3})?',x)))
        figure=figures[0] if len(figures)==1 else f"图框{f['index']}（图号待核）"
        if len(figures)!=1:ambiguous+=1
        frames.append({'index':f['index'],'figure':figure,'handle':f.get('handle'),'bounds':f['bounds']})
    result=inventory(pid,Inventory(source_sha=p['source_sha'],complete=complete and not ambiguous,frames=frames),{'id':'local-admin','role':'admin'})
    return {**result,'ambiguous_numbers':ambiguous,'coverage_confirmed':complete and not ambiguous}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('project');parser.add_argument('manifest');parser.add_argument('--complete',action='store_true');a=parser.parse_args()
    print(json.dumps(import_frames(a.project,a.manifest,a.complete),ensure_ascii=False))
