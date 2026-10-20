#!/usr/bin/env python3
"""Embed the authoritative checkout kernel; only normalize CRLF line endings."""
import hashlib
from pathlib import Path
here = Path(__file__).resolve().parent
source = here.parent.parent / 'nano-rspow/src/opencl_backend/pow.cl'
raw = source.read_bytes().replace(b'\r\n', b'\n')
text = ('/* Exact checkout pow.cl, CRLF normalized. SHA256 ' + hashlib.sha256(raw).hexdigest() +
        ' */\nstatic const unsigned char powcl_source[] = {\n' +
        ''.join('    ' + ','.join(str(x) for x in raw[i:i+24]) + ',\n'
                for i in range(0, len(raw), 24)) +
        '};\nstatic const size_t powcl_length = sizeof powcl_source;\n')
(here / 'powcl_blob.h').write_text(text)
print(f'pow.cl {len(raw)} normalized bytes sha256={hashlib.sha256(raw).hexdigest()}')
