#!/usr/bin/env python3
"""Convert intel-gen4asm's textual .g6b/.g4b output to a C dword array."""
import re
import sys

words = []
for line in open(sys.argv[1], encoding="ascii"):
    for token in re.findall(r"0x([0-9a-fA-F]{8})", line.split("#", 1)[0]):
        words.append(int(token, 16))
if not words or len(words) % 4:
    raise SystemExit(f"expected non-empty 4-dword instructions; got {len(words)} dwords")
print(f"/* generated from {sys.argv[1]}: {len(words)} dwords */")
print("static const uint32_t m21_kernel[] = {")
for i in range(0, len(words), 4):
    print("    " + ", ".join(f"0x{w:08x}u" for w in words[i : i + 4]) + ",")
print("};")
