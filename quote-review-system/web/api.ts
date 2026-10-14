export async function api<T=any>(path:string, options:RequestInit={}):Promise<T>{
  const r=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
  if(!r.ok){let message='操作失败，请重试';try{const j=await r.json();message=typeof j.detail==='string'?j.detail:'输入格式不正确，请检查字段';}catch{}throw new Error(message);}
  return r.json();
}
export const post=<T=any>(path:string,data:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(data)});
export const assetUrl=(id:string)=>'/api/assets/'+id;
export async function download(path:string,filename:string,method='GET'){
  const r=await fetch('/api'+path,{method,credentials:'same-origin'});if(!r.ok){const j=await r.json();throw new Error(j.detail||'下载失败');}
  const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const fmt=(x:unknown,digits=2)=>x===null||x===undefined||x===''?'—':typeof x==='number'?x.toLocaleString('zh-CN',{maximumFractionDigits:digits,minimumFractionDigits:digits}):String(x);
