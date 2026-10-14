import argparse,os,sys
from pathlib import Path
import uvicorn
from backend.demo import bootstrap

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--lan',action='store_true');args=parser.parse_args()
    bootstrap()
    config={}
    if args.lan:
        from backend.app import db,DATA
        with db() as c:ready=c.execute("SELECT 1 FROM users WHERE password!='' LIMIT 1").fetchone()
        if not ready:raise SystemExit('请先在本机审核台的账户设置中创建老师傅账户，再启动局域网版。')
        cert=DATA/'tls/server.pem';key=DATA/'tls/server-key.pem'
        if not cert.exists() or not key.exists():raise SystemExit('请先运行prepare_lan.py生成本地主机证书。')
        config={'ssl_certfile':str(cert),'ssl_keyfile':str(key)}
    uvicorn.run('backend.app:app',host='0.0.0.0' if args.lan else '127.0.0.1',port=4188,log_level='warning',**config)
