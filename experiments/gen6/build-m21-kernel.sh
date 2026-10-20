#!/usr/bin/env bash
# Assemble Gen6 probes on lemox. This script never submits GPU commands.
set -euo pipefail
cd "$(dirname "$0")"
remote=/tmp/nano-gen6-session6
ssh root@lemox.lan "mkdir -p $remote"
for name in dump dump2 eot pattern16 pattern128 pattern256 slots lane arith; do
  cpp -P -DDEV_SNB -I. "m21$name.asm" > "m21$name.pre.asm"
  m4 "m21$name.pre.asm" > "m21$name.gen6.asm"
  scp "m21$name.gen6.asm" "root@lemox.lan:$remote/"
  ssh root@lemox.lan "intel-gen4asm -g 6 -o $remote/m21$name.g6b $remote/m21$name.gen6.asm"
  scp "root@lemox.lan:$remote/m21$name.g6b" "m21$name.g6b"
  python3 g4b2bin.py "m21$name.g6b" "m21$name.bin"
done
python3 g4b2c.py m21dump.g6b > m21dump_blob.h
python3 g4b2c.py m21dump2.g6b | sed 's/m21_kernel/m21dump2_kernel/' > m21dump2_blob.h
