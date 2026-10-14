"""Render native CAD PDFs for Excel reference images; no DXF redraw."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pymupdf as fitz
from backend.app import db,DATA,store_asset

def render(pid=None):
    with db() as c:
        q='SELECT p.project_id,p.frame_index,a.path FROM previews p JOIN assets a ON a.id=p.pdf_asset'
        entries=c.execute(q+(' WHERE p.project_id=?' if pid else ''),(pid,) if pid else ()).fetchall()
    count=0
    for entry in entries:
        with fitz.open(DATA/entry['path']) as document:
            image=document[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=False).tobytes('png')
        with db() as c:
            aid=store_asset(image,'CAD原生图框'+str(entry['frame_index'])+'.png','image/png',entry['project_id'],c)
            c.execute('INSERT OR REPLACE INTO preview_images VALUES (?,?,?)',(entry['project_id'],entry['frame_index'],aid))
        count+=1
    return {'native_pdf_images':count,'drawing_source_modified':False}

if __name__=='__main__':print(json.dumps(render(sys.argv[1] if len(sys.argv)>1 else None)))
