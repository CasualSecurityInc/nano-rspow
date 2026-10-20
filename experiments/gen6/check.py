#!/usr/bin/env python3
"""Validate actual GPU BO bytes, including unwritten sentinel guards."""
import hashlib
import struct
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit('usage: check.py FILE ctl|pattern16|pattern128|pattern256|a0|a0magic|a1|slotsN|lane|arith')
path, mode = sys.argv[1:]
data = Path(path).read_bytes()
if len(data) != 4096:
    raise SystemExit(f'FAIL: expected a full 4096-byte BO, got {len(data)}')
actual = list(struct.unpack('<1024I', data))
expected = [0xcdcdcdcd] * 1024
inline = [0, 0, 0x000f0001, 0x00300007, 0, 0x00140008, 0, 0]
if mode == 'ctl':
    pass
elif mode.startswith('pattern'):
    size = int(mode[7:])
    if size not in (16, 128, 256): raise SystemExit('unsupported pattern size')
    expected[:size//4] = [0x61000000+i for i in range(size//4)]
elif mode in ('a0', 'a0magic', 'a1'):
    expected[:8] = [None] * 8  # Hardware R0 header: record it, do not invent constants.
    expected[8:24] = [0xc0de0000+i for i in range(16)]
    expected[24:32] = [0xfeed0000+i for i in range(8)] if mode == 'a0magic' else inline
    if mode == 'a1':
        expected[32:64] = [0xaaaa0000+g for g in range(4) for _ in range(8)]
elif mode.startswith('slots'):
    count = int(mode[5:])
    if not 1 <= count <= 60: raise SystemExit('slot count must be 1..60')
    for i in range(count):
        expected[i*8:(i+1)*8] = [i, 0xfeed0001, 0xfeed0002, None,
                                 0xfeed0004, 0xfeed0005, 0xfeed0006, 0xfeed0007]
elif mode == 'lane':
    expected[:32] = list(range(0x101, 0x109)) + [0xc0de0000+i for i in range(16)] + inline
elif mode == 'arith':
    a = [0, 0xffffffff, 0xffffffffffffffff, 0x12345678ffffffff,
         0x8000000000000000, 0x0123456789abcdef, 0xffffffffffffffff, 0xfffffffe00000001]
    b = [0, 1, 1, 0x0000000100000001,
         0x8000000000000000, 0xfedcba9876543210, 0xffffffffffffffff, 0x00000001ffffffff]
    mask = (1 << 64) - 1
    sums = [(x+y) & mask for x, y in zip(a, b)]
    rot24 = [((s >> 24) | (s << 40)) & mask for s in sums]
    rot63 = [((s >> 63) | (s << 1)) & mask for s in sums]
    carry = [int((x & 0xffffffff) + (y & 0xffffffff) >= 1 << 32) for x, y in zip(a, b)]
    regs = [[s & 0xffffffff for s in sums], [s >> 32 for s in sums],
            [s & 0xffffffff for s in rot24], [s >> 32 for s in rot24],
            [s & 0xffffffff for s in rot63], [s >> 32 for s in rot63],
            carry, [0xaaaaaaaa if c else 0x55555555 for c in carry]]
    expected[:64] = [w for reg in regs for w in reg]
else:
    raise SystemExit(f'unknown mode: {mode}')
bad = [(i, want, actual[i]) for i, want in enumerate(expected) if want is not None and actual[i] != want]
for i, want, got in bad[:20]:
    print(f'FAIL byte {i*4:4d}: want 0x{want:08x}, got 0x{got:08x}')
if bad:
    raise SystemExit(f'FAIL {mode}: {len(bad)} mismatching dwords')
if mode in ('a0', 'a0magic', 'a1'):
    print('R0 header:', ' '.join(f'{w:08x}' for w in actual[:8]))
if mode.startswith('slots'):
    print('Recorded dispatch headers:', ' '.join(f'{actual[i*8+3]:08x}' for i in range(int(mode[5:]))))
print(f'PASS {mode}: all defined output words and remaining guard bytes match; sha256={hashlib.sha256(data).hexdigest()}')
