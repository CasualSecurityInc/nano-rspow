#!/usr/bin/env python3
"""Convert intel-gen4asm's textual .g6b/.g4b output to little-endian bytes."""
import re
import struct
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: g4b2bin.py INPUT.g6b OUTPUT.bin")
text = open(sys.argv[1], errors="replace").read()
tokens = re.findall(r"0[xX]([0-9a-fA-F]{1,8})", text)
words = [int(token, 16) for token in tokens]
if not words:
    raise SystemExit(f"{sys.argv[1]}: no dwords found")
if len(words) % 4:
    raise SystemExit(f"{sys.argv[1]}: {len(words)} dwords is not a whole instruction count")
with open(sys.argv[2], "wb") as output:
    output.write(struct.pack(f"<{len(words)}I", *words))
print(f"{sys.argv[1]}: {len(words)} dwords -> {sys.argv[2]}")
