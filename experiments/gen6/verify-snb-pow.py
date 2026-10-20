#!/usr/bin/env python3
"""Independently rehash a solver's claimed work and ask the stock CLI to validate."""
import hashlib
import re
import struct
import subprocess
import sys

text = open(sys.argv[1]).read()
m = re.search(r'^SOLVED .*nonce=(0x[0-9a-f]+) h0=(0x[0-9a-f]+) '
              r'threshold=(0x[0-9a-f]+) root=([0-9a-fA-F]{64})$', text, re.M)
if not m:
    raise SystemExit('no SOLVED record')
nonce, claimed, threshold = (int(x, 16) for x in m.groups()[:3])
root = bytes.fromhex(m[4])
h = int.from_bytes(hashlib.blake2b(struct.pack('<Q', nonce) + root, digest_size=8).digest(), 'little')
if h != claimed or h < threshold:
    raise SystemExit('FAIL solver claim does not match hashlib or threshold')
print(f'PASS independent hashlib nonce={nonce:016x} h0={h:016x}')
r = subprocess.run(['nano-rspow', 'validate', root.hex(), f'{nonce:016x}',
                    '--threshold', f'{threshold:016x}'], text=True, capture_output=True, check=True)
print(r.stdout, end='')
if not re.search(r'Valid\s*:.*YES', r.stdout):
    raise SystemExit('stock CLI did not report valid work')
