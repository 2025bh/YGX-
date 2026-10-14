"""Restore into a NEW data directory; never overwrite the live database."""
import argparse,sqlite3,zipfile,hashlib,json
from pathlib import Path
def restore(source:Path,target:Path):
    if target.exists():raise ValueError('恢复目标已存在；请选择新的空目录，原数据不覆盖')
    with zipfile.ZipFile(source) as z:
        allowed=[i for i in z.infolist() if i.filename=='review.sqlite3' or i.filename.startswith(('assets/','rules/','knowledge_snapshot/'))]
        if not any(i.filename=='review.sqlite3' for i in allowed):raise ValueError('备份缺少数据库')
        if sum(i.file_size for i in allowed)>2_000_000_000:raise ValueError('备份超过2GB，需管理员核查')
        for i in allowed:
            path=(target/i.filename).resolve()
            if not path.is_relative_to(target.resolve()):raise ValueError('备份路径异常')
        if 'manifest.json' in z.namelist():
            manifest=json.loads(z.read('manifest.json'))['sha256']
            for name in [i.filename for i in allowed if not i.is_dir()]:
                if name not in manifest or hashlib.sha256(z.read(name)).hexdigest()!=manifest[name]:raise ValueError('备份文件哈希不一致，未恢复')
        target.mkdir(parents=True)
        for i in allowed:
            dest=target/i.filename
            if i.is_dir():dest.mkdir(parents=True,exist_ok=True)
            else:dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(i))
    c=sqlite3.connect(target/'review.sqlite3')
    if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('数据库完整性检查失败，未切换主机数据')
    for (asset_path,) in c.execute('SELECT path FROM assets'):
        path=(target/asset_path).resolve()
        if not path.is_relative_to(target.resolve()/'assets') or not path.is_file():raise ValueError('备份中的证据或图纸缺失，未切换主机数据')
    c.close();return target
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('backup',type=Path);p.add_argument('new_directory',type=Path);a=p.parse_args();print(restore(a.backup,a.new_directory))
