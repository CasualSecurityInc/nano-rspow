#!/usr/bin/env python3
"""Decode captured i915 batches and follow nested media batch buffers."""
import os
import struct
import sys

COMMANDS = {
    0x6101: ("STATE_BASE_ADDRESS", None),
    0x6904: ("PIPELINE_SELECT", 1),
    0x7000: ("MEDIA_VFE_STATE", 8),
    0x7001: ("MEDIA_CURBE_LOAD", 4),
    0x7002: ("MEDIA_INTERFACE_DESCRIPTOR_LOAD", 4),
    0x7003: ("MEDIA_GATEWAY_STATE", 4),
    0x7004: ("MEDIA_STATE_FLUSH", 2),
    0x7100: ("MEDIA_OBJECT", None),
    0x7103: ("MEDIA_OBJECT_WALKER", 17),
}
MI_BATCH_BUFFER_START = 0x18800000
MI_BATCH_BUFFER_END = 0x05000000


def read_submission(capdir, sub):
    manifest = {}
    objects = []
    path = os.path.join(capdir, sub + ".manifest")
    with open(path) as source:
        for line in source:
            fields = line.split()
            if not fields:
                continue
            if fields[0] == "seq":
                manifest = {"seq": int(fields[1]), "ring": int(fields[3]),
                            "batch_len": int(fields[5]), "batch_off": int(fields[7]),
                            "count": int(fields[9])}
            elif fields[0] == "obj":
                obj = {"index": int(fields[1]), "handle": int(fields[2]),
                       "size": int(fields[3]), "relocs": {}, "data": b""}
                name = f"bo-{manifest['seq']:03d}-{obj['index']}-{obj['handle']}.bin"
                try:
                    obj["data"] = open(os.path.join(capdir, name), "rb").read()
                except OSError:
                    pass
                objects.append(obj)
            elif fields[0] == "reloc" and objects:
                offset, target, delta = map(int, fields[1:4])
                domains = tuple(map(int, fields[4:6])) if len(fields) >= 6 else None
                objects[-1]["relocs"][offset] = (target, delta, domains)
    return manifest, objects


def dwords(obj):
    data = obj["data"]
    size = len(data) // 4 * 4
    return list(struct.unpack(f"<{size // 4}I", data[:size]))


def relocation(obj, byte_offset):
    item = obj["relocs"].get(byte_offset)
    if item is None:
        return ""
    target, delta, domains = item
    suffix = " domains=unknown" if domains is None else \
        f" read=0x{domains[0]:x} write=0x{domains[1]:x}"
    return f" -> handle {target} +0x{delta:x}{suffix}"


def dump_object(obj, count, label, base_offset=0):
    print(f"    {label}: obj[{obj['index']}] handle={obj['handle']} "
          f"size={obj['size']} data+0x{base_offset:x}")
    ws = dwords(obj)
    start_dw = base_offset // 4
    for i in range(count):
        index = start_dw + i
        if index >= len(ws):
            print(f"      DW{i:<2} (outside object)")
            break
        print(f"      DW{i:<2} 0x{ws[index]:08x}{relocation(obj, index * 4)}")


def decode_batch(obj, by_handle, depth=0, seen=None):
    if seen is None:
        seen = set()
    if obj["handle"] in seen:
        print("  " * depth + "(batch already visited)")
        return
    seen.add(obj["handle"])
    ws = dwords(obj)
    indent = "  " * depth
    limit = min(len(ws), obj.get("decode_limit", len(ws)))
    i = 0
    while i < limit:
        word = ws[i]
        if word == 0:
            i += 1
            continue
        if word == MI_BATCH_BUFFER_END:
            print(f"{indent}[{i:4}] MI_BATCH_BUFFER_END")
            return
        if word & 0xFF800000 == MI_BATCH_BUFFER_START:
            target_info = obj["relocs"].get(4 * (i + 1))
            print(f"{indent}[{i:4}] MI_BATCH_BUFFER_START" +
                  (relocation(obj, 4 * (i + 1)) or " (no relocation recorded)"))
            if target_info:
                target = by_handle.get(target_info[0])
                if target:
                    decode_batch(target, by_handle, depth + 1, seen)
            i += 2
            continue
        if word >> 24 == 0x7A:
            name, length = "PIPE_CONTROL", (word & 0xFF) + 2
        else:
            name_length = COMMANDS.get(word >> 16)
            if name_length is None:
                print(f"{indent}[{i:4}] MI/unknown 0x{word:08x}")
                i += 1
                continue
            name, length = name_length
            if length is None:
                length = (word & 0xFF) + 2
        print(f"{indent}[{i:4}] {name} ({length} dw)")
        for j in range(length):
            if i + j >= limit:
                print(f"{indent}      (short packet)")
                break
            print(f"{indent}      DW{j:<2} 0x{ws[i + j]:08x}"
                  f"{relocation(obj, 4 * (i + j))}")

        if name in ("MEDIA_CURBE_LOAD", "MEDIA_INTERFACE_DESCRIPTOR_LOAD"):
            # Both Gen6 commands put the relocated source address in DW3.
            ptr_reloc = obj["relocs"].get(4 * (i + 3))
            if ptr_reloc:
                target = by_handle.get(ptr_reloc[0])
                if target:
                    label = "CURBE" if name == "MEDIA_CURBE_LOAD" else "IDRT"
                    data_offset = ptr_reloc[1]
                    dump_object(target, 16, label, data_offset)
                    if label == "IDRT":
                        kernel_reloc = target["relocs"].get(data_offset)
                        if kernel_reloc:
                            kernel = by_handle.get(kernel_reloc[0])
                            if kernel:
                                print(f"    kernel BO: obj[{kernel['index']}] "
                                      f"handle={kernel['handle']} +0x{kernel_reloc[1]:x}")
        i += length


def main(argv):
    if len(argv) < 2:
        raise SystemExit("usage: capmedia.py CAPDIR [sub-NNN ...]")
    capdir = argv[1]
    subs = argv[2:] or sorted(name[:-9] for name in os.listdir(capdir)
                              if name.startswith("sub-") and name.endswith(".manifest"))
    for sub in subs:
        manifest, objects = read_submission(capdir, sub)
        if not objects:
            continue
        by_handle = {obj["handle"]: obj for obj in objects}
        batch = objects[-1]
        batch["decode_limit"] = min(manifest.get("batch_len", len(batch["data"])),
                                    len(batch["data"])) // 4
        has_media = any(word >> 16 in COMMANDS for obj in objects for word in dwords(obj))
        print(f"\n===== {sub} ring={manifest.get('ring', -1)} "
              f"batch_len={manifest.get('batch_len', 0)} "
              f"batch_off={manifest.get('batch_off', 0)} objects={len(objects)}"
              f"{' *** MEDIA ***' if has_media else ''} =====")
        if has_media:
            decode_batch(batch, by_handle)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
