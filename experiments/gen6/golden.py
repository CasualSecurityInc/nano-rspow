#!/usr/bin/env python3
"""CPU oracle and checker for the Gen6 Blake2b-8 SoA output buffer.

The four output GRFs are written in lane-vector order, so each thread writes
nonce_lo[8], hash_lo[8], hash_hi[8], hit[8] (32 dwords / 128 bytes).
"""
import hashlib
import struct
import sys

MASK64 = (1 << 64) - 1


def digest(nonce: int, root: bytes) -> int:
    raw = hashlib.blake2b(struct.pack("<Q", nonce) + root, digest_size=8).digest()
    return int.from_bytes(raw, "little")


def parse_root(text: str) -> bytes:
    try:
        root = bytes.fromhex(text.removeprefix("0x"))
    except ValueError as exc:
        raise SystemExit(f"invalid root hex: {exc}")
    if len(root) != 32:
        raise SystemExit(f"root must be exactly 32 bytes, got {len(root)}")
    return root


def check(path: str, root: bytes, base: int, threads: int, threshold: int | None,
          lanes: int = 8, rounds: int = 12) -> int:
    if lanes not in (8, 16) or not 0 <= rounds <= 12:
        raise SystemExit("lanes must be 8 or 16; rounds must be 0..12")
    if not 1 <= threads:
        raise SystemExit("threads must be positive")
    if not 0 <= base <= MASK64 or base + threads * lanes - 1 > MASK64:
        raise SystemExit("nonce range wraps 64 bits")
    if base & (lanes - 1):
        raise SystemExit(f"base must be {lanes}-lane aligned")
    if (base & 0xFFFFFFFF) + threads * lanes > 1 << 32:
        raise SystemExit("batch crosses a 32-bit nonce boundary")
    data = open(path, "rb").read()
    stride = lanes * 16
    required = threads * stride
    if len(data) < required:
        raise SystemExit(f"dump too small: {len(data)} < {required}")
    bad = 0
    hits = []
    for t in range(threads):
        words = struct.unpack_from(f"<{lanes * 4}I", data, t * stride)
        for lane in range(lanes):
            nonce = base + t * lanes + lane
            if rounds == 12:
                h = digest(nonce, root)
            else:
                sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
                import kgen
                h = kgen.reference(nonce, root, rounds)
            if lanes == 8:
                got = (words[lane], words[8 + lane], words[16 + lane], words[24 + lane])
            else:
                # Each SIMD16 result is two adjacent SIMD8 SoA blocks because
                # the established dataport message writes 128 bytes at a time.
                block, within = divmod(lane, 8)
                offset = block * 32
                got = tuple(words[offset + field * 8 + within] for field in range(4))
            want = (nonce & 0xFFFFFFFF, h & 0xFFFFFFFF, h >> 32,
                    int(threshold is not None and h >= threshold))
            # When no threshold was supplied, only the first three fields are
            # meaningful to this invocation.
            if got[:3] != want[:3] or (threshold is not None and got[3] != want[3]):
                bad += 1
                if bad <= 8:
                    print(f"MISMATCH thread={t} lane={lane}: "
                          f"want {[f'{x:08x}' for x in want]} got {[f'{x:08x}' for x in got]}")
            if threshold is not None and got[3] == 1:
                hits.append((nonce, h))
    guard = data[required:]
    if any(byte != 0xCD for byte in guard):
        bad += 1
        print("FAIL: guard bytes after the logical result surface were modified")
    if bad:
        print(f"FAIL: {bad} mismatch(es), {threads * lanes} nonces")
        return 1
    print(f"PASS: {threads * lanes} exact nonce/hash records; lanes={lanes} rounds={rounds}; "
          f"root={root.hex()} base=0x{base:016x}" +
          (f" threshold=0x{threshold:016x} hits={len(hits)}" if threshold is not None else ""))
    for nonce, h in hits[:8]:
        print(f"HIT nonce=0x{nonce:016x} h0=0x{h:016x}")
    return 0


def usage() -> None:
    raise SystemExit("usage: golden.py vectors ROOT BASE THREADS [THRESHOLD] | "
                     "check FILE ROOT BASE THREADS [THRESHOLD]")


def main(args: list[str]) -> int:
    if not args:
        usage()
    mode = args.pop(0)
    if mode == "vectors":
        positional, lanes, rounds = parse_options(args)
        if len(positional) not in (3, 4):
            usage()
        root, base, threads = parse_root(positional[0]), int(positional[1], 0), int(positional[2], 0)
        threshold = int(positional[3], 0) if len(positional) == 4 else None
        if lanes not in (8, 16) or not 0 <= rounds <= 12:
            raise SystemExit("lanes must be 8 or 16; rounds must be 0..12")
        for t in range(threads):
            for lane in range(lanes):
                nonce = base + t * lanes + lane
                if rounds == 12:
                    h = digest(nonce, root)
                else:
                    import kgen
                    h = kgen.reference(nonce, root, rounds)
                print(f"thread={t} lane={lane} nonce=0x{nonce:016x} h0=0x{h:016x}" +
                      (f" hit={int(h >= threshold)}" if threshold is not None else ""))
        return 0
    if mode == "check":
        args, lanes, rounds = parse_options(args)
        if len(args) not in (4, 5):
            usage()
        path, root_text, base_text, count_text = args[:4]
        threshold = int(args[4], 0) if len(args) == 5 else None
        return check(path, parse_root(root_text), int(base_text, 0), int(count_text, 0), threshold,
                     lanes, rounds)
    usage()
    return 2


def parse_options(args: list[str]) -> tuple[list[str], int, int]:
    positional, lanes, rounds = [], 8, 12
    i = 0
    while i < len(args):
        if args[i] == "--lanes" and i + 1 < len(args):
            lanes = int(args[i + 1], 0); i += 2
        elif args[i] == "--rounds" and i + 1 < len(args):
            rounds = int(args[i + 1], 0); i += 2
        else:
            positional.append(args[i]); i += 1
    return positional, lanes, rounds


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
