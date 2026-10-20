#!/usr/bin/env bash
# Search one Nano receive-tier range stream, then verify the whole result BO.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=${ROOT:-718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2}
BASE=${BASE:-0}
THREADS=${THREADS:-4096}
THRESHOLD=${THRESHOLD:-0xfffffe0000000000}
OUT=${OUT:-m3-results/solve-receive.bin}
mkdir -p "$(dirname "$OUT")"
args=(--solve --kernel m3.bin --root "$ROOT" --base "$BASE" --threads "$THREADS" --threshold "$THRESHOLD" --dump "$OUT")
if [ -n "${MAX_HASHES:-}" ]; then args+=(--max-hashes "$MAX_HASHES"); fi
./snb-m3 "${args[@]}" 2>&1 | tee m3-results/solve-receive.log
nonce=$(sed -n 's/^SOLVED nonce=\(0x[0-9a-f]*\) .*/\1/p' m3-results/solve-receive.log)
solved_base=$(sed -n 's/.* base=\(0x[0-9a-f]*\)$/\1/p' m3-results/solve-receive.log)
test -n "$nonce" && test -n "$solved_base"
python3 golden.py check "$OUT" "$ROOT" "$solved_base" "$THREADS" "$THRESHOLD"
nano-rspow validate "$ROOT" "$nonce" --threshold "$THRESHOLD" | tee m3-results/solve-cli-validate.log
