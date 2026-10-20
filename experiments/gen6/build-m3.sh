#!/usr/bin/env bash
# Generate on the workstation; assemble with the Gen6 assembler on lemox.
set -euo pipefail
cd "$(dirname "$0")"
rounds=${1:-12}
if (($#)) && [[ $rounds =~ ^[0-9]+$ ]]; then shift; else rounds=12; fi
lanes=8
pred=0
while (($#)); do
  case "$1" in
    --lanes) lanes=${2:?--lanes requires 8 or 16}; shift 2 ;;
    --pred) pred=1; shift ;;
    --no-pred) pred=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ $lanes == 8 || $lanes == 16 ]] || { echo "lanes must be 8 or 16" >&2; exit 2; }
suffix="${rounds}"
if [[ $lanes != 8 || $pred == 1 ]]; then suffix="${rounds}-l${lanes}"; fi
((pred)) && suffix="${suffix}-pred"
remote=/tmp/nano-gen6-m3
args=(--rounds "$rounds" --lanes "$lanes")
((pred)) && args+=(--pred)
python3 kgen.py "${args[@]}" --metadata "m3-${suffix}.json" > "m3-${suffix}.asm" 2> "kgen-m3-${suffix}.log"
mkdir -p "$remote"
scp "m3-${suffix}.asm" snb-m3.c snb-gpu.h golden.py kgen.py "root@lemox.lan:$remote/"
ssh root@lemox.lan "intel-gen4asm -g 6 -o $remote/m3-${suffix}.g6b $remote/m3-${suffix}.asm"
scp "root@lemox.lan:$remote/m3-${suffix}.g6b" "m3-${suffix}.g6b"
python3 g4b2bin.py "m3-${suffix}.g6b" "m3-${suffix}.bin"
scp "m3-${suffix}.bin" "root@lemox.lan:$remote/m3-${suffix}.bin"
ssh root@lemox.lan "cc -O2 -Wall -Wextra -Werror \$(pkg-config --cflags libdrm) -o $remote/snb-m3 $remote/snb-m3.c && $remote/snb-m3 --kernel $remote/m3-${suffix}.bin --root 0000000000000000000000000000000000000000000000000000000000000001 --base 0 --threads 1 --lanes $lanes"
cat "kgen-m3-${suffix}.log"
