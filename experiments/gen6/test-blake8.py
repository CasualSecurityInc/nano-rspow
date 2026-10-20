#!/usr/bin/env python3
"""Compare the standalone C oracle with hashlib, including byte-order edges."""
import ctypes
import hashlib
from pathlib import Path
import random
import struct
import subprocess
import tempfile

here = Path(__file__).resolve().parent
rng = random.Random(6209)
cases = [(bytes(31) + b'\x01', n) for n in (0, 1, 0x1234567890abcdef, 2**64-1)]
cases += [(rng.randbytes(32), rng.randrange(2**64)) for _ in range(2000)]
with tempfile.TemporaryDirectory(prefix='blake8-test-') as tmp:
    libpath = Path(tmp) / 'blake8.so'
    subprocess.run(['cc', '-O3', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC',
                    str(here / 'blake8.c'), '-o', str(libpath)], check=True)
    lib = ctypes.CDLL(str(libpath))
    lib.blake8_hash.argtypes = [ctypes.c_uint64, ctypes.POINTER(ctypes.c_uint64)]
    lib.blake8_hash.restype = ctypes.c_uint64
    for root, nonce in cases:
        words = (ctypes.c_uint64 * 4)(*struct.unpack('<4Q', root))
        got = lib.blake8_hash(nonce, words)
        want = int.from_bytes(hashlib.blake2b(struct.pack('<Q', nonce) + root,
                                             digest_size=8).digest(), 'little')
        if got != want:
            raise SystemExit(f'FAIL root={root.hex()} nonce={nonce:#x} got={got:#x} want={want:#x}')
print(f'PASS blake8: {len(cases)} C/hashlib comparisons, including root/nonce byte order')
