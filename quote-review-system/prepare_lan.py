"""Generate a private LAN CA without changing OS trust or firewall settings."""
import datetime,ipaddress,socket,os
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def prepare():
    folder=Path(os.environ.get('QUOTE_DATA_DIR',Path(__file__).parent/'data'))/'tls';folder.mkdir(parents=True,exist_ok=True)
    if (folder/'server.pem').exists():return '已有证书，保留原证书；网络地址变更请先核实再更新。'
    date=datetime.datetime.now(datetime.timezone.utc)
    ca_key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'YiGuXuan Local Quote CA')])
    ca=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(date-datetime.timedelta(minutes=5)).not_valid_after(date+datetime.timedelta(days=3650)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(ca_key,hashes.SHA256())
    server_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    ips={'127.0.0.1'}
    for item in socket.getaddrinfo(socket.gethostname(),None):
        try:
            address=ipaddress.ip_address(item[4][0])
            if address.version==4 and not address.is_link_local:ips.add(str(address))
        except ValueError:pass
    sans=[x509.DNSName('localhost'),x509.DNSName(socket.gethostname())]+[x509.IPAddress(ipaddress.ip_address(i)) for i in ips]
    server=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,socket.gethostname())])).issuer_name(name).public_key(server_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(date-datetime.timedelta(minutes=5)).not_valid_after(date+datetime.timedelta(days=365)).add_extension(x509.SubjectAlternativeName(sans),critical=False).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).sign(ca_key,hashes.SHA256())
    for fname,key in [('ca-key.pem',ca_key),('server-key.pem',server_key)]: (folder/fname).write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    (folder/'server.pem').write_bytes(server.public_bytes(serialization.Encoding.PEM))
    (folder/'忆古轩报价审核台_CA.cer').write_bytes(ca.public_bytes(serialization.Encoding.DER))
    return '已生成证书，尚未安装系统信任。主机地址：'+', '.join('https://'+i+':4188' for i in sorted(ips))

if __name__=='__main__':
    import sys;sys.stdout.reconfigure(encoding='utf-8');print(prepare())
