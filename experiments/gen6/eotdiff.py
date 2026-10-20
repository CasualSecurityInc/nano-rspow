#!/usr/bin/env python3
"""Compare the assembled Gen6 EOT SEND against shipped VAAPI kernels."""
import re
import sys


def instructions(path):
    text = open(path, errors="replace").read()
    words = [int(token, 16) for token in
             re.findall(r"0[xX]([0-9a-fA-F]{1,8})", text)]
    if len(words) % 4:
        print(f"warning: ignoring {len(words) % 4} trailing dword(s) in {path}")
    words = words[:len(words) // 4 * 4]
    return [tuple(words[i:i + 4]) for i in range(0, len(words), 4)]


def fmt(inst):
    return " ".join(f"{word:08x}" for word in inst)


def main(args):
    if len(args) < 2:
        raise SystemExit("usage: eotdiff.py OUR.g6b REF1.g6b [REF2.g6b ...]")
    ours = instructions(args[0])
    if not ours:
        raise SystemExit(f"{args[0]}: no instructions found")
    print(f"ours: {len(ours)} instructions; tail:")
    for inst in ours[-2:]:
        print("  " + fmt(inst))
    matched = False
    for path in args[1:]:
        ref = instructions(path)
        if not ref:
            print(f"{path}: no instructions found")
            continue
        equal = ours[-1] == ref[-1]
        matched |= equal
        verdict = "MATCH" if equal else "DIFF xor: " + fmt(
            tuple(a ^ b for a, b in zip(ours[-1], ref[-1])))
        print(f"{path}:\n  ref : {fmt(ref[-1])}\n  {verdict}")
    print("VERDICT:", "EOT matches a shipped kernel" if matched else
          "EOT differs from shipped kernels")
    return 0 if matched else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
