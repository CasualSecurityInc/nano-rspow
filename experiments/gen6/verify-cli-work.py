#!/usr/bin/env python3
"""Verify an actual CLI generate log independently, then use its validate command."""
import hashlib
import re
import struct
import subprocess
import sys

text = open(sys.argv[1]).read()
if not re.search(r'^Backend\s*:\s*opencl\s*$', text, re.M):
    raise SystemExit('generation did not use the OpenCL backend')
root = re.search(r'^Hash\s*:\s*([0-9a-fA-F]{64})', text, re.M)[1]
nonce = re.search(r'^Nonce\s*:\s*([0-9a-fA-F]{16})', text, re.M)[1]
threshold = int(re.search(r'^Threshold\s*:\s*(0x[0-9a-fA-F]+)', text, re.M)[1], 16)
h = int.from_bytes(hashlib.blake2b(struct.pack('<Q', int(nonce, 16)) + bytes.fromhex(root),
                                 digest_size=8).digest(), 'little')
if h < threshold:
    raise SystemExit('hashlib rejects generated work')
print(f'PASS hashlib nonce={nonce} h0={h:016x} threshold={threshold:016x}')
r = subprocess.run([sys.argv[2] if len(sys.argv) > 2 else 'nano-rspow', 'validate',
                    root, nonce, '--threshold', f'{threshold:016x}'],
                   text=True, capture_output=True, check=True)
print(r.stdout, end='')
if not re.search(r'Valid\s*:.*YES', r.stdout):
    raise SystemExit('stock CLI did not validate work')
