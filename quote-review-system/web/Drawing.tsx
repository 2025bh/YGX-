import {useEffect,useRef,useState} from 'react';
import {ZoomIn,ZoomOut,Maximize2,ImageIcon,ExternalLink,MousePointer2,Loader2,FileSearch} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {Quote} from './types';
import {assetUrl} from './api';
pdfjs.GlobalWorkerOptions.workerSrc=worker;

export function Blueprint({large=false}:{large?:boolean}){
  return <svg className={'blueprint '+(large?'large':'')} viewBox="0 0 400 240" fill="none" aria-hidden="true"><defs><pattern id="bp-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" stroke="currentColor" opacity=".1"/></pattern></defs><rect width="400" height="240" fill="url(#bp-grid)"/><g className="cabinet-lines" stroke="currentColor" strokeWidth="1.5"><path d="M98 47h206v151H98zM104 53h194v139H104zM169 53v139M232 53v139M104 104h194M104 153h194"/><path d="M112 61h49v35h-49zM178 61h46v35h-46zM241 61h49v35h-49zM112 112h49v32h-49zM178 112h46v32h-46zM241 112h49v32h-49z"/><path d="M137 167v12M200 167v12M266 167v12" strokeWidth="3"/><path d="M85 47v151M78 47h14M78 198h14M98 212h206M98 207v10M304 207v10" stroke="#3986f5"/><path d="M98 35h206M98 30v10M304 30v10" stroke="#3986f5"/></g><text x="201" y="30" textAnchor="middle" fill="currentColor" fontSize="9">DIMENSION / VERIFIED</text><rect className="scan-beam" x="98" y="50" width="206" height="2" fill="#3b82f6" opacity=".6"/><circle cx="322" cy="60" r="13" fill="#2569e9"/><path d="m316 60 4 4 8-8" stroke="white" strokeWidth="2"/></svg>
}

export function Drawing({quote,onCAD,busy}:{quote:Quote;onCAD:()=>void;busy:boolean}){
 const wrap=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [zoom,setZoom]=useState(1),[width,setWidth]=useState(700),[choice,setChoice]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const pdf=choice==='pdf'&&quote.pdf?quote.pdf:null;
 const image=choice&&choice!=='pdf'?choice:quote.images?.at(-1);
 useEffect(()=>{setZoom(1);setChoice(quote.pdf?'pdf':quote.images?.at(-1)||'');setError('');},[quote.figure,quote.pdf,quote.images?.join(',')]);
 useEffect(()=>{if(!wrap.current)return;const ob=new ResizeObserver(es=>setWidth(Math.max(240,es[0].contentRect.width-40)));ob.observe(wrap.current);return()=>ob.disconnect();},[]);
 useEffect(()=>{
   if(!pdf)return;
   let cancelled=false;let render:ReturnType<pdfjs.PDFPageProxy['render']>|null=null;
   setLoading(true);setError('');const task=pdfjs.getDocument({url:assetUrl(pdf),withCredentials:true});
   task.promise.then(async doc=>{const page=await doc.getPage(1);if(cancelled||!canvas.current)return;const initial=page.getViewport({scale:1});const viewport=page.getViewport({scale:width/initial.width*zoom});const ratio=Math.min(window.devicePixelRatio||1,2);canvas.current.width=viewport.width*ratio;canvas.current.height=viewport.height*ratio;canvas.current.style.width=viewport.width+'px';canvas.current.style.height=viewport.height+'px';render=page.render({canvasContext:canvas.current.getContext('2d')!,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});await render.promise;if(!cancelled)setLoading(false);}).catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException'){setError('高清PDF读取失败，可切换CAD原图或重试');setLoading(false);}});
   return()=>{cancelled=true;render?.cancel();void task.destroy();};
 },[pdf,width,zoom]);
 return <section className="drawing-panel" aria-label="图纸预览">
  <div className="panel-heading"><div><span className="eyebrow">DRAWING EVIDENCE</span><h3>图 {quote.figure}<span>{pdf?'CAD 原生矢量图':image?'CAD 原图预览':'证据预览'}</span></h3></div><button className="button soft compact" onClick={onCAD} disabled={busy}><ExternalLink size={15}/>{busy?'正在定位…':'本机 CAD'}</button></div>
  <div className="drawing-toolbar"><div className="view-options">{quote.pdf&&<button className={choice==='pdf'?'active':''} onClick={()=>setChoice('pdf')}>高清矢量</button>}{quote.images?.map((a,i)=><button key={a} className={choice===a?'active':''} onClick={()=>setChoice(a)}>原图 {i+1}</button>)}</div><div className="zoom-tools"><button title="缩小" aria-label="缩小图纸" onClick={()=>setZoom(z=>Math.max(.5,z-.25))}><ZoomOut size={17}/></button><span>{Math.round(zoom*100)}%</span><button title="放大" aria-label="放大图纸" onClick={()=>setZoom(z=>Math.min(5,z+.25))}><ZoomIn size={17}/></button><button title="适应窗口" aria-label="图纸适应窗口" onClick={()=>setZoom(1)}><Maximize2 size={16}/></button></div></div>
  <div className={'drawing-viewport '+(pdf?'pdf-view':'')} ref={wrap} onWheel={e=>{if(e.ctrlKey){e.preventDefault();setZoom(z=>Math.max(.5,Math.min(5,z+(e.deltaY<0?.15:-.15))));}}}>
   {loading&&<div className="canvas-loader"><Loader2 className="spin" size={22}/>正在读取高清图纸</div>}
   {error&&<div className="inline-error">{error}<button onClick={()=>{setChoice(image||'');}}>切换原图</button></div>}
   {pdf?<canvas ref={canvas}/>:image?<img src={assetUrl(image)} style={{width:width*zoom}} alt={'CAD原图，图号'+quote.figure}/>:<div className="drawing-empty"><Blueprint large/><h3>把问题留在图上</h3><p>此项尚无图纸附件，可在纠错时粘贴截图、标记位置。<br/>演示项目的尺寸只用于练习流程。</p></div>}
  </div>
  <div className="drawing-caption"><MousePointer2 size={14}/><span>{pdf?'矢量图随缩放重新绘制，可放大查看细小尺寸。':image?'原DWG出图；细小标注建议切换高清矢量或本机CAD。':'证据与当前图号、部件绑定保存。'}</span></div>
  <details className="source-details"><summary><FileSearch size={15}/>尺寸依据与原稿说明</summary><p>{quote.note||'暂无额外说明'}</p>{Boolean(quote.source_evidence)&&<pre>{typeof quote.source_evidence==='string'?quote.source_evidence:JSON.stringify(quote.source_evidence,null,2)}</pre>}<p>尺寸真值以同版CAD对象和完整尺寸链为依据；预览图片用于定位。</p></details>
 </section>
}
