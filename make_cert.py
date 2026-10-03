"""
Generate a self-signed TLS certificate for Vectis direct-HTTPS mode.

    python make_cert.py                 # cert for "localhost"
    python make_cert.py your-domain.com # cert for a domain / hostname

Writes certs/cert.pem and certs/key.pem next to this file. server.py picks them
up automatically and serves HTTPS.

NOTE: a self-signed cert encrypts traffic but browsers show a "not trusted"
warning, because no public authority vouches for it. That's acceptable for a
closed LAN or testing. For a public website, use a real certificate for your
domain (e.g. from Let's Encrypt / your hosting provider) and point
VECTIS_CERT / VECTIS_KEY at it, or just drop it in as certs/cert.pem + key.pem.
"""
import os
import sys
import datetime
import ipaddress

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

host = sys.argv[1] if len(sys.argv) > 1 else 'localhost'
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
os.makedirs(out_dir, exist_ok=True)

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

# Subject Alternative Names: the hostname, plus localhost loopbacks.
alt_names = [x509.DNSName(host)]
if host != 'localhost':
    alt_names.append(x509.DNSName('localhost'))
try:
    alt_names.append(x509.IPAddress(ipaddress.ip_address(host)))
except ValueError:
    pass
alt_names.append(x509.IPAddress(ipaddress.ip_address('127.0.0.1')))

subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Vectis'),
    x509.NameAttribute(NameOID.COMMON_NAME, host),
])

now = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(days=1))
    .not_valid_after(now + datetime.timedelta(days=825))
    .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
    .sign(key, hashes.SHA256())
)

cert_path = os.path.join(out_dir, 'cert.pem')
key_path = os.path.join(out_dir, 'key.pem')

with open(cert_path, 'wb') as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))
with open(key_path, 'wb') as f:
    f.write(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))

print(f'Wrote {cert_path}')
print(f'Wrote {key_path}')
print(f'Certificate is valid for: {host}')
print('Restart the server (python server.py) — it will now serve HTTPS.')
