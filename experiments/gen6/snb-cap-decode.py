#!/usr/bin/env python3
"""Decode the captured execbuf's final object as the batch buffer."""
import glob
import os
import re
import struct
import sys

OPS = {
    0x7A000000: "PIPE_CONTROL",
    0x61010000: "STATE_BASE_ADDRESS",
    0x70000000: "MEDIA_VFE_STATE/STATE_POINTERS",
    0x70010000: "MEDIA_CURBE_LOAD",
    0x70020000: "MEDIA_INTERFACE_DESCRIPTOR_LOAD",
    0x70030000: "MEDIA_GATEWAY_STATE",
    0x70040000: "MEDIA_STATE_FLUSH",
    0x71000000: "MEDIA_OBJECT",
    0x71030000: "MEDIA_OBJECT_WALKER",
}

def read_batch(manifest):
    lines = open(manifest, encoding="ascii").read().splitlines()
    m = re.search(r"batch_len (\d+) batch_off (\d+) count (\d+)", lines[0])
    batch_len, batch_off, count = map(int, m.groups())
    obj = [line.split() for line in lines if line.startswith("obj ")][-1]
    _, index, handle, size, reloc_count = obj
    sid = os.path.basename(manifest)[4:7]
    path = os.path.join(os.path.dirname(manifest), f"bo-{sid}-{index}-{handle}.bin")
    data = open(path, "rb").read()[batch_off:batch_off + batch_len]
    words = struct.unpack("<%dI" % (len(data) // 4), data)
    return lines, words, batch_len

def identify(word):
    if (word & 0xFFFFFFFE) == 0x69040000:
        return "PIPELINE_SELECT", 1
    opcode = word & 0xFFFF0000
    name = OPS.get(opcode)
    if not name:
        return None, 1
    if opcode == 0x7A000000:
        return name, 4
    length = (word & 0xFFFF) + 2
    if opcode == 0x70000000:
        name = {3: "MEDIA_STATE_POINTERS", 8: "MEDIA_VFE_STATE"}.get(length, name)
    return name, length


def main(directory):
    total_walker_headers = 0
    media_batches = 0
    for manifest in sorted(glob.glob(os.path.join(directory, "sub-*.manifest"))):
        lines, words, batch_len = read_batch(manifest)
        commands = []
        i = 0
        while i < len(words):
            name, length = identify(words[i])
            if name:
                commands.append((i, words[i], name, length))
                i += max(1, length)
            else:
                i += 1
        names = [item[2] for item in commands]
        if "MEDIA_VFE_STATE" not in names and "MEDIA_STATE_POINTERS" not in names:
            continue
        media_batches += 1
        total_walker_headers += names.count("MEDIA_OBJECT_WALKER")
        sid = os.path.basename(manifest)[4:7]
        print(f"\n{submission_name(sid)} batch_len={batch_len} commands={len(commands)}")
        for index, word, name, length in commands:
            print(f"  dw{index:3} 0x{word:08x} {name} ({length} dwords)")
            if name == "MEDIA_VFE_STATE":
                v = words[index:index + 8]
                print(f"       scratch=0x{v[1]:08x} max_threads={v[2] >> 16} "
                      f"urb_entries={(v[2] >> 8) & 0xff} "
                      f"urb_entry_size={v[4] >> 16} curbe_alloc={v[4] & 0xffff}")
            if name == "MEDIA_OBJECT_WALKER":
                print("       walker fields:", " ".join(f"{x:08x}" for x in words[index:index + length]))
        batch_obj = [line.split() for line in lines if line.startswith("obj ")][-1]
        _, idx, handle, *_ = batch_obj
        reloc_lines = [line for line in lines if line.startswith("reloc ")]
        print(f"  batch object={idx}/{handle}; relocations listed in {os.path.basename(manifest)}")
        # Object records follow relocations, so list only the final object's entries.
        obj_start = max(i for i, line in enumerate(lines) if line.startswith("obj "))
        print("  " + "; ".join(line for line in lines[obj_start + 1:] if line.startswith("reloc ")))
    print(f"\nmedia batches={media_batches}; walker commands={total_walker_headers}")

def submission_name(sid):
    return f"submission {sid}"

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/snbcap")
