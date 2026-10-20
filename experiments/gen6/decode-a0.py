#!/usr/bin/env python3
"""Decode saved result bytes without assuming output offset equals GRF offset."""
import struct
import sys
from pathlib import Path

inline = [0, 0, 0x000f0001, 0x00300007, 0, 0x00140008, 0, 0]
for name in sys.argv[1:]:
    data = Path(name).read_bytes()
    if len(data) % 4:
        raise SystemExit(f'{name}: not a whole number of dwords')
    words = struct.unpack(f'<{len(data)//4}I', data)
    nonzero = [(i, w) for i, w in enumerate(words) if w]
    print(f'{name}: {len(words)} dwords, {len(nonzero)} nonzero')
    for i, w in nonzero:
        tags = [f'captured packet DW{6+j}' for j, v in enumerate(inline) if v == w]
        print(f'  output DW{i:2d}, byte {4*i:3d}: 0x{w:08x} {", ".join(tags)}')
